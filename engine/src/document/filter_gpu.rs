use crate::engine::EngineInner;
use crate::gpu::framebuffer::FramebufferHandle;
use crate::gpu::pass::{Pass, Target};
use crate::gpu::read::Read;
use crate::imaging::{Imaging, Scratch, Staged};
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::params::filters::SelectionMaskBlendParams;

/// Blend the filtered result with the original layer texture
/// using the selection mask. Writes the blended result back to the layer texture.
fn blend_with_selection_mask(
    engine: &mut EngineInner,
    layer_id: &str,
    filtered_scratch: TextureHandle,
    original_scratch: TextureHandle,
) {
    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }
    let sel_handle = match engine.selection_mask_texture {
        Some(h) => h,
        None => return,
    };
    if engine.texture_pool.get(sel_handle).is_none() {
        return;
    }

    let (layer_x, layer_y) = engine.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map_or((0.0, 0.0), |l| (l.x as f32, l.y as f32));
    let (doc_w, doc_h) = (engine.doc_width as f32, engine.doc_height as f32);

    engine.pass(&engine.shaders.selection_mask_blend, SelectionMaskBlendParams {
        doc_size: [doc_w, doc_h],
        layer_offset: [layer_x, layer_y],
        layer_size: [w as f32, h as f32],
    })
        .texture("u_filtered", filtered_scratch)
        .texture("u_original", original_scratch)
        .texture("u_selMask", sel_handle)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(tex_handle));
}

/// Copy the layer texture into a scratch buffer using a simple blit.
fn copy_layer_to_scratch(engine: &mut EngineInner, layer_id: &str, scratch_fbo: FramebufferHandle) {
    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }

    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", tex_handle)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(scratch_fbo));
}

/// Blit scratch texture `scratch` over the `w`×`h` texture `dst`.
fn blit_scratch_to(engine: &EngineInner, scratch: TextureHandle, dst: TextureHandle, w: u32, h: u32) {
    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", scratch)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(dst));
}

/// What `begin_mask_filter_target` swapped out, so the end call can put it
/// back.
pub struct MaskFilterTarget {
    layer_id: String,
    layer_texture: Option<TextureHandle>,
    layer_rect: Option<(i32, i32, u32, u32)>,
    mask_origin: (i32, i32),
    mask_size: (u32, u32),
}

/// Point a layer's texture slot (and its descriptor's rect) at the layer's
/// mask, so every filter entry point — which all look the layer up in
/// `layer_textures` — runs on the mask instead (#1150). The filter
/// helpers keep working unchanged: selection blending reads the mask's
/// origin from the descriptor, and preview save/restore follow the slot.
/// Must be paired with `end_mask_filter_target` before the next frame.
/// Returns false (and changes nothing) when the layer has no mask.
pub fn begin_mask_filter_target(engine: &mut EngineInner, layer_id: &str) -> bool {
    end_mask_filter_target(engine);
    let mask_handle = match engine.layer_masks.get(layer_id) {
        Some(&h) => h,
        None => return false,
    };
    let mask_size = engine.texture_pool.get_size(mask_handle).unwrap_or((1, 1));
    let (ox, oy) = crate::document::compositor::mask_doc_origin(engine, layer_id);
    let mask_origin = (ox as i32, oy as i32);

    let layer_texture = engine.layer_textures.insert(layer_id.to_string(), mask_handle);
    let layer_rect = engine.layer_stack.iter_mut().find(|l| l.id == layer_id).map(|l| {
        let rect = (l.x, l.y, l.width, l.height);
        l.x = mask_origin.0;
        l.y = mask_origin.1;
        l.width = mask_size.0;
        l.height = mask_size.1;
        rect
    });
    engine.mask_filter_target = Some(MaskFilterTarget {
        layer_id: layer_id.to_string(),
        layer_texture,
        layer_rect,
        mask_origin,
        mask_size,
    });
    true
}

/// Undo `begin_mask_filter_target`. The filtered mask is folded back to
/// grey (a colour filter's luminance) and, if a filter grew the texture to
/// cover the document, cropped back to the mask's own rect before it is
/// returned to `layer_masks`.
pub fn end_mask_filter_target(engine: &mut EngineInner) {
    let Some(target) = engine.mask_filter_target.take() else { return };
    let id = target.layer_id.as_str();

    // The whole mask, selection or not, grown to the document like any
    // filtered layer.
    apply_filter_inner(engine, id, |im, tex| im.gpu.pass(&im.shaders.mask_luminance, ()).texture("u_tex", tex), false, true);

    let (cur_x, cur_y) = engine.layer_stack.iter()
        .find(|l| l.id == id)
        .map_or(target.mask_origin, |l| (l.x, l.y));
    let cur_size = engine.layer_textures.get(id)
        .and_then(|&h| engine.texture_pool.get_size(h));
    if (cur_x, cur_y) != target.mask_origin || cur_size != Some(target.mask_size) {
        let (mw, mh) = target.mask_size;
        let _ = crate::document::layer_manager::crop_texture(
            engine, id, cur_x, cur_y, target.mask_origin.0, target.mask_origin.1, mw, mh,
        );
    }

    let mask_handle = match target.layer_texture {
        Some(h) => engine.layer_textures.insert(id.to_string(), h),
        None => engine.layer_textures.remove(id),
    };
    if let Some(h) = mask_handle {
        engine.layer_masks.insert(id.to_string(), h);
    }
    if let (Some((x, y, w, h)), Some(layer)) = (
        target.layer_rect,
        engine.layer_stack.iter_mut().find(|l| l.id == id),
    ) {
        layer.x = x;
        layer.y = y;
        layer.width = w;
        layer.height = h;
    }
    engine.mark_layer_dirty(id);
}

/// Apply an imaging operation to a layer: `op` is handed the layer's
/// texture and returns the pass that filters it.
pub fn apply_op<P>(
    engine: &mut EngineInner,
    layer_id: &str,
    op: impl for<'a> FnOnce(Imaging<'a>, TextureHandle) -> Pass<'a, P>,
) {
    apply_filter_inner(engine, layer_id, op, true, true);
}

/// [`apply_op`] for an operation that reads only the texel it writes (a
/// colour matrix), run on the whole layer even when a selection is active:
/// a document-wide change (a colour mode conversion) must not leave part
/// of a layer as it was. The layer keeps its texture origin and size:
/// growing it to the document would re-origin the texture behind the
/// caller's back, and a caller that then pushes the layer's old cropped
/// `x`/`y` draws the content at twice its offset (#1367).
pub fn apply_pointwise_op_full_layer<P>(
    engine: &mut EngineInner,
    layer_id: &str,
    op: impl for<'a> FnOnce(Imaging<'a>, TextureHandle) -> Pass<'a, P>,
) {
    apply_filter_inner(engine, layer_id, op, false, false);
}

/// Apply an imaging operation of several passes to a layer. `op` is handed
/// the layer's texture, its size and the engine's scratch targets, and
/// says which of them it left the result in; that is written back to the
/// layer, through the selection mask when there is one.
pub fn apply_staged(
    engine: &mut EngineInner,
    layer_id: &str,
    op: impl FnOnce(Imaging<'_>, TextureHandle, (u32, u32), Scratch) -> Staged,
) {
    // Scratch targets are sized to the document. See `apply_filter_inner`.
    let _ = engine.ensure_layer_full_size(layer_id);

    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }

    let scratch = engine.scratch();
    let (result, other) = match op(engine.imaging(), tex_handle, (w, h), scratch) {
        Staged::A => (scratch.a, scratch.b),
        Staged::B => (scratch.b, scratch.a),
    };

    if engine.selection_mask_texture.is_some() {
        // The layer still holds the original: save it in the other scratch
        // target and mix the two through the selection mask (#1176).
        copy_layer_to_scratch(engine, layer_id, other.framebuffer);
        blend_with_selection_mask(engine, layer_id, result.texture, other.texture);
    } else {
        blit_scratch_to(engine, result.texture, tex_handle, w, h);
    }

    engine.mark_layer_dirty(layer_id);
}

/// `start_pass` starts the filter's pass with the layer texture it is
/// given bound as `u_tex`.
fn apply_filter_inner<P>(
    engine: &mut EngineInner,
    layer_id: &str,
    start_pass: impl for<'a> FnOnce(Imaging<'a>, TextureHandle) -> Pass<'a, P>,
    respect_selection: bool,
    expand_to_document: bool,
) {
    if expand_to_document {
        // Scratch FBOs are sized to the document. If the layer texture is
        // smaller (e.g. a tiny ellipse on a large canvas), pass-2 sampling
        // would read garbage from the scratch's unwritten region, destroying
        // the filter output. Expanding the layer to at least doc size
        // guarantees the scratch and layer dimensions match.
        let _ = engine.ensure_layer_full_size(layer_id);
    } else {
        // The scratch is blitted back over the whole layer, so it must match
        // the layer texel for texel (see ensure_scratch_size).
        let Some(size) = engine.layer_textures.get(layer_id)
            .and_then(|&h| engine.texture_pool.get_size(h)) else { return };
        if engine.ensure_scratch_size(size.0, size.1).is_err() { return; }
    }

    let has_selection = respect_selection && engine.selection_mask_texture.is_some();

    // If there's a selection, save the original layer to scratch B first
    if has_selection {
        let scratch_fbo_b = engine.scratch_fbo_b;
        copy_layer_to_scratch(engine, layer_id, scratch_fbo_b);
    }

    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }

    // Render the filter into scratch A
    start_pass(engine.imaging(), tex_handle)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));

    if has_selection {
        // Blend filtered (scratch A) with original (scratch B) using selection mask → layer
        let scratch_a = engine.scratch_texture_a;
        let scratch_b = engine.scratch_texture_b;
        blend_with_selection_mask(engine, layer_id, scratch_a, scratch_b);
    } else {
        // Copy result back to layer texture (original path)
        blit_scratch_to(engine, engine.scratch_texture_a, tex_handle, w, h);
    }

    engine.mark_layer_dirty(layer_id);
}

/// GPU-side box-downscaled thumbnail for one channel of a layer texture, as
/// grey (see `thumbnail_gpu`).
///
/// Reads an 8-byte header `[width_u32_le, height_u32_le]` + RGBA pixels.
pub fn read_channel_thumbnail(
    engine: &mut EngineInner,
    layer_id: &str,
    channel: u32,
    max_size: u32,
) -> Read<Vec<u8>> {
    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return Read::ready(Ok(Vec::new())),
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((0, 0));
    if engine.texture_pool.get(tex_handle).is_none() {
        return Read::ready(Ok(Vec::new()));
    }
    crate::document::thumbnail_gpu::read_box_thumbnail(engine, tex_handle, w, h, max_size, channel.min(3) as i32)
}
