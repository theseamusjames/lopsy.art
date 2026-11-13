use crate::engine::EngineInner;
use crate::gpu::framebuffer::FramebufferHandle;
use crate::gpu::pass::{Pass, Target};
use crate::gpu::shader::ShaderProgram;
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::uniforms::Uniforms;
use crate::gpu::params::filters::{ChannelExtractParams, PixelateBlocksParams, PixelateParams, SelectionMaskBlendParams};

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
    let (ox, oy) = crate::compositor::mask_doc_origin(engine, layer_id);
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

    apply_filter_full_layer(engine, id, |e| &e.shaders.mask_luminance, ());

    let (cur_x, cur_y) = engine.layer_stack.iter()
        .find(|l| l.id == id)
        .map_or(target.mask_origin, |l| (l.x, l.y));
    let cur_size = engine.layer_textures.get(id)
        .and_then(|&h| engine.texture_pool.get_size(h));
    if (cur_x, cur_y) != target.mask_origin || cur_size != Some(target.mask_size) {
        let (mw, mh) = target.mask_size;
        let _ = crate::layer_manager::crop_texture(
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

/// Write a filter result that a multi-pass filter left in scratch A back
/// into the layer. With a selection active the untouched layer is copied
/// into scratch B and the two are mixed through the selection mask, as
/// `apply_filter` does; otherwise scratch A is blitted over the layer.
/// Scratch B is overwritten, so callers must be done with it.
pub(crate) fn commit_scratch_a_to_layer(engine: &mut EngineInner, layer_id: &str) {
    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }

    if engine.selection_mask_texture.is_some() {
        let scratch_fbo_b = engine.scratch_fbo_b;
        copy_layer_to_scratch(engine, layer_id, scratch_fbo_b);
        let scratch_a = engine.scratch_texture_a;
        let scratch_b = engine.scratch_texture_b;
        blend_with_selection_mask(engine, layer_id, scratch_a, scratch_b);
    } else {
        blit_scratch_to(engine, engine.scratch_texture_a, tex_handle, w, h);
    }

    engine.mark_layer_dirty(layer_id);
}

/// Apply a shader program to a layer's texture (read from layer, render to scratch, copy back),
/// with the layer bound as `u_tex` and `params` as the shader's uniforms.
///
/// `get_shader` is called lazily to borrow the shader from the engine — this lets callers
/// pass e.g. `|e| &e.shaders.noise` without fighting the borrow checker.
pub fn apply_filter<P: Uniforms>(
    engine: &mut EngineInner,
    layer_id: &str,
    get_shader: impl Fn(&EngineInner) -> &ShaderProgram<P>,
    params: P,
) {
    apply_filter_inner(engine, layer_id, |e, tex| e.pass(get_shader(e), params).texture("u_tex", tex), true, true);
}

/// [`apply_filter`] for a shader whose uniforms are still set by name:
/// `set_uniforms` receives the filter's pass, with the layer already bound
/// as `u_tex`, and adds the filter's own uniforms and textures to it.
pub fn apply_filter_untyped(
    engine: &mut EngineInner,
    layer_id: &str,
    get_shader: impl Fn(&EngineInner) -> &ShaderProgram,
    set_uniforms: impl for<'a> FnOnce(Pass<'a>) -> Pass<'a>,
) {
    apply_filter_inner(engine, layer_id, |e, tex| set_uniforms(e.pass_untyped(get_shader(e)).texture("u_tex", tex)), true, true);
}

/// [`apply_filter`] for a shader that samples a second texture through
/// `sampler`. With no texture to give it, the sampler is pointed at the
/// unit after the layer's with nothing bound.
pub fn apply_filter_with_texture<P: Uniforms>(
    engine: &mut EngineInner,
    layer_id: &str,
    get_shader: impl Fn(&EngineInner) -> &ShaderProgram<P>,
    params: P,
    sampler: &str,
    texture: Option<TextureHandle>,
) {
    apply_filter_inner(
        engine,
        layer_id,
        |e, tex| {
            let pass = e.pass(get_shader(e), params).texture("u_tex", tex);
            match texture {
                Some(texture) => pass.texture(sampler, texture),
                None => pass.sampler_unit(sampler, 1),
            }
        },
        true,
        true,
    );
}

/// Like `apply_filter`, but always transforms the whole layer even when a
/// selection is active. Document-wide operations (color mode conversion) must
/// not leave part of a layer in the old color space.
pub fn apply_filter_full_layer<P: Uniforms>(
    engine: &mut EngineInner,
    layer_id: &str,
    get_shader: impl Fn(&EngineInner) -> &ShaderProgram<P>,
    params: P,
) {
    apply_filter_inner(engine, layer_id, |e, tex| e.pass(get_shader(e), params).texture("u_tex", tex), false, true);
}

/// Like `apply_filter_full_layer`, for shaders that read only the texel
/// they write (colour matrices). The layer keeps its texture origin and
/// size: growing it to the document would re-origin the texture behind the
/// caller's back, and a caller that then pushes the layer's old cropped
/// `x`/`y` draws the content at twice its offset (#1367).
pub fn apply_pointwise_filter_full_layer<P: Uniforms>(
    engine: &mut EngineInner,
    layer_id: &str,
    get_shader: impl Fn(&EngineInner) -> &ShaderProgram<P>,
    params: P,
) {
    apply_filter_inner(engine, layer_id, |e, tex| e.pass(get_shader(e), params).texture("u_tex", tex), false, false);
}

/// `start_pass` starts the filter's pass with the layer texture it is
/// given bound as `u_tex`.
fn apply_filter_inner<P>(
    engine: &mut EngineInner,
    layer_id: &str,
    start_pass: impl for<'a> FnOnce(&'a EngineInner, TextureHandle) -> Pass<'a, P>,
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
    start_pass(engine, tex_handle)
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

/// Two-pass separable blur (horizontal then vertical). `params` gives the
/// shader's uniforms for a blur along the direction it is handed.
/// Used for both Gaussian and box blur.
pub fn apply_separable_blur<P: Uniforms>(
    engine: &mut EngineInner,
    layer_id: &str,
    get_shader: impl Fn(&EngineInner) -> &ShaderProgram<P>,
    params: impl Fn([f32; 2]) -> P,
) {
    // See note in apply_filter: ensure layer/scratch dimensions match so
    // pass 2 doesn't sample garbage outside the layer's sub-region.
    let _ = engine.ensure_layer_full_size(layer_id);

    let has_selection = engine.selection_mask_texture.is_some();

    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }

    // Pass 1: horizontal (layer -> scratch A)
    engine.pass(get_shader(engine), params([1.0, 0.0]))
        .texture("u_tex", tex_handle)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));

    // Pass 2: vertical (scratch A -> scratch B)
    engine.pass(get_shader(engine), params([0.0, 1.0]))
        .texture("u_tex", engine.scratch_texture_a)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_b));

    commit_scratch_b(engine, layer_id, tex_handle, w, h, has_selection);
}

/// Write a filter result held in scratch B back to the layer — through the
/// selection mask when there is one. The layer texture must still hold the
/// original pixels; scratch A is overwritten.
fn commit_scratch_b(
    engine: &mut EngineInner,
    layer_id: &str,
    layer: TextureHandle,
    w: u32,
    h: u32,
    has_selection: bool,
) {
    if has_selection {
        // Save the original layer to scratch A (layer still untouched).
        let scratch_fbo_a = engine.scratch_fbo_a;
        copy_layer_to_scratch(engine, layer_id, scratch_fbo_a);
        // Blend: filtered (scratch B) with original (scratch A) using selection mask → layer
        let scratch_b = engine.scratch_texture_b;
        let scratch_a = engine.scratch_texture_a;
        blend_with_selection_mask(engine, layer_id, scratch_b, scratch_a);
    } else {
        // Copy scratch B back to layer texture (original path)
        blit_scratch_to(engine, engine.scratch_texture_b, layer, w, h);
    }

    engine.mark_layer_dirty(layer_id);
}

/// Pixelate (#1167): every pixel of the source footprint takes its block's
/// alpha-weighted mean colour and the mean alpha of the block's covered
/// pixels. Pass 1 reduces each block to one texel of scratch A (each layer
/// texel is read once, whatever the block size); pass 2 expands the blocks
/// into scratch B, masked by the source alpha.
pub fn apply_pixelate(engine: &mut EngineInner, layer_id: &str, block_size: u32) {
    let _ = engine.ensure_layer_full_size(layer_id);

    let has_selection = engine.selection_mask_texture.is_some();

    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }
    let blocks_w = w.div_ceil(block_size);
    let blocks_h = h.div_ceil(block_size);

    // Pass 1: block averages (layer -> scratch A, blocks_w x blocks_h)
    engine.pass(&engine.shaders.pixelate_blocks, PixelateBlocksParams { block_size: block_size as i32 })
        .texture("u_tex", tex_handle)
        .viewport(0, 0, blocks_w as i32, blocks_h as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));

    // Pass 2: expand blocks over the source footprint (-> scratch B, w x h)
    engine.pass(&engine.shaders.pixelate, PixelateParams { block_size: block_size as i32 })
        .texture("u_tex", tex_handle)
        .texture("u_blocks", engine.scratch_texture_a)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_b));

    commit_scratch_b(engine, layer_id, tex_handle, w, h, has_selection);
}

/// Render a single channel of a layer texture as grayscale into a scratch
/// FBO and read back the result as RGBA pixels. `channel`: 0=R, 1=G, 2=B, 3=A.
pub fn extract_channel_pixels(
    engine: &mut EngineInner,
    layer_id: &str,
    channel: u32,
) -> Vec<u8> {
    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return Vec::new(),
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((0, 0));
    if w == 0 || h == 0 { return Vec::new(); }
    if engine.texture_pool.get(tex_handle).is_none() {
        return Vec::new();
    }

    engine.pass(&engine.shaders.channel_extract, ChannelExtractParams { channel: channel as i32 })
        .texture("u_tex", tex_handle)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));

    engine.gpu().read_rgba(engine.scratch_texture_a, 0, 0, w, h)
        .unwrap_or_default()
}

/// GPU-side box-downscaled thumbnail for one channel of a layer texture, as
/// grey (see `thumbnail_gpu`).
///
/// Returns 8-byte header `[width_u32_le, height_u32_le]` + RGBA pixels.
pub fn read_channel_thumbnail(
    engine: &mut EngineInner,
    layer_id: &str,
    channel: u32,
    max_size: u32,
) -> Vec<u8> {
    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return Vec::new(),
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((0, 0));
    if engine.texture_pool.get(tex_handle).is_none() {
        return Vec::new();
    }
    crate::thumbnail_gpu::read_box_thumbnail(engine, tex_handle, w, h, max_size, channel.min(3) as i32)
}
