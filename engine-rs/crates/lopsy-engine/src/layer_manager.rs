use lopsy_core::float_growth::grow_rect_to_cover;
use lopsy_core::geometry::Rect;
use lopsy_core::layer::LayerDesc;
use crate::compositor::mask_doc_offset;
use crate::engine::EngineInner;
use crate::gpu::pass::{Blend, Scissor, Target};
use crate::gpu::params::composite::BlendParams;
use crate::gpu::texture_pool::TextureHandle;
use crate::layer_transform_gpu::{TransformDraw, TransformParams, TransformTargets};
use crate::gpu::params::core::{
    BlitRegionParams, ClipboardClearParams, ClipboardCopyParams, FlipParams, MaskRemapParams, Rotate90Params,
    SelectionFillParams,
};
use crate::gpu::uniforms::Mat2;

pub fn add_layer(engine: &mut EngineInner, desc: LayerDesc) -> Result<(), String> {
    // Only create a texture if the layer doesn't already have one.
    // uploadLayerPixels may have already been called for this layer
    // (e.g. cropLayerToContent runs before syncLayers adds the layer).
    if !engine.layer_textures.contains_key(&desc.id) {
        let tex = engine.texture_pool.acquire(1, 1)?;
        engine.layer_textures.insert(desc.id.clone(), tex);
    }
    // Only add to layer_stack if not already present
    if !engine.layer_stack.iter().any(|l| l.id == desc.id) {
        engine.layer_stack.push(desc);
    } else {
        update_layer(engine, desc);
    }
    // Adding a layer invalidates any cached group pre-adjustment scratch:
    // a new child might belong to a group whose composited children were
    // otherwise assumed unchanged. See mark_layer_dirty for the flag.
    engine.needs_recomposite = true;
    engine.groups.pre_adj_valid = false;
    Ok(())
}

pub fn remove_layer(engine: &mut EngineInner, layer_id: &str) {
    if let Some(tex) = engine.layer_textures.remove(layer_id) {
        engine.texture_pool.release(tex);
    }
    if let Some(mask) = engine.layer_masks.remove(layer_id) {
        engine.texture_pool.release(mask);
    }
    crate::effect_cache_gpu::evict_layer(engine, layer_id);
    engine.layer_content_gen.remove(layer_id);
    engine.layer_stack.retain(|l| l.id != layer_id);
    engine.needs_recomposite = true;
    engine.groups.pre_adj_valid = false;
}

pub fn update_layer(engine: &mut EngineInner, desc: LayerDesc) {
    // When a float is active on this layer, the engine has expanded
    // the texture to doc size and updated x/y/width/height to match.
    // Preserve these so that syncLayers (pushing content dimensions
    // from the JS model) doesn't corrupt the expanded texture state.
    // A multi-layer transform re-places its layers' textures the same way.
    let is_float_layer = engine.float.layer_id.as_deref() == Some(desc.id.as_str())
        || crate::layer_transform_gpu::is_in_layer_transform(engine, &desc.id);
    if let Some(existing) = engine.layer_stack.iter_mut().find(|l| l.id == desc.id) {
        if is_float_layer {
            let (px, py, pw, ph) = (existing.x, existing.y, existing.width, existing.height);
            *existing = desc;
            existing.x = px;
            existing.y = py;
            existing.width = pw;
            existing.height = ph;
        } else {
            *existing = desc;
        }
    }
    // #663: any descriptor change (effects, visibility, opacity, blend mode,
    // position, ...) invalidates any cached group pre-adjustment scratch.
    // Without this, a child of a group with adjustments whose descriptor
    // changed reuses stale composited children until the active layer is
    // switched.
    engine.needs_recomposite = true;
    engine.groups.pre_adj_valid = false;
}

pub fn set_layer_order(engine: &mut EngineInner, order: &[String]) {
    let mut new_stack = Vec::with_capacity(order.len());
    for id in order {
        if let Some(pos) = engine.layer_stack.iter().position(|l| l.id == *id) {
            new_stack.push(engine.layer_stack[pos].clone());
        }
    }
    engine.layer_stack = new_stack;
    engine.needs_recomposite = true;
    engine.groups.pre_adj_valid = false;
}

/// Ensure a layer texture exists at the given size, then run a closure to upload data.
fn with_layer_texture<F>(
    engine: &mut EngineInner,
    layer_id: &str,
    width: u32,
    height: u32,
    upload: F,
) -> Result<(), String>
where
    F: FnOnce(&mut EngineInner, crate::gpu::texture_pool::TextureHandle) -> Result<(), String>,
{
    if let Some(&tex_handle) = engine.layer_textures.get(layer_id) {
        let (tw, th) = engine.texture_pool.get_size(tex_handle).unwrap_or((0, 0));
        if tw != width || th != height {
            engine.texture_pool.release(tex_handle);
            let new_tex = engine.texture_pool.acquire(width, height)?;
            engine.layer_textures.insert(layer_id.to_string(), new_tex);
        }
    } else {
        let new_tex = engine.texture_pool.acquire(width, height)?;
        engine.layer_textures.insert(layer_id.to_string(), new_tex);
    }

    if let Some(&tex_handle) = engine.layer_textures.get(layer_id) {
        upload(engine, tex_handle)?;
    }

    engine.mark_layer_dirty(layer_id);
    Ok(())
}

pub fn upload_pixels(
    engine: &mut EngineInner,
    layer_id: &str,
    data: &[u8],
    width: u32,
    height: u32,
    _offset_x: i32,
    _offset_y: i32,
) -> Result<(), String> {
    with_layer_texture(engine, layer_id, width, height, |eng, tex| {
        eng.texture_pool.upload_rgba(tex, 0, 0, width, height, data)
    })
}

/// Upload f32 RGBA pixel data, preserving high-bit-depth precision.
pub fn upload_pixels_f32(
    engine: &mut EngineInner,
    layer_id: &str,
    data: &[f32],
    width: u32,
    height: u32,
) -> Result<(), String> {
    with_layer_texture(engine, layer_id, width, height, |eng, tex| {
        eng.texture_pool.upload_rgba_f32(tex, 0, 0, width, height, data)
    })
}

#[allow(clippy::too_many_arguments)]
pub fn upload_pixels_f32_rect(
    engine: &mut EngineInner,
    layer_id: &str,
    texture_width: u32,
    texture_height: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    data: &[f32],
) -> Result<(), String> {
    if x + width > texture_width || y + height > texture_height {
        return Err(format!(
            "Rect {width}x{height}+{x}+{y} exceeds the {texture_width}x{texture_height} texture"
        ));
    }
    if data.len() != width as usize * height as usize * 4 {
        return Err(format!("Expected {} floats for a {width}x{height} rect, got {}", width as usize * height as usize * 4, data.len()));
    }
    with_layer_texture(engine, layer_id, texture_width, texture_height, |eng, tex| {
        eng.texture_pool.upload_rgba_f32(tex, x as i32, y as i32, width, height, data)
    })
}

/// Upload layer pixels directly from an HtmlCanvasElement, avoiding the
/// getImageData unpremultiply round-trip that causes alpha precision loss.
pub fn upload_pixels_from_canvas(
    engine: &mut EngineInner,
    layer_id: &str,
    canvas: &crate::gpu::ExternalImage,
    width: u32,
    height: u32,
) -> Result<(), String> {
    with_layer_texture(engine, layer_id, width, height, |eng, tex| {
        eng.texture_pool.upload_canvas(tex, canvas, width, height)
    })
}

/// GPU-side texture copy: blit src layer's texture into dst layer's texture
/// using the blit shader. No JS round-trip.
pub fn duplicate_texture(
    engine: &mut EngineInner,
    src_id: &str,
    dst_id: &str,
) -> Result<(), String> {
    let src_handle = *engine.layer_textures.get(src_id)
        .ok_or_else(|| format!("Source layer {src_id} not found"))?;
    let (sw, sh) = engine.texture_pool.get_size(src_handle).unwrap_or((1, 1));

    // Ensure dst texture exists at the right size
    if let Some(&old_dst) = engine.layer_textures.get(dst_id) {
        let (dw, dh) = engine.texture_pool.get_size(old_dst).unwrap_or((0, 0));
        if dw != sw || dh != sh {
            engine.texture_pool.release(old_dst);
            let new_tex = engine.texture_pool.acquire(sw, sh)?;
            engine.layer_textures.insert(dst_id.to_string(), new_tex);
        }
    } else {
        let new_tex = engine.texture_pool.acquire(sw, sh)?;
        engine.layer_textures.insert(dst_id.to_string(), new_tex);
    }

    let dst_handle = *engine.layer_textures.get(dst_id).ok_or("dst layer texture missing")?;

    engine.texture_pool.get(dst_handle).ok_or("Dst texture not found")?;
    engine.texture_pool.get(src_handle).ok_or("Src texture not found")?;

    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", src_handle)
        .viewport(0, 0, sw as i32, sh as i32)
        .draw(Target::Texture(dst_handle));

    engine.mark_layer_dirty(dst_id);
    Ok(())
}

/// GPU-side merge: composite top layer onto bottom layer using the blend shader.
/// The result goes into the bottom layer's texture.
///
/// The top layer is blended against the bottom layer's pixels alone, with
/// its own blend mode, opacity and mask. The bottom layer's blend mode is
/// never baked: it acts against the layers beneath, which are not part of
/// the merge, so it stays on the surviving layer (#1068). Its opacity is
/// baked only when `bake_bottom_opacity` is set — a layer with live effects
/// draws them from its unscaled alpha, so it keeps its opacity instead.
///
/// The result covers the union of the document and both layers' textures,
/// so pixels hanging past a canvas edge survive the merge (#1567). Returns
/// that rectangle as `[x, y, width, height]` in document space.
pub fn merge_layers(
    engine: &mut EngineInner,
    top_id: &str,
    bottom_id: &str,
    bake_bottom_opacity: bool,
) -> Result<[i32; 4], String> {
    let top_handle = *engine.layer_textures.get(top_id)
        .ok_or_else(|| format!("Top layer {top_id} not found"))?;
    let bottom_handle = *engine.layer_textures.get(bottom_id)
        .ok_or_else(|| format!("Bottom layer {bottom_id} not found"))?;
    let (tw, th) = engine.texture_pool.get_size(top_handle).unwrap_or((1, 1));
    let (bw, bh) = engine.texture_pool.get_size(bottom_handle).unwrap_or((1, 1));

    let top_desc = engine.layer_stack.iter().find(|l| l.id == top_id).cloned()
        .ok_or_else(|| format!("Top layer desc {top_id} not found"))?;
    let bottom_desc = engine.layer_stack.iter().find(|l| l.id == bottom_id).cloned()
        .ok_or_else(|| format!("Bottom layer desc {bottom_id} not found"))?;

    engine.texture_pool.get(top_handle).ok_or("Top texture not found")?;
    engine.texture_pool.get(bottom_handle).ok_or("Bottom texture not found")?;

    // Merging bakes the top layer's mask into the composited alpha (its
    // mask disappears along with the layer) but must NOT bake the bottom
    // layer's mask — that mask belongs to the surviving layer and keeps
    // applying to the merged content afterward (matches Photoshop/GIMP).
    let top_mask_info = engine.layer_masks.get(top_id).copied().and_then(|mask_handle| {
        let enabled = top_desc.mask.as_ref().is_some_and(|m| m.enabled);
        if !enabled { return None; }
        let (mw, mh) = engine.texture_pool.get_size(mask_handle)?;
        engine.texture_pool.get(mask_handle)?;
        Some((mask_handle, mw, mh))
    });

    // Merge into a result covering the document plus any overhang of
    // either layer. The blend shader works in "document" space spanning
    // u_docSize from the origin, so the pass feeds it the merge rectangle's
    // size and offsets every position by the rectangle's origin. The
    // scratch buffers are the intermediaries, ping-ponging to avoid
    // read/write feedback on the same texture.
    let (min_x, min_y, max_x, max_y) = merge_rect(
        engine.doc_width, engine.doc_height,
        (top_desc.x, top_desc.y, tw, th),
        (bottom_desc.x, bottom_desc.y, bw, bh),
    );
    let doc_w = (max_x - min_x) as u32;
    let doc_h = (max_y - min_y) as u32;
    engine.ensure_scratch_size(doc_w, doc_h)?;

    // Step 1: clear scratch_b, then blend bottom onto it in doc space
    // (src = bottom, dst = scratch_b cleared → scratch_a).
    engine.gpu().clear(engine.scratch_texture_b, [0.0, 0.0, 0.0, 0.0]);
    engine.texture_pool.get(engine.scratch_texture_b).ok_or("scratch_b not found")?;
    let bottom_opacity = if bake_bottom_opacity { bottom_desc.opacity } else { 1.0 };
    let doc_size = [doc_w as f32, doc_h as f32];
    let bottom_params = BlendParams::plain(
        bottom_opacity,
        [(bottom_desc.x - min_x) as f32, (bottom_desc.y - min_y) as f32],
        [bw as f32, bh as f32],
        doc_size,
        engine.doc_color_mode,
    );
    engine.pass(&engine.shaders.blend_normal, bottom_params)
        .texture("u_srcTex", bottom_handle)
        .texture("u_dstTex", engine.scratch_texture_b)
        .viewport(0, 0, doc_w as i32, doc_h as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));

    // Step 2: blend top onto scratch_a → scratch_b. Scratch B is the
    // target now, so it must not stay bound as step 1's destination input.
    engine.texture_pool.get(engine.scratch_texture_a).ok_or("scratch_a not found")?;
    engine.gpu().unbind_textures(2);
    {
        let shader = engine.shaders.blend_for_mode(top_desc.blend_mode as i32)?;
        let plain = BlendParams::plain(
            top_desc.opacity,
            [(top_desc.x - min_x) as f32, (top_desc.y - min_y) as f32],
            [tw as f32, th as f32],
            doc_size,
            engine.doc_color_mode,
        );
        let params = match top_mask_info {
            Some((_, mask_w, mask_h)) => {
                let (mask_offset_x, mask_offset_y) =
                    mask_doc_offset(top_desc.layer_type, top_desc.x as f32, top_desc.y as f32);
                BlendParams {
                    has_mask: 1,
                    mask_size: [mask_w as f32, mask_h as f32],
                    mask_offset: [mask_offset_x - min_x as f32, mask_offset_y - min_y as f32],
                    ..plain
                }
            }
            None => plain,
        };
        let pass = engine.pass(&shader, params)
            .texture("u_srcTex", top_handle)
            .texture("u_dstTex", engine.scratch_texture_a);
        let pass = match top_mask_info {
            Some((mask, _, _)) => pass.texture("u_maskTex", mask),
            None => pass,
        };
        pass.viewport(0, 0, doc_w as i32, doc_h as i32)
            .draw(Target::Framebuffer(engine.scratch_fbo_b));
    }
    engine.gpu().unbind_textures(3);

    // Step 3: replace bottom texture with doc-sized result from scratch_b
    let new_tex = engine.texture_pool.acquire(doc_w, doc_h)?;
    engine.texture_pool.get(new_tex).ok_or("new texture not found")?;
    engine.texture_pool.get(engine.scratch_texture_b).ok_or("scratch_b not found")?;
    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", engine.scratch_texture_b)
        .draw(Target::Texture(new_tex));

    // Swap the bottom layer's texture to the new doc-sized one
    let old_bottom = engine.layer_textures.insert(bottom_id.to_string(), new_tex);
    if let Some(old) = old_bottom {
        engine.texture_pool.release(old);
    }

    if let Some(layer) = engine.layer_stack.iter_mut().find(|l| l.id == bottom_id) {
        layer.x = min_x;
        layer.y = min_y;
        layer.width = doc_w;
        layer.height = doc_h;
    }

    engine.mark_layer_dirty(bottom_id);
    Ok([min_x, min_y, doc_w as i32, doc_h as i32])
}

/// Union of the document rectangle and two layer rectangles given as
/// `(x, y, width, height)`, returned as `(min_x, min_y, max_x, max_y)`.
pub(crate) fn merge_rect(
    doc_w: u32,
    doc_h: u32,
    a: (i32, i32, u32, u32),
    b: (i32, i32, u32, u32),
) -> (i32, i32, i32, i32) {
    let mut rect = (0, 0, doc_w as i32, doc_h as i32);
    for (x, y, w, h) in [a, b] {
        rect.0 = rect.0.min(x);
        rect.1 = rect.1.min(y);
        rect.2 = rect.2.max(x + w as i32);
        rect.3 = rect.3.max(y + h as i32);
    }
    rect
}

/// GPU-side rotate 90°: render the texture with rotated UV coordinates into
/// a new texture with swapped dimensions.
pub fn rotate_texture_90(
    engine: &mut EngineInner,
    layer_id: &str,
    clockwise: bool,
) -> Result<(), String> {
    let tex_handle = *engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    engine.texture_pool.get(tex_handle).ok_or("Texture not found")?;

    // Rotated dimensions are swapped
    let new_w = h;
    let new_h = w;

    // Allocate a new texture with swapped dimensions
    let new_tex = engine.texture_pool.acquire(new_w, new_h)?;
    engine.texture_pool.get(new_tex).ok_or("New texture not found")?;

    // Render rotated into new texture
    engine.pass(&engine.shaders.rotate90, Rotate90Params { clockwise: i32::from(clockwise) })
        .texture("u_tex", tex_handle)
        .blend(Blend::Off)
        .draw(Target::Texture(new_tex));

    // Replace old texture with new one
    engine.texture_pool.release(tex_handle);
    engine.layer_textures.insert(layer_id.to_string(), new_tex);

    engine.mark_layer_dirty(layer_id);
    Ok(())
}

/// GPU-side scale: resize a layer texture using bilinear filtering.
pub fn scale_texture(
    engine: &mut EngineInner,
    layer_id: &str,
    new_w: u32,
    new_h: u32,
) -> Result<(), String> {
    let tex_handle = *engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    engine.texture_pool.get(tex_handle).ok_or("Texture not found")?;

    // Allocate new texture at target size
    let new_tex = engine.texture_pool.acquire(new_w, new_h)?;
    engine.texture_pool.get(new_tex).ok_or("New texture not found")?;

    // Bilinear resample in premultiplied space (see premul_sample.glsl).
    engine.pass(&engine.shaders.blit_resample, ())
        .texture("u_tex", tex_handle)
        .blend(Blend::Off)
        .draw(Target::Texture(new_tex));

    // Replace old texture
    engine.texture_pool.release(tex_handle);
    engine.layer_textures.insert(layer_id.to_string(), new_tex);

    engine.mark_layer_dirty(layer_id);
    Ok(())
}

/// GPU-side canvas resize: reposition layer pixels within a new canvas size.
pub fn resize_canvas_texture(
    engine: &mut EngineInner,
    layer_id: &str,
    old_layer_x: i32,
    old_layer_y: i32,
    old_w: u32,
    old_h: u32,
    new_w: u32,
    new_h: u32,
    offset_x: i32,
    offset_y: i32,
) -> Result<(), String> {
    let tex_handle = *engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    engine.texture_pool.get(tex_handle).ok_or("Texture not found")?;

    let new_tex = engine.texture_pool.acquire(new_w, new_h)?;
    engine.texture_pool.get(new_tex).ok_or("New texture not found")?;

    // Map output UV to source UV:
    // The layer was at (old_layer_x, old_layer_y) in old doc space.
    // After offset, it's at (old_layer_x + offset_x, old_layer_y + offset_y) in new doc space.
    // src UV = (dst_pixel - (old_layer_x + offset_x)) / old_w in layer-local space.
    // But since the new texture is full canvas: src UV = (dst_uv * new_size - (layer_pos + offset)) / old_size
    let scale_x = new_w as f32 / old_w as f32;
    let scale_y = new_h as f32 / old_h as f32;
    let off_x = -(old_layer_x as f32 + offset_x as f32) / old_w as f32;
    let off_y = -(old_layer_y as f32 + offset_y as f32) / old_h as f32;

    engine.pass(&engine.shaders.blit_region, BlitRegionParams { scale: [scale_x, scale_y], offset: [off_x, off_y] })
        .texture("u_tex", tex_handle)
        .blend(Blend::Off)
        .clear([0.0, 0.0, 0.0, 0.0])
        .draw(Target::Texture(new_tex));

    engine.texture_pool.release(tex_handle);
    engine.layer_textures.insert(layer_id.to_string(), new_tex);

    engine.mark_layer_dirty(layer_id);
    Ok(())
}

/// GPU-side crop: extract a sub-region of a layer texture.
pub fn crop_texture(
    engine: &mut EngineInner,
    layer_id: &str,
    layer_x: i32,
    layer_y: i32,
    crop_x: i32,
    crop_y: i32,
    crop_w: u32,
    crop_h: u32,
) -> Result<(), String> {
    let tex_handle = *engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let (old_w, old_h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    engine.texture_pool.get(tex_handle).ok_or("Texture not found")?;

    let new_tex = engine.texture_pool.acquire(crop_w, crop_h)?;
    engine.texture_pool.get(new_tex).ok_or("New texture not found")?;

    // Map output UV [0,1] over crop region to source UV [0,1] over old texture.
    // output pixel = crop_offset + v_uv * crop_size (in doc space)
    // source pixel in layer space = doc_pixel - layer_offset
    // source UV = (crop_offset + v_uv * crop_size - layer_offset) / old_size
    let scale_x = crop_w as f32 / old_w as f32;
    let scale_y = crop_h as f32 / old_h as f32;
    let off_x = (crop_x - layer_x) as f32 / old_w as f32;
    let off_y = (crop_y - layer_y) as f32 / old_h as f32;

    engine.pass(&engine.shaders.blit_region, BlitRegionParams { scale: [scale_x, scale_y], offset: [off_x, off_y] })
        .texture("u_tex", tex_handle)
        .blend(Blend::Off)
        .clear([0.0, 0.0, 0.0, 0.0])
        .draw(Target::Texture(new_tex));

    engine.texture_pool.release(tex_handle);
    engine.layer_textures.insert(layer_id.to_string(), new_tex);

    engine.mark_layer_dirty(layer_id);
    Ok(())
}

/// GPU-side flip: render the layer texture with flipped UV coordinates.
pub fn flip_texture(
    engine: &mut EngineInner,
    layer_id: &str,
    horizontal: bool,
) -> Result<(), String> {
    let tex_handle = *engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    engine.texture_pool.get(tex_handle).ok_or("Texture not found")?;

    // The copy back is a full-quad blit, so scratch must match the layer
    // exactly; the last composite left it doc-sized (see ensure_scratch_size).
    engine.ensure_scratch_size(w, h)?;

    // Render flipped into scratch_a using the flip shader
    engine.pass(&engine.shaders.flip, FlipParams { flip_h: i32::from(horizontal), flip_v: i32::from(!horizontal) })
        .texture("u_tex", tex_handle)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));

    // Copy scratch_a → layer texture
    engine.texture_pool.get(engine.scratch_texture_a).ok_or("scratch_a not found")?;
    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", engine.scratch_texture_a)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(tex_handle));

    engine.mark_layer_dirty(layer_id);
    Ok(())
}

/// Resample a layer's mask into a new `dst_w` x `dst_h` texture through an
/// affine map from destination to source mask pixels:
/// `src = [a c; b d] * dst + (e, f)`. Canvas operations use it so a mask
/// follows its layer through crop, canvas size, resize, rotate and flip.
/// A layer without a mask is left alone.
pub fn remap_layer_mask(
    engine: &mut EngineInner,
    layer_id: &str,
    dst_w: u32,
    dst_h: u32,
    inverse: [f32; 6],
) -> Result<(), String> {
    let Some(&mask_handle) = engine.layer_masks.get(layer_id) else { return Ok(()) };
    let (src_w, src_h) = engine.texture_pool.get_size(mask_handle).unwrap_or((1, 1));
    engine.texture_pool.get(mask_handle).ok_or("Mask texture not found")?;

    let new_mask = engine.texture_pool.acquire(dst_w, dst_h)?;
    engine.texture_pool.get(new_mask).ok_or("New mask texture not found")?;

    let [a, b, c, d, e, f] = inverse;
    engine.pass(&engine.shaders.mask_remap, MaskRemapParams {
        dst_size: [dst_w as f32, dst_h as f32],
        src_size: [src_w as f32, src_h as f32],
        linear: Mat2([a, b, c, d]),
        offset: [e, f],
    })
        .texture("u_tex", mask_handle)
        .blend(Blend::Off)
        .draw(Target::Texture(new_mask));

    engine.texture_pool.release(mask_handle);
    engine.layer_masks.insert(layer_id.to_string(), new_mask);

    engine.mark_layer_dirty(layer_id);
    Ok(())
}

/// GPU-side clipboard copy: read layer pixels (optionally masked by selection)
/// into a retained clipboard texture. Returns (width, height, offset_x, offset_y).
/// Texture unit for a `u_maskTex` sampler. Uniforms persist on the program,
/// so without a mask unit 1 still holds whatever was bound there last —
/// often a since-released selection mask that the pool has just handed out
/// as this draw's render target. WebGL rejects that as a feedback loop even
/// when `u_hasMask == 0` never samples it, and the draw silently writes
/// nothing (#964). Unit 0 holds the source layer, which is never the target.
fn mask_sampler_unit(has_mask: bool) -> i32 {
    if has_mask { 1 } else { 0 }
}

pub fn clipboard_copy(
    engine: &mut EngineInner,
    layer_id: &str,
    has_selection: bool,
    bounds_x: i32,
    bounds_y: i32,
    bounds_w: u32,
    bounds_h: u32,
) -> Result<(u32, u32, i32, i32), String> {
    let layer_tex_handle = *engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let (lw, lh) = engine.texture_pool.get_size(layer_tex_handle).unwrap_or((1, 1));
    let layer_desc = engine.layer_stack.iter().find(|l| l.id == layer_id)
        .ok_or_else(|| format!("Layer desc {layer_id} not found"))?;
    let layer_x = layer_desc.x as f32;
    let layer_y = layer_desc.y as f32;

    let (out_w, out_h, off_x, off_y) = if has_selection && bounds_w > 0 && bounds_h > 0 {
        (bounds_w, bounds_h, bounds_x, bounds_y)
    } else {
        (lw, lh, layer_desc.x, layer_desc.y)
    };

    // Release old clipboard texture
    if let Some(old) = engine.clipboard.texture.take() {
        engine.texture_pool.release(old);
    }

    // Allocate clipboard texture
    let clip_tex = engine.texture_pool.acquire(out_w, out_h)?;

    engine.texture_pool.get(layer_tex_handle).ok_or("Layer texture not found")?;
    engine.texture_pool.get(clip_tex).ok_or("Clipboard texture not found")?;
    let mask = if has_selection {
        engine.selection_mask_texture.filter(|&m| engine.texture_pool.get(m).is_some())
    } else {
        None
    };

    let pass = engine.pass(&engine.shaders.clipboard_copy, ClipboardCopyParams {
        has_mask: i32::from(mask.is_some()),
        extend_past_canvas: 0,
        layer_offset: [layer_x, layer_y],
        layer_size: [lw as f32, lh as f32],
        bounds_offset: [off_x as f32, off_y as f32],
        bounds_size: [out_w as f32, out_h as f32],
        doc_size: [engine.doc_width as f32, engine.doc_height as f32],
    }).texture("u_layerTex", layer_tex_handle);
    let pass = match mask {
        Some(m) => pass.texture("u_maskTex", m),
        None => pass.sampler_unit("u_maskTex", mask_sampler_unit(false)),
    };
    pass
        .blend(Blend::Off)
        .clear([0.0, 0.0, 0.0, 0.0])
        .draw(Target::Texture(clip_tex));

    engine.clipboard.texture = Some(clip_tex);
    engine.clipboard.width = out_w;
    engine.clipboard.height = out_h;
    engine.clipboard.offset_x = off_x;
    engine.clipboard.offset_y = off_y;

    Ok((out_w, out_h, off_x, off_y))
}

/// GPU-side clear: zero out pixels in the selection area (or entire layer if no selection).
pub fn clipboard_clear_selected(
    engine: &mut EngineInner,
    layer_id: &str,
    has_selection: bool,
) -> Result<(), String> {
    let layer_tex_handle = *engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let (lw, lh) = engine.texture_pool.get_size(layer_tex_handle).unwrap_or((1, 1));
    let layer_desc = engine.layer_stack.iter().find(|l| l.id == layer_id)
        .ok_or_else(|| format!("Layer desc {layer_id} not found"))?;
    let layer_x = layer_desc.x as f32;
    let layer_y = layer_desc.y as f32;

    engine.texture_pool.get(layer_tex_handle).ok_or("Layer texture not found")?;

    let has_mask = has_selection && engine.selection_mask_texture.is_some();
    let mask = if has_mask {
        engine.selection_mask_texture.filter(|&m| engine.texture_pool.get(m).is_some())
    } else {
        None
    };

    let tmp_tex_h = engine.texture_pool.acquire(lw, lh)?;
    engine.texture_pool.get(tmp_tex_h).ok_or("Temp texture not found")?;

    let pass = engine.pass(&engine.shaders.clipboard_clear, ClipboardClearParams {
        has_mask: i32::from(has_mask),
        extend_past_canvas: 0,
        doc_size: [engine.doc_width as f32, engine.doc_height as f32],
        layer_offset: [layer_x, layer_y],
        layer_size: [lw as f32, lh as f32],
    }).texture("u_layerTex", layer_tex_handle);
    let pass = match mask {
        Some(m) => pass.texture("u_maskTex", m),
        None => pass.sampler_unit("u_maskTex", mask_sampler_unit(has_mask)),
    };
    pass
        .blend(Blend::Off)
        .draw(Target::Texture(tmp_tex_h));

    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", tmp_tex_h)
        .viewport(0, 0, lw as i32, lh as i32)
        .draw(Target::Texture(layer_tex_handle));

    engine.texture_pool.release(tmp_tex_h);

    engine.mark_layer_dirty(layer_id);
    Ok(())
}

/// GPU-side clipboard paste: blit clipboard texture to a target layer texture.
pub fn clipboard_paste(
    engine: &mut EngineInner,
    dst_layer_id: &str,
) -> Result<(), String> {
    let clip_tex_handle = engine.clipboard.texture
        .ok_or("No clipboard data")?;
    let clip_w = engine.clipboard.width;
    let clip_h = engine.clipboard.height;

    engine.texture_pool.get(clip_tex_handle).ok_or("Clipboard texture not found")?;

    // Ensure dst layer has a texture of the right size
    if let Some(&old_dst) = engine.layer_textures.get(dst_layer_id) {
        let (dw, dh) = engine.texture_pool.get_size(old_dst).unwrap_or((0, 0));
        if dw != clip_w || dh != clip_h {
            engine.texture_pool.release(old_dst);
            let new_tex = engine.texture_pool.acquire(clip_w, clip_h)?;
            engine.layer_textures.insert(dst_layer_id.to_string(), new_tex);
        }
    } else {
        let new_tex = engine.texture_pool.acquire(clip_w, clip_h)?;
        engine.layer_textures.insert(dst_layer_id.to_string(), new_tex);
    }

    let dst_handle = *engine.layer_textures.get(dst_layer_id).ok_or("dst layer texture missing")?;
    engine.texture_pool.get(dst_handle).ok_or("Dst texture not found")?;

    // Blit clipboard → dst
    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", clip_tex_handle)
        .viewport(0, 0, clip_w as i32, clip_h as i32)
        .draw(Target::Texture(dst_handle));

    engine.mark_layer_dirty(dst_layer_id);
    Ok(())
}

/// Expand a layer's GPU texture to cover at least the full document area,
/// preserving any content that extends beyond the document bounds.
/// Returns [x, y, width, height] of the resulting texture in document space.
/// Used before transform so stretching beyond original content bounds never clips.
pub fn expand_layer_to_doc_size(
    engine: &mut EngineInner,
    layer_id: &str,
) -> Result<[i32; 4], String> {
    let tex_handle = *engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let (lw, lh) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let doc_w = engine.doc_width;
    let doc_h = engine.doc_height;

    let (layer_x, layer_y) = {
        let desc = engine.layer_stack.iter().find(|l| l.id == layer_id)
            .ok_or_else(|| format!("Layer desc {layer_id} not found"))?;
        (desc.x, desc.y)
    };

    let min_x = 0i32.min(layer_x);
    let min_y = 0i32.min(layer_y);
    let max_x = (doc_w as i32).max(layer_x + lw as i32);
    let max_y = (doc_h as i32).max(layer_y + lh as i32);
    let new_w = (max_x - min_x) as u32;
    let new_h = (max_y - min_y) as u32;

    if lw == new_w && lh == new_h && layer_x == min_x && layer_y == min_y {
        return Ok([min_x, min_y, new_w as i32, new_h as i32]);
    }

    engine.texture_pool.get(tex_handle).ok_or("Layer texture not found")?;

    let new_tex = engine.texture_pool.acquire(new_w, new_h)?;
    engine.texture_pool.get(new_tex).ok_or("New texture not found")?;

    engine.pass(&engine.shaders.clipboard_copy, ClipboardCopyParams {
        has_mask: 0,
        extend_past_canvas: 0,
        layer_offset: [layer_x as f32, layer_y as f32],
        layer_size: [lw as f32, lh as f32],
        bounds_offset: [min_x as f32, min_y as f32],
        bounds_size: [new_w as f32, new_h as f32],
        doc_size: [doc_w as f32, doc_h as f32],
    })
        .texture("u_layerTex", tex_handle)
        .sampler_unit("u_maskTex", mask_sampler_unit(false))
        .blend(Blend::Off)
        .clear([0.0, 0.0, 0.0, 0.0])
        .draw(Target::Texture(new_tex));

    engine.texture_pool.release(tex_handle);
    engine.layer_textures.insert(layer_id.to_string(), new_tex);

    if let Some(desc) = engine.layer_stack.iter_mut().find(|l| l.id == layer_id) {
        desc.x = min_x;
        desc.y = min_y;
        desc.width = new_w;
        desc.height = new_h;
    }

    engine.mark_layer_dirty(layer_id);
    Ok([min_x, min_y, new_w as i32, new_h as i32])
}

/// Crop a layer's GPU texture to the bounding box of its non-transparent
/// pixels. Returns [new_x, new_y, new_w, new_h] on success.
/// If the layer is fully transparent, returns [x, y, 0, 0] (no resize).
/// Counterpart to expand_layer_to_doc_size — called when a layer is deactivated.
/// Texture-local content bounds of a layer (width/height 0 when empty).
pub fn layer_content_bounds(
    engine: &mut EngineInner,
    layer_id: &str,
) -> Result<lopsy_core::geometry::Rect, String> {
    let tex_handle = *engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let (tw, th) = engine.texture_pool.get_size(tex_handle).ok_or("Texture not found")?;
    layer_content_rect(engine, layer_id, tex_handle, tw, th)
}

/// Texture-local content bounds of a layer. Reduces on the GPU and reads
/// back `w + h` texels (#1021); falls back to the full readback + CPU scan
/// if the GPU path fails.
fn layer_content_rect(
    engine: &mut EngineInner,
    layer_id: &str,
    tex_handle: crate::gpu::texture_pool::TextureHandle,
    tw: u32,
    th: u32,
) -> Result<lopsy_core::geometry::Rect, String> {
    if engine.texture_pool.get(tex_handle).is_some() {
        if let Ok(rect) = crate::content_bounds_gpu::texture_content_bounds(engine, tex_handle, tw, th) {
            return Ok(rect);
        }
    }
    // read_pixels returns top-down pixels: GL row 0 = image top row (textures
    // are stored with image-top at GL-bottom, matching document space).
    let pixels = read_pixels(engine, layer_id)?;
    Ok(lopsy_core::pixel_buffer::crop_to_content_bounds(&pixels, tw, th).1)
}

pub fn crop_layer_to_content(
    engine: &mut EngineInner,
    layer_id: &str,
) -> Result<[i32; 4], String> {
    let tex_handle = *engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let (tw, th) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));

    let (layer_x, layer_y) = {
        let desc = engine.layer_stack.iter().find(|l| l.id == layer_id)
            .ok_or_else(|| format!("Layer desc {layer_id} not found"))?;
        (desc.x, desc.y)
    };

    let crop_rect = layer_content_rect(engine, layer_id, tex_handle, tw, th)?;

    if crop_rect.width == 0 || crop_rect.height == 0 {
        return Ok([layer_x, layer_y, 0, 0]);
    }

    // Already tight (always the case for a full-canvas layer): re-copying
    // the texture into an identical one would be a full-texture pass for
    // nothing, on every Move grab (#1021).
    if crop_rect.x == 0 && crop_rect.y == 0 && crop_rect.width == tw && crop_rect.height == th {
        if let Some(desc) = engine.layer_stack.iter_mut().find(|l| l.id == layer_id) {
            desc.width = tw;
            desc.height = th;
        }
        return Ok([layer_x, layer_y, tw as i32, th as i32]);
    }

    let cx = crop_rect.x;
    let cy = crop_rect.y;
    let cw = crop_rect.width;
    let ch = crop_rect.height;
    let new_x = layer_x + cx;
    let new_y = layer_y + cy;

    crop_texture(engine, layer_id, layer_x, layer_y, new_x, new_y, cw, ch)?;

    if let Some(desc) = engine.layer_stack.iter_mut().find(|l| l.id == layer_id) {
        desc.x = new_x;
        desc.y = new_y;
        desc.width = cw;
        desc.height = ch;
    }

    engine.mark_layer_dirty(layer_id);
    Ok([new_x, new_y, cw as i32, ch as i32])
}

/// Lift selected pixels from a layer into a floating texture, clearing them
/// from the layer. The float can then be moved and composited at different
/// offsets via `composite_float`.
pub fn float_selection(
    engine: &mut EngineInner,
    layer_id: &str,
) -> Result<[f64; 4], String> {
    // Release any existing float
    drop_float(engine);

    // Expand the layer to doc size before creating the float so that
    // transform/stretch never clips content beyond the original texture bounds.
    // This is a no-op if the layer is already doc-sized.
    let _ = expand_layer_to_doc_size(engine, layer_id);

    let layer_tex_handle = *engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let (lw, lh) = engine.texture_pool.get_size(layer_tex_handle).unwrap_or((1, 1));
    let layer_desc = engine.layer_stack.iter().find(|l| l.id == layer_id)
        .ok_or_else(|| format!("Layer desc {layer_id} not found"))?;
    let layer_x = layer_desc.x;
    let layer_y = layer_desc.y;

    // After expansion, the layer covers at least the full document area.
    // No diagonal padding needed. The float inherits the expanded buffer.
    let (fw, fh, pad_x, pad_y) = (lw, lh, 0u32, 0u32);
    let new_x = layer_x - pad_x as i32;
    let new_y = layer_y - pad_y as i32;

    engine.texture_pool.get(layer_tex_handle).ok_or("Layer texture not found")?;

    let has_mask = engine.selection_mask_texture.is_some();
    let mask = engine.selection_mask_texture.filter(|&m| engine.texture_pool.get(m).is_some());

    // A selection reaching a canvas edge carries on past it here (both
    // passes set `u_extendPastCanvas`), so a shape hanging off that edge is
    // lifted whole instead of leaving its off-canvas strip behind (#1131).
    //
    // 1. Extract selected pixels into float_texture (clipboard_copy shader).
    // For expanded text layers, boundsOffset/boundsSize cover the full fw×fh region;
    // clipboard_copy clips to the original layer area, leaving transparent padding.
    let float_tex = engine.texture_pool.acquire(fw, fh)?;
    engine.texture_pool.get(float_tex).ok_or("Float texture not found")?;
    {
        let pass = engine.pass(&engine.shaders.clipboard_copy, ClipboardCopyParams {
            has_mask: i32::from(has_mask),
            extend_past_canvas: 1,
            layer_offset: [layer_x as f32, layer_y as f32],
            layer_size: [lw as f32, lh as f32],
            // Bounds cover the full fw×fh region (new_x, new_y origin for expanded layers)
            bounds_offset: [new_x as f32, new_y as f32],
            bounds_size: [fw as f32, fh as f32],
            doc_size: [engine.doc_width as f32, engine.doc_height as f32],
        }).texture("u_layerTex", layer_tex_handle);
        let pass = match mask {
            Some(m) => pass.texture("u_maskTex", m),
            None => pass.sampler_unit("u_maskTex", mask_sampler_unit(has_mask)),
        };
        pass
            .blend(Blend::Off)
            .clear([0.0, 0.0, 0.0, 0.0])
            .draw(Target::Texture(float_tex));
    }

    // 2. Create base texture = layer with selected pixels cleared.
    // For expanded text layers, the base is fw×fh: cleared to transparent, with the
    // clipboard_clear result rendered into the center [pad_x, pad_y, lw, lh] sub-region
    // via viewport override so v_uv covers the original lw×lh layer texture correctly.
    let base_tex = engine.texture_pool.acquire(fw, fh)?;
    engine.texture_pool.get(base_tex).ok_or("Base texture not found")?;
    {
        let pass = engine.pass(&engine.shaders.clipboard_clear, ClipboardClearParams {
            has_mask: i32::from(has_mask),
            extend_past_canvas: 1,
            doc_size: [engine.doc_width as f32, engine.doc_height as f32],
            layer_offset: [layer_x as f32, layer_y as f32],
            layer_size: [lw as f32, lh as f32],
        }).texture("u_layerTex", layer_tex_handle);
        let pass = match mask {
            Some(m) => pass.texture("u_maskTex", m),
            None => pass.sampler_unit("u_maskTex", mask_sampler_unit(has_mask)),
        };
        pass
            .blend(Blend::Off)
            // Clear the full fw×fh to transparent, then draw into the
            // center lw×lh sub-region so that clipboard_clear's v_uv [0,1]
            // maps to the original layer texture.
            .clear([0.0, 0.0, 0.0, 0.0])
            .viewport(pad_x as i32, pad_y as i32, lw as i32, lh as i32)
            .draw(Target::Texture(base_tex));
    }

    // 3. For expanded text layers, resize the layer texture to fw×fh (cleared transparent).
    //    The compositor places the texture at (new_x, new_y) in document space; composite_float
    //    writes the actual content (base) into it immediately below.
    if fw != lw || fh != lh {
        let old_handle = engine.layer_textures.remove(layer_id).unwrap_or(layer_tex_handle);
        engine.texture_pool.release(old_handle);
        let new_layer_handle = engine.texture_pool.acquire(fw, fh)?;
        engine.texture_pool.get(new_layer_handle).ok_or("New layer texture not found")?;
        engine.gpu().clear(new_layer_handle, [0.0, 0.0, 0.0, 0.0]);
        engine.layer_textures.insert(layer_id.to_string(), new_layer_handle);

        // Update LayerDesc so the compositor renders at the correct expanded position.
        if let Some(desc) = engine.layer_stack.iter_mut().find(|l| l.id == layer_id) {
            desc.x = new_x;
            desc.y = new_y;
            desc.width = fw;
            desc.height = fh;
        }
    }

    engine.float.texture = Some(float_tex);
    engine.float.base_texture = Some(base_tex);
    engine.float.layer_id = Some(layer_id.to_string());
    engine.float.width = fw;
    engine.float.height = fh;
    engine.float.layer_x = new_x;
    engine.float.layer_y = new_y;

    // Write base to layer immediately (so the display shows selected pixels removed)
    composite_float(engine, 0, 0)?;

    Ok([new_x as f64, new_y as f64, fw as f64, fh as f64])
}

/// Replace the float base texture with a copy of a source texture.
/// Used by option+drag (copy-move): after floatSelection cuts the selected
/// pixels, this restores the base so the original pixels remain visible.
pub fn restore_float_base(
    engine: &mut EngineInner,
    src_id: &str,
) -> Result<(), String> {
    let base_handle = engine.float.base_texture
        .ok_or("No float base")?;
    let src_handle = *engine.layer_textures.get(src_id)
        .ok_or_else(|| format!("Source {src_id} not found"))?;
    engine.texture_pool.get(src_handle).ok_or("Source texture not found")?;
    engine.texture_pool.get(base_handle).ok_or("Base texture not found")?;
    let (bw, bh) = engine.texture_pool.get_size(base_handle).unwrap_or((1, 1));

    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", src_handle)
        .viewport(0, 0, bw as i32, bh as i32)
        .draw(Target::Texture(base_handle));

    Ok(())
}

/// Composite the float texture at (dx, dy) offset onto the base, writing the
/// result to the layer texture. Called on every mousemove.
pub fn composite_float(
    engine: &mut EngineInner,
    dx: i32,
    dy: i32,
) -> Result<(), String> {
    let base_handle = engine.float.base_texture
        .ok_or("No float base")?;
    let float_handle = engine.float.texture
        .ok_or("No float texture")?;
    let layer_id = engine.float.layer_id.clone()
        .ok_or("No float layer ID")?;
    let layer_tex_handle = *engine.layer_textures.get(&layer_id)
        .ok_or("Layer texture not found")?;

    let fw = engine.float.width;
    let fh = engine.float.height;

    engine.texture_pool.get(base_handle).ok_or("Base texture not found")?;
    engine.texture_pool.get(float_handle).ok_or("Float texture not found")?;
    engine.texture_pool.get(layer_tex_handle).ok_or("Layer texture not found")?;

    // Blend float (src, at offset dx/dy) onto base (dst) directly into the layer
    // texture in one pass. base_tex and float_tex are both fw×fh, so v_uv maps
    // correctly without the UV-scale mismatch that doc-sized scratch textures cause.
    let size = [fw as f32, fh as f32];
    engine.pass(&engine.shaders.blend_normal, BlendParams::plain(1.0, [dx as f32, dy as f32], size, size, engine.doc_color_mode))
        .texture("u_srcTex", float_handle)
        .texture("u_dstTex", base_handle)
        .sampler_unit("u_maskTex", mask_sampler_unit(false))
        .blend(Blend::Off)
        .viewport(0, 0, fw as i32, fh as i32)
        .draw(Target::Texture(layer_tex_handle));
    engine.gpu().unbind_textures(2);

    engine.mark_layer_dirty(&layer_id);
    Ok(())
}

/// Release float textures and reset transform state.
pub fn drop_float(engine: &mut EngineInner) {
    // A float that outgrew the canvas has a size nothing else will ask the
    // pool for; pooling it would keep it alive for good (#1019).
    let doc_size = (engine.doc_width, engine.doc_height);
    for tex in [engine.float.texture.take(), engine.float.base_texture.take()].into_iter().flatten() {
        if engine.texture_pool.get_size(tex) == Some(doc_size) {
            engine.texture_pool.release(tex);
        } else {
            engine.texture_pool.delete(tex);
        }
    }
    engine.float.layer_id = None;
    engine.float.transform_mode = 0;
    crate::layer_transform_gpu::end_layer_transform(engine);
}

/// Copy `src` (src_w×src_h) into a freshly acquired, transparent dst_w×dst_h
/// texture with its top-left at (off_x, off_y). Returns the new handle.
pub(crate) fn copy_into_larger_texture(
    engine: &mut EngineInner,
    src_handle: TextureHandle,
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
    off_x: i32,
    off_y: i32,
) -> Result<TextureHandle, String> {
    engine.texture_pool.get(src_handle).ok_or("Source texture not found")?;
    let dst_handle = engine.texture_pool.acquire(dst_w, dst_h)?;
    engine.texture_pool.get(dst_handle).ok_or("Destination texture not found")?;
    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", src_handle)
        .blend(Blend::Off)
        .clear([0.0, 0.0, 0.0, 0.0])
        .viewport(off_x, off_y, src_w as i32, src_h as i32)
        .draw(Target::Texture(dst_handle));
    Ok(dst_handle)
}

/// Grow the active float — its lifted pixels, its base, and the layer texture
/// it composites into — so the float's buffer covers the document-space rect
/// (x, y, w, h) as well as everything it already covers.
///
/// The float buffer starts as the union of the canvas and the layer's content.
/// A rotate or scale can carry pixels past that (a wide bar near the bottom
/// edge turned upright), and composite_float_transformed only writes inside
/// the fw×fh buffer, so those pixels were silently cut off and lost for good
/// when the float was dropped (#818). Callers pass the transformed content
/// bounds before compositing.
///
/// Returns the layer's new [x, y, w, h], or None when no growth was needed.
pub fn ensure_float_covers(
    engine: &mut EngineInner,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
) -> Result<Option<[i32; 4]>, String> {
    let layer_id = engine.float.layer_id.clone().ok_or("No float layer ID")?;
    let float_handle = engine.float.texture.ok_or("No float texture")?;
    let base_handle = engine.float.base_texture.ok_or("No float base")?;
    let layer_handle = *engine.layer_textures.get(&layer_id)
        .ok_or("Layer texture not found")?;

    let (fx, fy, fw, fh) = (engine.float.layer_x, engine.float.layer_y, engine.float.width, engine.float.height);
    let current = Rect { x: fx, y: fy, width: fw, height: fh };
    let requested = Rect { x, y, width: w, height: h };
    let Some(grown) = grow_rect_to_cover(current, requested, engine.texture_pool.max_size()) else {
        return Ok(None);
    };
    let Rect { x: min_x, y: min_y, width: new_w, height: new_h } = grown;

    let off_x = fx - min_x;
    let off_y = fy - min_y;
    let new_float = copy_into_larger_texture(engine, float_handle, fw, fh, new_w, new_h, off_x, off_y)?;
    let new_base = copy_into_larger_texture(engine, base_handle, fw, fh, new_w, new_h, off_x, off_y)?;
    let new_layer = copy_into_larger_texture(engine, layer_handle, fw, fh, new_w, new_h, off_x, off_y)?;

    // Each growth size is new, so pooling the replaced textures would keep
    // them for good (#1019).
    engine.texture_pool.delete(float_handle);
    engine.texture_pool.delete(base_handle);
    engine.texture_pool.delete(layer_handle);
    engine.float.texture = Some(new_float);
    engine.float.base_texture = Some(new_base);
    engine.layer_textures.insert(layer_id.clone(), new_layer);
    engine.float.layer_x = min_x;
    engine.float.layer_y = min_y;
    engine.float.width = new_w;
    engine.float.height = new_h;
    if let Some(desc) = engine.layer_stack.iter_mut().find(|l| l.id == layer_id) {
        desc.x = min_x;
        desc.y = min_y;
        desc.width = new_w;
        desc.height = new_h;
    }

    engine.mark_layer_dirty(&layer_id);
    Ok(Some([min_x, min_y, new_w as i32, new_h as i32]))
}

/// Flip the float texture in-place and composite onto the layer.
/// The flip is applied within the float texture's own coordinate space.
pub fn flip_float(
    engine: &mut EngineInner,
    horizontal: bool,
) -> Result<(), String> {
    let float_handle = engine.float.texture
        .ok_or("No float texture")?;
    let fw = engine.float.width;
    let fh = engine.float.height;

    engine.texture_pool.get(float_handle).ok_or("Float texture not found")?;

    // Render into scratch_a
    // Full-quad blit back below: scratch must match the float exactly.
    engine.ensure_scratch_size(fw, fh)?;
    engine.pass(&engine.shaders.flip, FlipParams { flip_h: i32::from(horizontal), flip_v: i32::from(!horizontal) })
        .texture("u_tex", float_handle)
        .blend(Blend::Off)
        .viewport(0, 0, fw as i32, fh as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));

    // Copy scratch_a back to float texture
    engine.texture_pool.get(engine.scratch_texture_a).ok_or("scratch_a not found")?;
    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", engine.scratch_texture_a)
        .viewport(0, 0, fw as i32, fh as i32)
        .draw(Target::Texture(float_handle));

    // Composite flipped float onto base → layer texture
    composite_float(engine, 0, 0)
}

/// Rotate the float texture 90° in-place and composite onto the layer.
pub fn rotate_float_90(
    engine: &mut EngineInner,
    clockwise: bool,
) -> Result<(), String> {
    let float_handle = engine.float.texture
        .ok_or("No float texture")?;
    let fw = engine.float.width;
    let fh = engine.float.height;

    engine.texture_pool.get(float_handle).ok_or("Float texture not found")?;

    // Render into scratch_a
    // Full-quad blit back below: scratch must match the float exactly.
    engine.ensure_scratch_size(fw, fh)?;
    engine.pass(&engine.shaders.rotate90, Rotate90Params { clockwise: i32::from(clockwise) })
        .texture("u_tex", float_handle)
        .blend(Blend::Off)
        .viewport(0, 0, fw as i32, fh as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));

    // Copy scratch_a back to float texture
    engine.texture_pool.get(engine.scratch_texture_a).ok_or("scratch_a not found")?;
    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", engine.scratch_texture_a)
        .viewport(0, 0, fw as i32, fh as i32)
        .draw(Target::Texture(float_handle));

    // Composite rotated float onto base → layer texture
    composite_float(engine, 0, 0)
}

/// Composite the float texture onto the layer with an affine transform applied.
/// Called on every mousemove during transform drag.
pub fn composite_float_affine(
    engine: &mut EngineInner,
    inv_matrix: &[f32],
    src_center_x: f32,
    src_center_y: f32,
    dst_center_x: f32,
    dst_center_y: f32,
    src_width: f32,
    src_height: f32,
) -> Result<(), String> {
    engine.float.transform_mode = 1;
    if inv_matrix.len() >= 9 {
        engine.float.transform_inv_matrix.copy_from_slice(&inv_matrix[..9]);
    }
    engine.float.transform_center = [src_center_x, src_center_y];
    engine.float.transform_src_rect = [
        src_center_x - src_width / 2.0,
        src_center_y - src_height / 2.0,
        src_width.max(0.0),
        src_height.max(0.0),
    ];
    engine.float.transform_corners[0] = dst_center_x;
    engine.float.transform_corners[1] = dst_center_y;
    composite_float_transformed(engine)
}

/// Composite the float texture onto the layer with a perspective transform.
/// Called on every mousemove during distort/perspective drag.
pub fn composite_float_perspective(
    engine: &mut EngineInner,
    corners: &[f32],
    orig_x: f32,
    orig_y: f32,
    orig_w: f32,
    orig_h: f32,
) -> Result<(), String> {
    engine.float.transform_mode = 2;
    if corners.len() >= 8 {
        engine.float.transform_corners.copy_from_slice(&corners[..8]);
    }
    engine.float.transform_orig_rect = [orig_x, orig_y, orig_w, orig_h];
    composite_float_transformed(engine)
}

/// Internal: render transformed float into the layer texture.
/// Step 1: Render transformed float → fw×fh temp texture (correctly sized)
/// Step 2: Blend temp onto base → layer texture directly
fn composite_float_transformed(
    engine: &mut EngineInner,
) -> Result<(), String> {
    let base_handle = engine.float.base_texture
        .ok_or("No float base")?;
    let float_handle = engine.float.texture
        .ok_or("No float texture")?;
    let layer_id = engine.float.layer_id.clone()
        .ok_or("No float layer ID")?;
    let layer_tex_handle = *engine.layer_textures.get(&layer_id)
        .ok_or("Layer texture not found")?;

    let fw = engine.float.width;
    let fh = engine.float.height;
    let lx = engine.float.layer_x as f32;
    let ly = engine.float.layer_y as f32;

    engine.texture_pool.get(base_handle).ok_or("Base texture not found")?;
    engine.texture_pool.get(float_handle).ok_or("Float texture not found")?;
    engine.texture_pool.get(layer_tex_handle).ok_or("Layer texture not found")?;

    // Allocate a fw×fh temp texture for the transformed float result. Using
    // doc-sized scratch textures here causes a UV-scale mismatch: the scratch
    // texture is 800×600 but only fw×fh pixels are written (viewport clip),
    // so reading it back with v_uv=[0,1] samples the wrong region and leaks
    // stale compositor content into the layer texture.
    let tmp = engine.texture_pool.acquire(fw, fh)?;
    engine.texture_pool.get(tmp).ok_or("Tmp texture not found")?;
    let src_rect = engine.float.transform_src_rect;
    let params = if engine.float.transform_mode == 1 {
        TransformParams::Affine {
            inv_matrix: engine.float.transform_inv_matrix,
            src_center: engine.float.transform_center,
            dst_center: [engine.float.transform_corners[0], engine.float.transform_corners[1]],
        }
    } else {
        TransformParams::Perspective {
            corners: engine.float.transform_corners,
            orig_rect: engine.float.transform_orig_rect,
        }
    };

    // Step 1: Render transformed float → tmp (fw×fh, correctly sized).
    // The transform shaders filter bilinearly in premultiplied space via
    // texelFetch, so the float texture's own filter mode doesn't matter.
    crate::layer_transform_gpu::draw_transform(engine, &params, &TransformTargets {
        source: float_handle,
        source_offset: (lx, ly),
        source_size: (fw as f32, fh as f32),
        layer_offset: (lx, ly),
        layer_size: (fw as f32, fh as f32),
        content_rect: Some(src_rect),
    }, &TransformDraw {
        target: tmp,
        scissor: Scissor::Off,
        viewport: None,
        clear: Some([0.0, 0.0, 0.0, 0.0]),
    });

    // Step 2: Blend tmp (transformed float, fw×fh) onto base → layer texture.
    // Both tmp and base_tex are fw×fh, so v_uv correctly addresses them.
    let size = [fw as f32, fh as f32];
    engine.pass(&engine.shaders.blend_normal, BlendParams::plain(1.0, [0.0, 0.0], size, size, engine.doc_color_mode))
        .texture("u_srcTex", tmp)
        .texture("u_dstTex", base_handle)
        .sampler_unit("u_maskTex", mask_sampler_unit(false))
        .viewport(0, 0, fw as i32, fh as i32)
        .draw(Target::Texture(layer_tex_handle));
    engine.gpu().unbind_textures(2);

    engine.texture_pool.release(tmp);

    engine.mark_layer_dirty(&layer_id);
    Ok(())
}

/// GPU-side fill: fill a layer with a solid color, masked by the engine's
/// selection mask if present.
pub fn fill_with_color(
    engine: &mut EngineInner,
    layer_id: &str,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
) -> Result<(), String> {
    // #765: expand the layer's texture to the doc union before filling.
    // Without this, a fresh layer whose GPU texture is still the lazy 1x1
    // placeholder only takes a single pixel of the fill — and worse, that
    // pixel samples stale scratch-FBO content, not the requested colour.
    let _ = engine.ensure_layer_full_size(layer_id);

    let layer_tex_handle = *engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let layer_desc = engine.layer_stack.iter().find(|l| l.id == layer_id)
        .ok_or_else(|| format!("Layer desc {layer_id} not found"))?;
    let origin = (layer_desc.x as f32, layer_desc.y as f32);

    fill_texture_in_selection(engine, layer_tex_handle, origin, [r, g, b, a])?;
    engine.mark_layer_dirty(layer_id);
    Ok(())
}

/// Replace a layer's pixels with a solid color everywhere except `hole`
/// (document space), which is left transparent. Ignores the selection: a
/// border is drawn against the canvas, not whatever happens to be selected.
pub fn fill_layer_frame(
    engine: &mut EngineInner,
    layer_id: &str,
    color: [f32; 4],
    hole: Option<Rect>,
) -> Result<(), String> {
    let _ = engine.ensure_layer_full_size(layer_id);

    let layer_tex_handle = *engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let (origin_x, origin_y) = engine.layer_stack.iter().find(|l| l.id == layer_id)
        .map(|l| (l.x, l.y))
        .ok_or_else(|| format!("Layer desc {layer_id} not found"))?;
    let (tw, th) = engine.texture_pool.get_size(layer_tex_handle).unwrap_or((1, 1));
    engine.texture_pool.get(layer_tex_handle).ok_or("Layer texture not found")?;

    let texture_hole = hole
        .map(|r| Rect::new(r.x - origin_x, r.y - origin_y, r.width, r.height))
        .and_then(|r| r.intersect(&Rect::new(0, 0, tw, th)));

    engine.gpu().clear(layer_tex_handle, color);
    if let Some(r) = texture_hole {
        engine.gpu().clear_rect(layer_tex_handle, r, [0.0, 0.0, 0.0, 0.0]);
    }

    engine.mark_layer_dirty(layer_id);
    Ok(())
}

/// GPU-side fill of a layer's mask with a grey `value` (0 = hide,
/// 1 = reveal), limited to the selection when one is active (#1034).
pub fn fill_mask_with_value(
    engine: &mut EngineInner,
    layer_id: &str,
    value: f32,
) -> Result<(), String> {
    let mask_handle = *engine.layer_masks.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} has no mask"))?;
    let origin = crate::compositor::mask_doc_origin(engine, layer_id);
    let v = value.clamp(0.0, 1.0);
    fill_texture_in_selection(engine, mask_handle, origin, [v, v, v, 1.0])?;
    engine.mark_layer_dirty(layer_id);
    Ok(())
}

/// Composite `color` over the texture `target_handle`, whose texel (0, 0)
/// sits at `origin` in document space, weighted by the selection mask.
fn fill_texture_in_selection(
    engine: &mut EngineInner,
    target_handle: TextureHandle,
    origin: (f32, f32),
    color: [f32; 4],
) -> Result<(), String> {
    let (tw, th) = engine.texture_pool.get_size(target_handle).unwrap_or((1, 1));
    engine.texture_pool.get(target_handle).ok_or("Target texture not found")?;

    // The copy back below is a full-quad blit, so scratch must match the
    // target exactly (see ensure_scratch_size).
    engine.ensure_scratch_size(tw, th)?;

    let has_mask = engine.selection_mask_texture.is_some();
    let mask = engine.selection_mask_texture.filter(|&m| engine.texture_pool.get(m).is_some());

    // Render filled result into scratch_a
    let [r, g, b, a] = color;
    let pass = engine.pass(&engine.shaders.selection_fill, SelectionFillParams {
        has_mask: i32::from(has_mask),
        fill_color: [r, g, b, a],
        doc_size: [engine.doc_width as f32, engine.doc_height as f32],
        layer_offset: [origin.0, origin.1],
        layer_size: [tw as f32, th as f32],
    }).texture("u_layerTex", target_handle);
    let pass = match mask {
        Some(m) => pass.texture("u_maskTex", m),
        None => pass.sampler_unit("u_maskTex", mask_sampler_unit(has_mask)),
    };
    pass
        .blend(Blend::Off)
        .viewport(0, 0, tw as i32, th as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));

    // Copy scratch_a → target texture
    engine.texture_pool.get(engine.scratch_texture_a).ok_or("scratch_a not found")?;
    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", engine.scratch_texture_a)
        .viewport(0, 0, tw as i32, th as i32)
        .draw(Target::Texture(target_handle));
    Ok(())
}

pub fn read_pixels_u16(
    engine: &EngineInner,
    layer_id: &str,
) -> Result<Vec<u16>, String> {
    let tex_handle = engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let (w, h) = engine.texture_pool.get_size(*tex_handle).unwrap_or((0, 0));
    engine.texture_pool.get(*tex_handle).ok_or("Texture not found")?;

    engine.gpu().read_rgba_u16(*tex_handle, 0, 0, w, h)
}

pub fn upload_pixels_u16(
    engine: &mut EngineInner,
    layer_id: &str,
    data: &[u16],
    width: u32,
    height: u32,
) -> Result<(), String> {
    with_layer_texture(engine, layer_id, width, height, |eng, tex| {
        eng.texture_pool.upload_rgba_u16(tex, 0, 0, width, height, data)
    })
}

pub fn read_pixels(
    engine: &EngineInner,
    layer_id: &str,
) -> Result<Vec<u8>, String> {
    let tex_handle = engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let (w, h) = engine.texture_pool.get_size(*tex_handle).unwrap_or((0, 0));
    engine.texture_pool.get(*tex_handle).ok_or("Texture not found")?;

    engine.gpu().read_rgba(*tex_handle, 0, 0, w, h)
}

pub fn upload_clipboard_pixels(
    engine: &mut EngineInner,
    data: &[u8],
    width: u32,
    height: u32,
    offset_x: i32,
    offset_y: i32,
) -> Result<(), String> {
    if let Some(old) = engine.clipboard.texture.take() {
        engine.texture_pool.release(old);
    }
    let tex = engine.texture_pool.acquire(width, height)?;
    engine.texture_pool.upload_rgba(tex, 0, 0, width, height, data)?;
    engine.clipboard.texture = Some(tex);
    engine.clipboard.width = width;
    engine.clipboard.height = height;
    engine.clipboard.offset_x = offset_x;
    engine.clipboard.offset_y = offset_y;
    Ok(())
}

pub fn read_clipboard_pixels(engine: &EngineInner) -> Result<Vec<u8>, String> {
    let tex_handle = engine.clipboard.texture
        .ok_or("No clipboard texture")?;
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((0, 0));
    engine.texture_pool.get(tex_handle).ok_or("Clipboard texture not found")?;

    engine.gpu().read_rgba(tex_handle, 0, 0, w, h)
}

// ============================================================
// GPU snapshot store — shared by layer and mask undo snapshots
// ============================================================

/// Sentinel returned when there is nothing to snapshot.
pub const EMPTY_SNAPSHOT: u32 = u32::MAX;

fn blit_texture(engine: &EngineInner, src: TextureHandle, dst: TextureHandle, w: u32, h: u32) {
    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", src)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(dst));
}

/// Blit `src_handle` into a freshly pooled texture and register it in the
/// snapshot store. Returns the snapshot id, or `EMPTY_SNAPSHOT` when the
/// source is empty or allocation fails.
pub fn snapshot_texture(engine: &mut EngineInner, src_handle: TextureHandle) -> u32 {
    let (w, h) = engine.texture_pool.get_size(src_handle).unwrap_or((0, 0));
    if w == 0 || h == 0 {
        return EMPTY_SNAPSHOT;
    }
    let dst_handle = match engine.texture_pool.acquire(w, h) {
        Ok(h) => h,
        Err(_) => return EMPTY_SNAPSHOT,
    };
    if engine.texture_pool.get(dst_handle).is_none() || engine.texture_pool.get(src_handle).is_none() {
        engine.texture_pool.release(dst_handle);
        return EMPTY_SNAPSHOT;
    }
    blit_texture(engine, src_handle, dst_handle, w, h);

    let snap = crate::engine::SnapshotTexture { handle: dst_handle, width: w, height: h };
    if let Some(free_id) = engine.snapshot_free_list.pop() {
        engine.snapshot_textures[free_id as usize] = Some(snap);
        free_id
    } else {
        let id = engine.snapshot_textures.len() as u32;
        engine.snapshot_textures.push(Some(snap));
        id
    }
}

/// Blit snapshot `snap_id` into `existing`, re-acquiring a texture at the
/// snapshot's size when the dimensions differ. Returns the handle that now
/// holds the restored content so the caller can store it back in its map.
fn restore_snapshot_into(
    engine: &mut EngineInner,
    existing: Option<TextureHandle>,
    snap_id: u32,
) -> Result<TextureHandle, String> {
    let snap = engine.snapshot_textures.get(snap_id as usize)
        .and_then(|s| s.as_ref())
        .ok_or_else(|| "Invalid snapshot handle".to_string())?;
    let (sw, sh, snap_handle) = (snap.width, snap.height, snap.handle);

    let dst_handle = match existing {
        Some(h) if engine.texture_pool.get_size(h) == Some((sw, sh)) => h,
        Some(h) => {
            engine.texture_pool.release(h);
            engine.texture_pool.acquire(sw, sh)?
        }
        None => engine.texture_pool.acquire(sw, sh)?,
    };

    engine.texture_pool.get(dst_handle).ok_or_else(|| "Dst texture not found".to_string())?;
    engine.texture_pool.get(snap_handle).ok_or_else(|| "Snapshot texture not found".to_string())?;
    blit_texture(engine, snap_handle, dst_handle, sw, sh);
    Ok(dst_handle)
}

/// Snapshot a layer's pixel texture into the snapshot store.
pub fn snapshot_layer(engine: &mut EngineInner, layer_id: &str) -> u32 {
    match engine.layer_textures.get(layer_id) {
        Some(&h) => snapshot_texture(engine, h),
        None => EMPTY_SNAPSHOT,
    }
}

/// Restore a layer's pixel texture from a snapshot.
pub fn restore_layer_from_snapshot(engine: &mut EngineInner, layer_id: &str, snap_id: u32) -> Result<(), String> {
    let existing = engine.layer_textures.get(layer_id).copied();
    let handle = restore_snapshot_into(engine, existing, snap_id)?;
    engine.layer_textures.insert(layer_id.to_string(), handle);
    engine.mark_layer_dirty(layer_id);
    Ok(())
}

/// Snapshot a layer's mask texture into the snapshot store (GPU→GPU blit,
/// no readback). Returns `EMPTY_SNAPSHOT` when the layer has no mask on
/// the engine.
pub fn snapshot_mask(engine: &mut EngineInner, layer_id: &str) -> u32 {
    match engine.layer_masks.get(layer_id) {
        Some(&h) => snapshot_texture(engine, h),
        None => EMPTY_SNAPSHOT,
    }
}

/// Restore a layer's mask texture from a snapshot, creating the mask
/// texture when the layer has none on the engine.
pub fn restore_mask_from_snapshot(engine: &mut EngineInner, layer_id: &str, snap_id: u32) -> Result<(), String> {
    let existing = engine.layer_masks.get(layer_id).copied();
    let handle = restore_snapshot_into(engine, existing, snap_id)?;
    engine.layer_masks.insert(layer_id.to_string(), handle);
    engine.mark_layer_dirty(layer_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::merge_rect;

    #[test]
    fn merge_rect_is_the_document_when_both_layers_fit() {
        assert_eq!(merge_rect(600, 400, (0, 0, 600, 400), (60, 60, 100, 100)), (0, 0, 600, 400));
    }

    #[test]
    fn merge_rect_keeps_overhang_past_any_edge() {
        assert_eq!(merge_rect(600, 400, (-90, 0, 600, 400), (150, -20, 600, 450)), (-90, -20, 750, 430));
    }
}
