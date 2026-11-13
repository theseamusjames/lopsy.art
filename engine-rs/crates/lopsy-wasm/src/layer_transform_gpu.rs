//! Whole-layer transform of several layers at once.
//!
//! The Move tool's float lifts one layer's selected pixels. Transforming
//! several selected layers together needs one lifted source per layer, all
//! re-rendered through the same matrix (or homography) about one shared
//! pivot. Each layer's opaque content is copied once into its own source
//! texture when the gesture starts; every pointer-move then re-renders each
//! source straight into its layer texture, so successive drags resample the
//! original pixels instead of compounding.
//!
//! The session counts as a float for `has_float` / `drop_float`: anything
//! that bakes the Move tool's float before an edit (a history push, another
//! tool's press, undo) ends it too. The layer textures already hold the
//! transformed result, so ending a session only frees the sources.

use lopsy_core::float_growth::grow_rect_to_cover;
use lopsy_core::geometry::Rect;
use lopsy_core::homography;
use crate::engine::EngineInner;
use crate::gpu::pass::{Blend, Pass, Scissor, Target};
use crate::gpu::texture_pool::TextureHandle;

/// One layer taking part in a multi-layer transform.
pub struct LayerTransformSlot {
    pub layer_id: String,
    /// The layer's content at the start of the session, with a transparent
    /// one-texel border so the bilinear edge fades out instead of clamping.
    source: TextureHandle,
    /// Document rect of `source`.
    source_rect: Rect,
    /// Document rect the next render writes (the transformed source bounds).
    target_rect: Rect,
    /// Document rect the last render wrote; None until the first render, which
    /// clears the whole layer texture.
    written_rect: Option<Rect>,
}

/// Where the source pixels go: an affine map about a centre, or the
/// homography taking `orig_rect` onto four corners.
pub enum TransformParams {
    Affine { inv_matrix: [f32; 9], src_center: [f32; 2], dst_center: [f32; 2] },
    Perspective { corners: [f32; 8], orig_rect: [f32; 4] },
}

/// Doc-space placement of the texture a transform samples and of the one it
/// writes.
pub struct TransformTargets {
    pub source: TextureHandle,
    pub source_offset: (f32, f32),
    pub source_size: (f32, f32),
    pub layer_offset: (f32, f32),
    pub layer_size: (f32, f32),
    /// Document rect (x, y, w, h) holding the source's pixels. The affine
    /// shader keeps its bilinear taps inside it and gives axis-aligned edges
    /// exact coverage, so an edge on a whole pixel stays solid (#1466).
    pub content_rect: Option<[f32; 4]>,
}

/// The affine or perspective transform pass with its uniforms. The caller
/// adds the target and draws.
pub fn transform_pass<'a>(engine: &'a EngineInner, params: &TransformParams, t: &TransformTargets) -> Pass<'a> {
    let shader = match params {
        TransformParams::Affine { .. } => &engine.shaders.transform_affine,
        TransformParams::Perspective { .. } => &engine.shaders.transform_perspective,
    };
    let pass = engine.pass_untyped(shader)
        .texture("u_floatTex", t.source)
        .vec2("u_floatSize", t.source_size.0, t.source_size.1)
        .vec2("u_floatOffset", t.source_offset.0, t.source_offset.1)
        .vec2("u_layerOffset", t.layer_offset.0, t.layer_offset.1)
        .vec2("u_layerSize", t.layer_size.0, t.layer_size.1);
    match params {
        TransformParams::Affine { inv_matrix, src_center, dst_center } => {
            let r = t.content_rect.unwrap_or([0.0; 4]);
            pass.vec2("u_srcCenter", src_center[0], src_center[1])
                .vec2("u_dstCenter", dst_center[0], dst_center[1])
                .vec4("u_srcRect", r[0], r[1], r[2], r[3])
                .mat3("u_invMatrix", inv_matrix)
        }
        TransformParams::Perspective { corners, orig_rect } => {
            let corner = |i: usize| [corners[i * 2] as f64, corners[i * 2 + 1] as f64];
            let quad_to_square = homography::invert(&homography::square_to_quad(
                corner(0), corner(1), corner(2), corner(3),
            ))
            .map(|m| homography::to_gl_column_major(&m))
            // Degenerate quad: w = 0 everywhere, so every fragment is rejected.
            .unwrap_or([0.0; 9]);
            pass.mat3("u_quadToSquare", &quad_to_square)
                .vec4("u_origRect", orig_rect[0], orig_rect[1], orig_rect[2], orig_rect[3])
        }
    }
}

fn layer_rect(engine: &EngineInner, layer_id: &str) -> Option<(TextureHandle, Rect)> {
    let handle = *engine.layer_textures.get(layer_id)?;
    let (w, h) = engine.texture_pool.get_size(handle)?;
    let desc = engine.layer_stack.iter().find(|l| l.id == layer_id)?;
    Some((handle, Rect::new(desc.x, desc.y, w, h)))
}

/// Whether `layer_id` takes part in the live multi-layer transform.
pub fn is_in_layer_transform(engine: &EngineInner, layer_id: &str) -> bool {
    engine.layer_transform.iter().any(|s| s.layer_id == layer_id)
}

/// Lift `layer_id`'s content into the session. Returns its document rect, or
/// None for an empty layer (nothing to transform), which is left out.
pub fn begin_layer_transform(engine: &mut EngineInner, layer_id: &str) -> Result<Option<Rect>, String> {
    if let Some(slot) = engine.layer_transform.iter().find(|s| s.layer_id == layer_id) {
        let r = slot.source_rect;
        return Ok(Some(Rect::new(r.x + 1, r.y + 1, r.width - 2, r.height - 2)));
    }
    let (layer_handle, layer) = layer_rect(engine, layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let local = crate::layer_manager::layer_content_bounds(engine, layer_id)?;
    if local.width == 0 || local.height == 0 {
        return Ok(None);
    }
    let content = Rect::new(layer.x + local.x, layer.y + local.y, local.width, local.height);
    let source_rect = Rect::new(content.x - 1, content.y - 1, content.width + 2, content.height + 2);

    engine.texture_pool.get(layer_handle).ok_or("Layer texture not found")?;
    let source = engine.texture_pool.acquire(source_rect.width, source_rect.height)?;
    engine.texture_pool.get(source).ok_or("Source texture not found")?;
    let (off_x, off_y) = (layer.x - source_rect.x, layer.y - source_rect.y);
    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", layer_handle)
        .blend(Blend::Off)
        .clear([0.0, 0.0, 0.0, 0.0])
        // Place the whole layer texture at its offset; GL clips the viewport
        // to the source, leaving the content rect plus its empty border.
        .viewport(off_x, off_y, layer.width as i32, layer.height as i32)
        .draw(Target::Texture(source));

    engine.layer_transform.push(LayerTransformSlot {
        layer_id: layer_id.to_string(),
        source,
        source_rect,
        target_rect: content,
        written_rect: None,
    });
    Ok(Some(content))
}

/// Set where the next render of `layer_id` lands (document rect), growing the
/// layer texture to hold it. Returns the layer's new [x, y, w, h] when it grew.
pub fn prepare_layer_transform_target(
    engine: &mut EngineInner,
    layer_id: &str,
    target: Rect,
) -> Result<Option<[i32; 4]>, String> {
    let (handle, current) = layer_rect(engine, layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let slot = engine.layer_transform.iter_mut().find(|s| s.layer_id == layer_id)
        .ok_or_else(|| format!("Layer {layer_id} is not being transformed"))?;
    slot.target_rect = target;
    let Some(grown) = grow_rect_to_cover(current, target, engine.texture_pool.max_size()) else {
        return Ok(None);
    };

    // The next render rewrites everything inside the texture, so the grown
    // texture starts empty and the old one is not copied.
    let new_handle = engine.texture_pool.acquire(grown.width, grown.height)?;
    engine.texture_pool.get(new_handle).ok_or("Grown layer texture not found")?;
    engine.gpu().clear(new_handle, [0.0, 0.0, 0.0, 0.0]);
    // Each growth size is new; pooling the old one would keep it for good (#1019).
    engine.texture_pool.delete(handle);
    engine.layer_textures.insert(layer_id.to_string(), new_handle);
    if let Some(desc) = engine.layer_stack.iter_mut().find(|l| l.id == layer_id) {
        desc.x = grown.x;
        desc.y = grown.y;
        desc.width = grown.width;
        desc.height = grown.height;
    }
    if let Some(slot) = engine.layer_transform.iter_mut().find(|s| s.layer_id == layer_id) {
        slot.written_rect = Some(Rect::new(grown.x, grown.y, 0, 0));
    }
    engine.mark_layer_dirty(layer_id);
    Ok(Some([grown.x, grown.y, grown.width as i32, grown.height as i32]))
}

/// Re-render every layer in the session through `params`. Each layer's
/// texture is cleared where the previous render wrote and redrawn inside its
/// target rect only.
pub fn composite_layer_transform(engine: &mut EngineInner, params: &TransformParams) -> Result<(), String> {
    let count = engine.layer_transform.len();
    for i in 0..count {
        let slot = &engine.layer_transform[i];
        let layer_id = slot.layer_id.clone();
        let Some((layer_handle, layer)) = layer_rect(engine, &layer_id) else { continue };
        if engine.texture_pool.get(layer_handle).is_none() { continue; }
        let source = slot.source;
        if engine.texture_pool.get(source).is_none() { continue; }
        let source_rect = slot.source_rect;
        let target = slot.target_rect;
        let clear_rect = match slot.written_rect {
            Some(written) => written.union(&target),
            None => layer,
        };

        let to_local = |r: Rect| r.intersect(&layer).map(|r| Rect::new(r.x - layer.x, r.y - layer.y, r.width, r.height));
        if let Some(rect) = to_local(clear_rect) {
            engine.gpu().clear_rect(layer_handle, rect, [0.0, 0.0, 0.0, 0.0]);
        }
        if let Some(rect) = to_local(target) {
            transform_pass(engine, params, &TransformTargets {
                source,
                source_offset: (source_rect.x as f32, source_rect.y as f32),
                source_size: (source_rect.width as f32, source_rect.height as f32),
                layer_offset: (layer.x as f32, layer.y as f32),
                layer_size: (layer.width as f32, layer.height as f32),
                content_rect: Some([
                    (source_rect.x + 1) as f32,
                    (source_rect.y + 1) as f32,
                    source_rect.width.saturating_sub(2) as f32,
                    source_rect.height.saturating_sub(2) as f32,
                ]),
            })
            .blend(Blend::Off)
            .scissor(Scissor::Rect(rect))
            .viewport(0, 0, layer.width as i32, layer.height as i32)
            .draw(Target::Texture(layer_handle));
        }
        engine.layer_transform[i].written_rect = Some(target);
        engine.mark_layer_dirty(&layer_id);
    }
    Ok(())
}

/// Free every source. The layer textures keep what was last rendered.
pub fn end_layer_transform(engine: &mut EngineInner) {
    for slot in std::mem::take(&mut engine.layer_transform) {
        engine.texture_pool.delete(slot.source);
    }
}
