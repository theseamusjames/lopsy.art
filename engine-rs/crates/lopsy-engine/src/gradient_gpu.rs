use crate::engine::EngineInner;
use crate::gpu::params::gradient::{GradientLinearParams, GradientRadialParams};
use crate::gpu::pass::{Blend, Pass, Target};
use crate::gpu::uniforms::{FloatArray, Vec4Array};
use crate::gpu::texture_pool::TextureHandle;

#[derive(serde::Deserialize)]
pub struct GradientStop {
    position: f32,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
}

/// Snapshot the layer's current content into a preview texture so each
/// subsequent gradient render reads from the pre-drag pixels rather than
/// from the previously-rendered (and now contaminated) layer texture.
/// Without this, dragging the gradient back and forth — particularly when a
/// stop has alpha 0 — leaves visible artifacts inside the marquee because
/// the shader's alpha-over math preserves the previous frame's pixels
/// wherever the new gradient is transparent.
pub fn save_gradient_preview(engine: &mut EngineInner, layer_id: &str) {
    let _ = engine.ensure_layer_full_size(layer_id);

    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }

    if let Some(old) = engine.gradient_preview_texture.take() {
        engine.texture_pool.release(old);
    }
    let preview_handle = match engine.texture_pool.acquire(w, h) {
        Ok(h) => h,
        Err(_) => return,
    };
    if engine.texture_pool.get(preview_handle).is_none() {
        return;
    }

    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", tex_handle)
        .blend(Blend::Off)
        .draw(Target::Texture(preview_handle));

    engine.gradient_preview_texture = Some(preview_handle);
    engine.gradient_preview_layer_id = Some(layer_id.to_string());
}

pub fn end_gradient_preview(engine: &mut EngineInner) {
    if let Some(h) = engine.gradient_preview_texture.take() {
        engine.texture_pool.release(h);
    }
    engine.gradient_preview_layer_id = None;
}

/// If a gradient preview snapshot exists for this layer, copy it over the
/// layer texture so the gradient renders against the original (pre-drag)
/// content. Returns true when restored. Falls back to the previous behavior
/// (a per-frame copy of the current layer into scratch_a, sampled as the
/// "existing" texture) when no preview is active.
fn restore_layer_from_preview(engine: &mut EngineInner, layer_id: &str) -> bool {
    let has_preview = engine.gradient_preview_layer_id.as_deref() == Some(layer_id)
        && engine.gradient_preview_texture.is_some();
    if !has_preview {
        return false;
    }
    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return false,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return false;
    }
    let Some(preview) = engine.gradient_preview_texture
        .filter(|&p| engine.texture_pool.get(p).is_some())
    else {
        return false;
    };

    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", preview)
        .viewport(0, 0, w as i32, h as i32)
        .blend(Blend::Off)
        .draw(Target::Texture(tex_handle));
    true
}

pub fn render_linear_gradient(
    engine: &mut EngineInner,
    layer_id: &str,
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    stops_json: &str,
) {
    let stops: Vec<GradientStop> = match serde_json::from_str(stops_json) {
        Ok(s) => s,
        Err(_) => return,
    };

    let _ = engine.ensure_layer_full_size(layer_id);

    // If we have a snapshot from gradient_down, restore the layer from it so
    // subsequent gradient renders during the same drag don't accumulate.
    restore_layer_from_preview(engine, layer_id);

    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }

    let layer_desc = engine.layer_stack.iter().find(|l| l.id == layer_id);
    let layer_x = layer_desc.map(|l| l.x as f32).unwrap_or(0.0);
    let layer_y = layer_desc.map(|l| l.y as f32).unwrap_or(0.0);

    // Copy existing layer content to scratch_a for reading
    copy_to_scratch_a(engine, tex_handle, w, h);

    let selection_mask = engine.selection_mask_texture
        .filter(|&m| engine.texture_pool.get(m).is_some());
    // The shader measures texture-local pixels and the endpoints arrive
    // in document space: take off the layer origin, which is negative
    // for a layer moved past the top or left edge (#1169).
    let shape = GradientShape::Linear {
        start: (start_x as f32 - layer_x, start_y as f32 - layer_y),
        end: (end_x as f32 - layer_x, end_y as f32 - layer_y),
    };
    draw_gradient(engine, &shape, &stops, &GradientTarget {
        existing: engine.scratch_texture_a,
        target: tex_handle,
        w,
        h,
        origin: (layer_x, layer_y),
        selection: selection_mask,
    });

    engine.mark_layer_dirty(layer_id);
}

pub fn render_radial_gradient(
    engine: &mut EngineInner,
    layer_id: &str,
    center_x: f64,
    center_y: f64,
    radius: f64,
    stops_json: &str,
) {
    let stops: Vec<GradientStop> = match serde_json::from_str(stops_json) {
        Ok(s) => s,
        Err(_) => return,
    };

    let _ = engine.ensure_layer_full_size(layer_id);

    restore_layer_from_preview(engine, layer_id);

    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }

    let layer_desc = engine.layer_stack.iter().find(|l| l.id == layer_id);
    let layer_x = layer_desc.map(|l| l.x as f32).unwrap_or(0.0);
    let layer_y = layer_desc.map(|l| l.y as f32).unwrap_or(0.0);

    // Copy existing layer content to scratch_a for reading
    copy_to_scratch_a(engine, tex_handle, w, h);

    let selection_mask = engine.selection_mask_texture
        .filter(|&m| engine.texture_pool.get(m).is_some());
    let shape = GradientShape::Radial {
        center: (center_x as f32 - layer_x, center_y as f32 - layer_y),
        radius: radius as f32,
    };
    draw_gradient(engine, &shape, &stops, &GradientTarget {
        existing: engine.scratch_texture_a,
        target: tex_handle,
        w,
        h,
        origin: (layer_x, layer_y),
        selection: selection_mask,
    });

    engine.mark_layer_dirty(layer_id);
}

/// Where a gradient runs, in the target's texels.
pub(crate) enum GradientShape {
    Linear { start: (f32, f32), end: (f32, f32) },
    Radial { center: (f32, f32), radius: f32 },
}

/// Blit `src` into scratch A at `w`×`h`, so a pass can read a texture's
/// current content while rendering back into it.
pub(crate) fn copy_to_scratch_a(engine: &EngineInner, src: TextureHandle, w: u32, h: u32) {
    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", src)
        .viewport(0, 0, w as i32, h as i32)
        .blend(Blend::Off)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));
}

/// Where a gradient is drawn: over `existing`, a `w`×`h` copy of what
/// `target` holds, with `origin` the target's document-space origin. With a
/// `selection`, the gradient is limited to it.
pub(crate) struct GradientTarget {
    pub existing: TextureHandle,
    pub target: TextureHandle,
    pub w: u32,
    pub h: u32,
    pub origin: (f32, f32),
    pub selection: Option<TextureHandle>,
}

/// Draw `stops` along `shape`. Returns `false`, having drawn nothing, if
/// one of the textures no longer exists.
pub(crate) fn draw_gradient(engine: &EngineInner, shape: &GradientShape, stops: &[GradientStop], t: &GradientTarget) -> bool {
    let count = stops.len().min(16);
    let mut colors = [[0.0; 4]; 16];
    let mut positions = [0.0; 16];
    for (i, stop) in stops.iter().enumerate().take(16) {
        colors[i] = [stop.r, stop.g, stop.b, stop.a];
        positions[i] = stop.position;
    }
    let has_mask = i32::from(t.selection.is_some());
    let stops = Vec4Array(colors);
    let stop_positions = FloatArray(positions);
    let stop_count = count as i32;
    let tex_size = [t.w as f32, t.h as f32];
    let doc_size = [engine.doc_width as f32, engine.doc_height as f32];
    let layer_offset = [t.origin.0, t.origin.1];
    match *shape {
        GradientShape::Linear { start, end } => finish_gradient(
            engine.pass(&engine.shaders.gradient_linear, GradientLinearParams {
                has_mask,
                start: [start.0, start.1],
                end: [end.0, end.1],
                stops,
                stop_positions,
                stop_count,
                tex_size,
                doc_size,
                layer_offset,
            }),
            t,
        ),
        GradientShape::Radial { center, radius } => finish_gradient(
            engine.pass(&engine.shaders.gradient_radial, GradientRadialParams {
                has_mask,
                center: [center.0, center.1],
                radius,
                stops,
                stop_positions,
                stop_count,
                tex_size,
                doc_size,
                layer_offset,
            }),
            t,
        ),
    }
}

fn finish_gradient<P>(pass: Pass<'_, P>, t: &GradientTarget) -> bool {
    let pass = pass.texture("u_existingTex", t.existing);
    let pass = match t.selection {
        Some(mask) => pass.texture("u_maskTex", mask),
        // Without a selection, point the mask sampler at the source unit so
        // it never aliases a stale unit-1 texture bound to the target FBO.
        None => pass.sampler_unit("u_maskTex", 0),
    };
    pass.viewport(0, 0, t.w as i32, t.h as i32).draw(Target::Texture(t.target))
}

/// CPU-side gradient interpolation
pub fn interpolate_gradient(stops_json: &str, t: f64) -> Vec<u8> {
    let stops: Vec<GradientStop> = match serde_json::from_str(stops_json) {
        Ok(s) => s,
        Err(_) => return vec![0, 0, 0, 255],
    };
    if stops.is_empty() {
        return vec![0, 0, 0, 255];
    }
    let t = t.clamp(0.0, 1.0) as f32;

    // Find surrounding stops
    if t <= stops[0].position {
        let s = &stops[0];
        return vec![
            (s.r * 255.0) as u8,
            (s.g * 255.0) as u8,
            (s.b * 255.0) as u8,
            (s.a * 255.0) as u8,
        ];
    }
    for i in 1..stops.len() {
        if t <= stops[i].position {
            let a = &stops[i - 1];
            let b = &stops[i];
            let seg = if (b.position - a.position).abs() < 0.001 {
                0.0
            } else {
                (t - a.position) / (b.position - a.position)
            };
            let lerp = |x: f32, y: f32| x + (y - x) * seg;
            return vec![
                (lerp(a.r, b.r) * 255.0) as u8,
                (lerp(a.g, b.g) * 255.0) as u8,
                (lerp(a.b, b.b) * 255.0) as u8,
                (lerp(a.a, b.a) * 255.0) as u8,
            ];
        }
    }
    let s = stops.last().unwrap();
    vec![
        (s.r * 255.0) as u8,
        (s.g * 255.0) as u8,
        (s.b * 255.0) as u8,
        (s.a * 255.0) as u8,
    ]
}
