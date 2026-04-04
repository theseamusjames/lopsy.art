use web_sys::WebGl2RenderingContext;
use lopsy_core::layer::LayerDesc;
use crate::engine::EngineInner;

pub fn add_layer(engine: &mut EngineInner, desc: LayerDesc) -> Result<(), String> {
    // Only create a texture if the layer doesn't already have one.
    // uploadLayerPixels may have already been called for this layer
    // (e.g. cropLayerToContent runs before syncLayers adds the layer).
    if !engine.layer_textures.contains_key(&desc.id) {
        let tex = engine.texture_pool.acquire(&engine.gl, 1, 1)?;
        engine.layer_textures.insert(desc.id.clone(), tex);
    }
    // Only add to layer_stack if not already present
    if !engine.layer_stack.iter().any(|l| l.id == desc.id) {
        engine.layer_stack.push(desc);
    } else {
        update_layer(engine, desc);
    }
    engine.needs_recomposite = true;
    Ok(())
}

pub fn remove_layer(engine: &mut EngineInner, layer_id: &str) {
    if let Some(tex) = engine.layer_textures.remove(layer_id) {
        engine.texture_pool.release(tex);
    }
    if let Some(mask) = engine.layer_masks.remove(layer_id) {
        engine.texture_pool.release(mask);
    }
    engine.layer_stack.retain(|l| l.id != layer_id);
    engine.needs_recomposite = true;
}

pub fn update_layer(engine: &mut EngineInner, desc: LayerDesc) {
    if let Some(existing) = engine.layer_stack.iter_mut().find(|l| l.id == desc.id) {
        *existing = desc;
    }
    engine.needs_recomposite = true;
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
            let new_tex = engine.texture_pool.acquire(&engine.gl, width, height)?;
            engine.layer_textures.insert(layer_id.to_string(), new_tex);
        }
    } else {
        let new_tex = engine.texture_pool.acquire(&engine.gl, width, height)?;
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
        eng.texture_pool.upload_rgba(&eng.gl, tex, 0, 0, width, height, data)
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
        eng.texture_pool.upload_rgba_f32(&eng.gl, tex, 0, 0, width, height, data)
    })
}

/// Upload layer pixels directly from an HtmlCanvasElement, avoiding the
/// getImageData unpremultiply round-trip that causes alpha precision loss.
pub fn upload_pixels_from_canvas(
    engine: &mut EngineInner,
    layer_id: &str,
    canvas: &web_sys::HtmlCanvasElement,
    width: u32,
    height: u32,
) -> Result<(), String> {
    with_layer_texture(engine, layer_id, width, height, |eng, tex| {
        eng.texture_pool.upload_canvas(&eng.gl, tex, canvas, width, height)
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
            let new_tex = engine.texture_pool.acquire(&engine.gl, sw, sh)?;
            engine.layer_textures.insert(dst_id.to_string(), new_tex);
        }
    } else {
        let new_tex = engine.texture_pool.acquire(&engine.gl, sw, sh)?;
        engine.layer_textures.insert(dst_id.to_string(), new_tex);
    }

    let dst_handle = *engine.layer_textures.get(dst_id).unwrap();

    // Blit: bind dst as FBO target, sample src, draw fullscreen quad
    let dst_tex = engine.texture_pool.get(dst_handle).cloned()
        .ok_or("Dst texture not found")?;
    let src_tex = engine.texture_pool.get(src_handle).cloned()
        .ok_or("Src texture not found")?;

    let fbo = engine.gl.create_framebuffer()
        .ok_or("Failed to create temp FBO")?;
    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    engine.gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&dst_tex),
        0,
    );
    engine.gl.viewport(0, 0, sw as i32, sh as i32);

    engine.gl.use_program(Some(&engine.shaders.blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&src_tex));
    if let Some(loc) = engine.gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
        engine.gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));

    engine.mark_layer_dirty(dst_id);
    Ok(())
}

/// GPU-side merge: composite top layer onto bottom layer using the blend shader.
/// The result goes into the bottom layer's texture.
pub fn merge_layers(
    engine: &mut EngineInner,
    top_id: &str,
    bottom_id: &str,
) -> Result<(), String> {
    let top_handle = *engine.layer_textures.get(top_id)
        .ok_or_else(|| format!("Top layer {top_id} not found"))?;
    let bottom_handle = *engine.layer_textures.get(bottom_id)
        .ok_or_else(|| format!("Bottom layer {bottom_id} not found"))?;
    let (tw, th) = engine.texture_pool.get_size(top_handle).unwrap_or((1, 1));
    let (bw, bh) = engine.texture_pool.get_size(bottom_handle).unwrap_or((1, 1));

    let top_layer = engine.layer_stack.iter().find(|l| l.id == top_id).cloned();
    let bottom_layer = engine.layer_stack.iter().find(|l| l.id == bottom_id).cloned();
    let top_desc = top_layer.ok_or_else(|| format!("Top layer desc {top_id} not found"))?;
    let bottom_desc = bottom_layer.ok_or_else(|| format!("Bottom layer desc {bottom_id} not found"))?;

    let top_tex = engine.texture_pool.get(top_handle).cloned()
        .ok_or("Top texture not found")?;
    let bottom_tex = engine.texture_pool.get(bottom_handle).cloned()
        .ok_or("Bottom texture not found")?;

    // Render: blend top onto bottom, store in scratch_a
    engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
    engine.gl.viewport(0, 0, bw as i32, bh as i32);

    // First copy bottom into scratch_a
    engine.gl.use_program(Some(&engine.shaders.blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&bottom_tex));
    if let Some(loc) = engine.gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
        engine.gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();

    // Now blend top onto scratch_a → scratch_b
    let scratch_a_tex = engine.texture_pool.get(engine.scratch_texture_a).cloned()
        .ok_or("scratch_a not found")?;
    engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_b);
    engine.gl.viewport(0, 0, bw as i32, bh as i32);

    engine.gl.use_program(Some(&engine.shaders.blend.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&top_tex));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&scratch_a_tex));

    let prog = &engine.shaders.blend.program;
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_dstTex") { engine.gl.uniform1i(Some(&loc), 1); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_opacity") { engine.gl.uniform1f(Some(&loc), top_desc.opacity); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_blendMode") { engine.gl.uniform1i(Some(&loc), top_desc.blend_mode as i32); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcOffset") {
        engine.gl.uniform2f(Some(&loc),
            (top_desc.x - bottom_desc.x) as f32,
            (top_desc.y - bottom_desc.y) as f32);
    }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcSize") { engine.gl.uniform2f(Some(&loc), tw as f32, th as f32); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_docSize") { engine.gl.uniform2f(Some(&loc), bw as f32, bh as f32); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcPremultiplied") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_overlayEnabled") { engine.gl.uniform1i(Some(&loc), 0); }

    engine.draw_fullscreen_quad();

    // Unbind scratch_a from TEXTURE1 before we write to bottom's FBO
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);

    // Copy scratch_b → bottom texture
    let fbo = engine.gl.create_framebuffer()
        .ok_or("Failed to create temp FBO")?;
    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    engine.gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&bottom_tex),
        0,
    );
    engine.gl.viewport(0, 0, bw as i32, bh as i32);

    engine.gl.use_program(Some(&engine.shaders.blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch_b) = engine.texture_pool.get(engine.scratch_texture_b) {
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_b));
    }
    if let Some(loc) = engine.gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
        engine.gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));

    engine.mark_layer_dirty(bottom_id);
    Ok(())
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
    let src_tex = engine.texture_pool.get(tex_handle).cloned()
        .ok_or("Texture not found")?;

    // Rotated dimensions are swapped
    let new_w = h;
    let new_h = w;

    // Allocate a new texture with swapped dimensions
    let new_tex = engine.texture_pool.acquire(&engine.gl, new_w, new_h)?;
    let new_gl_tex = engine.texture_pool.get(new_tex).cloned()
        .ok_or("New texture not found")?;

    // Render rotated into new texture
    let fbo = engine.gl.create_framebuffer()
        .ok_or("Failed to create FBO")?;
    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    engine.gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&new_gl_tex),
        0,
    );
    engine.gl.viewport(0, 0, new_w as i32, new_h as i32);

    engine.gl.disable(WebGl2RenderingContext::BLEND);
    let prog = &engine.shaders.rotate90.program;
    engine.gl.use_program(Some(prog));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&src_tex));
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_tex") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_clockwise") { engine.gl.uniform1i(Some(&loc), if clockwise { 1 } else { 0 }); }
    engine.draw_fullscreen_quad();

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));

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
    let src_tex = engine.texture_pool.get(tex_handle).cloned()
        .ok_or("Texture not found")?;

    // Allocate new texture at target size
    let new_tex = engine.texture_pool.acquire(&engine.gl, new_w, new_h)?;
    let new_gl_tex = engine.texture_pool.get(new_tex).cloned()
        .ok_or("New texture not found")?;

    // Ensure LINEAR filtering for bilinear interpolation
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&src_tex));
    engine.gl.tex_parameteri(
        WebGl2RenderingContext::TEXTURE_2D,
        WebGl2RenderingContext::TEXTURE_MIN_FILTER,
        WebGl2RenderingContext::LINEAR as i32,
    );
    engine.gl.tex_parameteri(
        WebGl2RenderingContext::TEXTURE_2D,
        WebGl2RenderingContext::TEXTURE_MAG_FILTER,
        WebGl2RenderingContext::LINEAR as i32,
    );

    // Blit src → new with bilinear sampling
    let fbo = engine.gl.create_framebuffer()
        .ok_or("Failed to create FBO")?;
    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    engine.gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&new_gl_tex),
        0,
    );
    engine.gl.viewport(0, 0, new_w as i32, new_h as i32);

    engine.gl.disable(WebGl2RenderingContext::BLEND);
    engine.gl.use_program(Some(&engine.shaders.blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&src_tex));
    if let Some(loc) = engine.gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
        engine.gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));

    // Restore NEAREST filtering on old texture before release
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&src_tex));
    engine.gl.tex_parameteri(
        WebGl2RenderingContext::TEXTURE_2D,
        WebGl2RenderingContext::TEXTURE_MIN_FILTER,
        WebGl2RenderingContext::NEAREST as i32,
    );

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
    let src_tex = engine.texture_pool.get(tex_handle).cloned()
        .ok_or("Texture not found")?;

    let new_tex = engine.texture_pool.acquire(&engine.gl, new_w, new_h)?;
    let new_gl_tex = engine.texture_pool.get(new_tex).cloned()
        .ok_or("New texture not found")?;

    // Map output UV to source UV:
    // The layer was at (old_layer_x, old_layer_y) in old doc space.
    // After offset, it's at (old_layer_x + offset_x, old_layer_y + offset_y) in new doc space.
    // src UV = (dst_pixel - (old_layer_x + offset_x)) / old_w in layer-local space.
    // But since the new texture is full canvas: src UV = (dst_uv * new_size - (layer_pos + offset)) / old_size
    let scale_x = new_w as f32 / old_w as f32;
    let scale_y = new_h as f32 / old_h as f32;
    let off_x = -(old_layer_x as f32 + offset_x as f32) / old_w as f32;
    let off_y = -(old_layer_y as f32 + offset_y as f32) / old_h as f32;

    let fbo = engine.gl.create_framebuffer()
        .ok_or("Failed to create FBO")?;
    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    engine.gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&new_gl_tex),
        0,
    );
    engine.gl.viewport(0, 0, new_w as i32, new_h as i32);
    engine.gl.clear_color(0.0, 0.0, 0.0, 0.0);
    engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);

    engine.gl.disable(WebGl2RenderingContext::BLEND);
    let prog = &engine.shaders.blit_region.program;
    engine.gl.use_program(Some(prog));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&src_tex));
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_tex") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_scale") { engine.gl.uniform2f(Some(&loc), scale_x, scale_y); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_offset") { engine.gl.uniform2f(Some(&loc), off_x, off_y); }
    engine.draw_fullscreen_quad();

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));

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
    let src_tex = engine.texture_pool.get(tex_handle).cloned()
        .ok_or("Texture not found")?;

    let new_tex = engine.texture_pool.acquire(&engine.gl, crop_w, crop_h)?;
    let new_gl_tex = engine.texture_pool.get(new_tex).cloned()
        .ok_or("New texture not found")?;

    // Map output UV [0,1] over crop region to source UV [0,1] over old texture.
    // output pixel = crop_offset + v_uv * crop_size (in doc space)
    // source pixel in layer space = doc_pixel - layer_offset
    // source UV = (crop_offset + v_uv * crop_size - layer_offset) / old_size
    let scale_x = crop_w as f32 / old_w as f32;
    let scale_y = crop_h as f32 / old_h as f32;
    let off_x = (crop_x - layer_x) as f32 / old_w as f32;
    let off_y = (crop_y - layer_y) as f32 / old_h as f32;

    let fbo = engine.gl.create_framebuffer()
        .ok_or("Failed to create FBO")?;
    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    engine.gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&new_gl_tex),
        0,
    );
    engine.gl.viewport(0, 0, crop_w as i32, crop_h as i32);
    engine.gl.clear_color(0.0, 0.0, 0.0, 0.0);
    engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);

    engine.gl.disable(WebGl2RenderingContext::BLEND);
    let prog = &engine.shaders.blit_region.program;
    engine.gl.use_program(Some(prog));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&src_tex));
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_tex") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_scale") { engine.gl.uniform2f(Some(&loc), scale_x, scale_y); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_offset") { engine.gl.uniform2f(Some(&loc), off_x, off_y); }
    engine.draw_fullscreen_quad();

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));

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
    let src_tex = engine.texture_pool.get(tex_handle).cloned()
        .ok_or("Texture not found")?;

    // Render flipped into scratch_a using the flip shader
    engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
    engine.gl.viewport(0, 0, w as i32, h as i32);

    engine.gl.use_program(Some(&engine.shaders.flip.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&src_tex));
    let prog = &engine.shaders.flip.program;
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_tex") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_flipH") { engine.gl.uniform1i(Some(&loc), if horizontal { 1 } else { 0 }); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_flipV") { engine.gl.uniform1i(Some(&loc), if horizontal { 0 } else { 1 }); }
    engine.draw_fullscreen_quad();

    // Copy scratch_a → layer texture
    let fbo = engine.gl.create_framebuffer()
        .ok_or("Failed to create temp FBO")?;
    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    engine.gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&src_tex),
        0,
    );
    engine.gl.viewport(0, 0, w as i32, h as i32);

    engine.gl.use_program(Some(&engine.shaders.blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch) = engine.texture_pool.get(engine.scratch_texture_a) {
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch));
    }
    if let Some(loc) = engine.gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
        engine.gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));

    engine.mark_layer_dirty(layer_id);
    Ok(())
}

/// GPU-side clipboard copy: read layer pixels (optionally masked by selection)
/// into a retained clipboard texture. Returns (width, height, offset_x, offset_y).
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
    if let Some(old) = engine.clipboard_texture.take() {
        engine.texture_pool.release(old);
    }

    // Allocate clipboard texture
    let clip_tex = engine.texture_pool.acquire(&engine.gl, out_w, out_h)?;

    let layer_tex = engine.texture_pool.get(layer_tex_handle).cloned()
        .ok_or("Layer texture not found")?;

    // Create temp FBO for clipboard texture
    let fbo = engine.gl.create_framebuffer()
        .ok_or("Failed to create clipboard FBO")?;
    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    let clip_gl_tex = engine.texture_pool.get(clip_tex).cloned()
        .ok_or("Clipboard texture not found")?;
    engine.gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&clip_gl_tex),
        0,
    );
    engine.gl.viewport(0, 0, out_w as i32, out_h as i32);
    engine.gl.clear_color(0.0, 0.0, 0.0, 0.0);
    engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);

    // Use clipboard_copy shader
    engine.gl.disable(WebGl2RenderingContext::BLEND);
    let prog = &engine.shaders.clipboard_copy.program;
    engine.gl.use_program(Some(prog));

    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_layerTex") {
        engine.gl.uniform1i(Some(&loc), 0);
    }

    // Bind selection mask if present
    let has_mask = has_selection && engine.selection_mask_texture.is_some();
    if has_mask {
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
        if let Some(mask_handle) = engine.selection_mask_texture {
            if let Some(mask_tex) = engine.texture_pool.get(mask_handle) {
                engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(mask_tex));
            }
        }
    }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_maskTex") {
        engine.gl.uniform1i(Some(&loc), 1);
    }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_hasMask") {
        engine.gl.uniform1i(Some(&loc), if has_mask { 1 } else { 0 });
    }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_layerOffset") {
        engine.gl.uniform2f(Some(&loc), layer_x, layer_y);
    }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_layerSize") {
        engine.gl.uniform2f(Some(&loc), lw as f32, lh as f32);
    }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_boundsOffset") {
        engine.gl.uniform2f(Some(&loc), off_x as f32, off_y as f32);
    }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_boundsSize") {
        engine.gl.uniform2f(Some(&loc), out_w as f32, out_h as f32);
    }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_docSize") {
        engine.gl.uniform2f(Some(&loc), engine.doc_width as f32, engine.doc_height as f32);
    }

    engine.draw_fullscreen_quad();

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));

    engine.clipboard_texture = Some(clip_tex);
    engine.clipboard_width = out_w;
    engine.clipboard_height = out_h;
    engine.clipboard_offset_x = off_x;
    engine.clipboard_offset_y = off_y;

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

    let layer_tex = engine.texture_pool.get(layer_tex_handle).cloned()
        .ok_or("Layer texture not found")?;

    // Render cleared result into scratch_a
    engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
    engine.gl.viewport(0, 0, lw as i32, lh as i32);

    engine.gl.disable(WebGl2RenderingContext::BLEND);
    let prog = &engine.shaders.clipboard_clear.program;
    engine.gl.use_program(Some(prog));

    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_layerTex") {
        engine.gl.uniform1i(Some(&loc), 0);
    }

    let has_mask = has_selection && engine.selection_mask_texture.is_some();
    if has_mask {
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
        if let Some(mask_handle) = engine.selection_mask_texture {
            if let Some(mask_tex) = engine.texture_pool.get(mask_handle) {
                engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(mask_tex));
            }
        }
    }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_maskTex") {
        engine.gl.uniform1i(Some(&loc), 1);
    }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_hasMask") {
        engine.gl.uniform1i(Some(&loc), if has_mask { 1 } else { 0 });
    }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_docSize") {
        engine.gl.uniform2f(Some(&loc), engine.doc_width as f32, engine.doc_height as f32);
    }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_layerOffset") {
        engine.gl.uniform2f(Some(&loc), layer_x, layer_y);
    }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_layerSize") {
        engine.gl.uniform2f(Some(&loc), lw as f32, lh as f32);
    }

    engine.draw_fullscreen_quad();

    // Copy scratch_a → layer texture
    let fbo = engine.gl.create_framebuffer()
        .ok_or("Failed to create temp FBO")?;
    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    engine.gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&layer_tex),
        0,
    );
    engine.gl.viewport(0, 0, lw as i32, lh as i32);

    engine.gl.use_program(Some(&engine.shaders.blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch) = engine.texture_pool.get(engine.scratch_texture_a) {
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch));
    }
    if let Some(loc) = engine.gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
        engine.gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));

    engine.mark_layer_dirty(layer_id);
    Ok(())
}

/// GPU-side clipboard paste: blit clipboard texture to a target layer texture.
pub fn clipboard_paste(
    engine: &mut EngineInner,
    dst_layer_id: &str,
) -> Result<(), String> {
    let clip_tex_handle = engine.clipboard_texture
        .ok_or("No clipboard data")?;
    let clip_w = engine.clipboard_width;
    let clip_h = engine.clipboard_height;

    let clip_tex = engine.texture_pool.get(clip_tex_handle).cloned()
        .ok_or("Clipboard texture not found")?;

    // Ensure dst layer has a texture of the right size
    if let Some(&old_dst) = engine.layer_textures.get(dst_layer_id) {
        let (dw, dh) = engine.texture_pool.get_size(old_dst).unwrap_or((0, 0));
        if dw != clip_w || dh != clip_h {
            engine.texture_pool.release(old_dst);
            let new_tex = engine.texture_pool.acquire(&engine.gl, clip_w, clip_h)?;
            engine.layer_textures.insert(dst_layer_id.to_string(), new_tex);
        }
    } else {
        let new_tex = engine.texture_pool.acquire(&engine.gl, clip_w, clip_h)?;
        engine.layer_textures.insert(dst_layer_id.to_string(), new_tex);
    }

    let dst_handle = *engine.layer_textures.get(dst_layer_id).unwrap();
    let dst_tex = engine.texture_pool.get(dst_handle).cloned()
        .ok_or("Dst texture not found")?;

    // Blit clipboard → dst via temp FBO
    let fbo = engine.gl.create_framebuffer()
        .ok_or("Failed to create temp FBO")?;
    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    engine.gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&dst_tex),
        0,
    );
    engine.gl.viewport(0, 0, clip_w as i32, clip_h as i32);

    engine.gl.use_program(Some(&engine.shaders.blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&clip_tex));
    if let Some(loc) = engine.gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
        engine.gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));

    engine.mark_layer_dirty(dst_layer_id);
    Ok(())
}

/// Lift selected pixels from a layer into a floating texture, clearing them
/// from the layer. The float can then be moved and composited at different
/// offsets via `composite_float`.
pub fn float_selection(
    engine: &mut EngineInner,
    layer_id: &str,
) -> Result<(), String> {
    // Release any existing float
    drop_float(engine);

    let layer_tex_handle = *engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let (lw, lh) = engine.texture_pool.get_size(layer_tex_handle).unwrap_or((1, 1));
    let layer_desc = engine.layer_stack.iter().find(|l| l.id == layer_id)
        .ok_or_else(|| format!("Layer desc {layer_id} not found"))?;
    let layer_x = layer_desc.x;
    let layer_y = layer_desc.y;

    // 1. Extract selected pixels into float_texture (clipboard_copy shader)
    let float_tex = engine.texture_pool.acquire(&engine.gl, lw, lh)?;
    let layer_tex = engine.texture_pool.get(layer_tex_handle).cloned()
        .ok_or("Layer texture not found")?;
    let float_gl_tex = engine.texture_pool.get(float_tex).cloned()
        .ok_or("Float texture not found")?;

    let has_mask = engine.selection_mask_texture.is_some();

    // Render extracted pixels into float_texture
    {
        let fbo = engine.gl.create_framebuffer()
            .ok_or("Failed to create FBO")?;
        engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
        engine.gl.framebuffer_texture_2d(
            WebGl2RenderingContext::FRAMEBUFFER,
            WebGl2RenderingContext::COLOR_ATTACHMENT0,
            WebGl2RenderingContext::TEXTURE_2D,
            Some(&float_gl_tex),
            0,
        );
        engine.gl.viewport(0, 0, lw as i32, lh as i32);
        engine.gl.clear_color(0.0, 0.0, 0.0, 0.0);
        engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);
        engine.gl.disable(WebGl2RenderingContext::BLEND);

        let prog = &engine.shaders.clipboard_copy.program;
        engine.gl.use_program(Some(prog));

        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_layerTex") { engine.gl.uniform1i(Some(&loc), 0); }

        if has_mask {
            engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
            if let Some(mask_handle) = engine.selection_mask_texture {
                if let Some(mask_tex) = engine.texture_pool.get(mask_handle) {
                    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(mask_tex));
                }
            }
        }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_maskTex") { engine.gl.uniform1i(Some(&loc), 1); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_hasMask") { engine.gl.uniform1i(Some(&loc), if has_mask { 1 } else { 0 }); }
        // Float covers the same area as the layer texture
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_layerOffset") { engine.gl.uniform2f(Some(&loc), layer_x as f32, layer_y as f32); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_layerSize") { engine.gl.uniform2f(Some(&loc), lw as f32, lh as f32); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_boundsOffset") { engine.gl.uniform2f(Some(&loc), layer_x as f32, layer_y as f32); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_boundsSize") { engine.gl.uniform2f(Some(&loc), lw as f32, lh as f32); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_docSize") { engine.gl.uniform2f(Some(&loc), engine.doc_width as f32, engine.doc_height as f32); }
        engine.draw_fullscreen_quad();

        engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
        engine.gl.delete_framebuffer(Some(&fbo));
    }

    // 2. Create base texture = layer with selected pixels cleared
    let base_tex = engine.texture_pool.acquire(&engine.gl, lw, lh)?;
    let base_gl_tex = engine.texture_pool.get(base_tex).cloned()
        .ok_or("Base texture not found")?;
    {
        let fbo = engine.gl.create_framebuffer()
            .ok_or("Failed to create FBO")?;
        engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
        engine.gl.framebuffer_texture_2d(
            WebGl2RenderingContext::FRAMEBUFFER,
            WebGl2RenderingContext::COLOR_ATTACHMENT0,
            WebGl2RenderingContext::TEXTURE_2D,
            Some(&base_gl_tex),
            0,
        );
        engine.gl.viewport(0, 0, lw as i32, lh as i32);

        let prog = &engine.shaders.clipboard_clear.program;
        engine.gl.use_program(Some(prog));
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_layerTex") { engine.gl.uniform1i(Some(&loc), 0); }

        if has_mask {
            engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
            if let Some(mask_handle) = engine.selection_mask_texture {
                if let Some(mask_tex) = engine.texture_pool.get(mask_handle) {
                    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(mask_tex));
                }
            }
        }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_maskTex") { engine.gl.uniform1i(Some(&loc), 1); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_hasMask") { engine.gl.uniform1i(Some(&loc), if has_mask { 1 } else { 0 }); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_docSize") { engine.gl.uniform2f(Some(&loc), engine.doc_width as f32, engine.doc_height as f32); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_layerOffset") { engine.gl.uniform2f(Some(&loc), layer_x as f32, layer_y as f32); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_layerSize") { engine.gl.uniform2f(Some(&loc), lw as f32, lh as f32); }
        engine.draw_fullscreen_quad();

        engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
        engine.gl.delete_framebuffer(Some(&fbo));
    }

    engine.float_texture = Some(float_tex);
    engine.float_base_texture = Some(base_tex);
    engine.float_layer_id = Some(layer_id.to_string());
    engine.float_width = lw;
    engine.float_height = lh;
    engine.float_layer_x = layer_x;
    engine.float_layer_y = layer_y;

    // Write base to layer immediately (so the display shows selected pixels removed)
    composite_float(engine, 0, 0)?;

    Ok(())
}

/// Composite the float texture at (dx, dy) offset onto the base, writing the
/// result to the layer texture. Called on every mousemove.
pub fn composite_float(
    engine: &mut EngineInner,
    dx: i32,
    dy: i32,
) -> Result<(), String> {
    let base_handle = engine.float_base_texture
        .ok_or("No float base")?;
    let float_handle = engine.float_texture
        .ok_or("No float texture")?;
    let layer_id = engine.float_layer_id.clone()
        .ok_or("No float layer ID")?;
    let layer_tex_handle = *engine.layer_textures.get(&layer_id)
        .ok_or("Layer texture not found")?;

    let fw = engine.float_width;
    let fh = engine.float_height;

    let base_tex = engine.texture_pool.get(base_handle).cloned()
        .ok_or("Base texture not found")?;
    let float_tex = engine.texture_pool.get(float_handle).cloned()
        .ok_or("Float texture not found")?;
    let layer_tex = engine.texture_pool.get(layer_tex_handle).cloned()
        .ok_or("Layer texture not found")?;

    // Step 1: blit base → scratch_a
    engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
    engine.gl.viewport(0, 0, fw as i32, fh as i32);
    engine.gl.disable(WebGl2RenderingContext::BLEND);

    engine.gl.use_program(Some(&engine.shaders.blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&base_tex));
    if let Some(loc) = engine.gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
        engine.gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();

    // Step 2: blend float at (dx, dy) onto scratch_a → scratch_b
    let scratch_a_tex = engine.texture_pool.get(engine.scratch_texture_a).cloned()
        .ok_or("scratch_a not found")?;
    engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_b);
    engine.gl.viewport(0, 0, fw as i32, fh as i32);

    let prog = &engine.shaders.blend.program;
    engine.gl.use_program(Some(prog));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&float_tex));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&scratch_a_tex));

    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_dstTex") { engine.gl.uniform1i(Some(&loc), 1); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_opacity") { engine.gl.uniform1f(Some(&loc), 1.0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_blendMode") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcOffset") { engine.gl.uniform2f(Some(&loc), dx as f32, dy as f32); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcSize") { engine.gl.uniform2f(Some(&loc), fw as f32, fh as f32); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_docSize") { engine.gl.uniform2f(Some(&loc), fw as f32, fh as f32); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcPremultiplied") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_overlayEnabled") { engine.gl.uniform1i(Some(&loc), 0); }
    engine.draw_fullscreen_quad();

    // Unbind scratch_a from TEXTURE1
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);

    // Step 3: blit scratch_b → layer texture
    let fbo = engine.gl.create_framebuffer()
        .ok_or("Failed to create FBO")?;
    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    engine.gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&layer_tex),
        0,
    );
    engine.gl.viewport(0, 0, fw as i32, fh as i32);

    engine.gl.use_program(Some(&engine.shaders.blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch_b) = engine.texture_pool.get(engine.scratch_texture_b) {
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_b));
    }
    if let Some(loc) = engine.gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
        engine.gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));

    engine.mark_layer_dirty(&layer_id);
    Ok(())
}

/// Release float textures.
pub fn drop_float(engine: &mut EngineInner) {
    if let Some(tex) = engine.float_texture.take() {
        engine.texture_pool.release(tex);
    }
    if let Some(tex) = engine.float_base_texture.take() {
        engine.texture_pool.release(tex);
    }
    engine.float_layer_id = None;
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
    let layer_tex_handle = *engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let (lw, lh) = engine.texture_pool.get_size(layer_tex_handle).unwrap_or((1, 1));
    let layer_desc = engine.layer_stack.iter().find(|l| l.id == layer_id)
        .ok_or_else(|| format!("Layer desc {layer_id} not found"))?;
    let layer_x = layer_desc.x as f32;
    let layer_y = layer_desc.y as f32;

    let layer_tex = engine.texture_pool.get(layer_tex_handle).cloned()
        .ok_or("Layer texture not found")?;

    let has_mask = engine.selection_mask_texture.is_some();

    // Render filled result into scratch_a
    engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
    engine.gl.viewport(0, 0, lw as i32, lh as i32);
    engine.gl.disable(WebGl2RenderingContext::BLEND);

    let prog = &engine.shaders.selection_fill.program;
    engine.gl.use_program(Some(prog));

    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_layerTex") { engine.gl.uniform1i(Some(&loc), 0); }

    if has_mask {
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
        if let Some(mask_handle) = engine.selection_mask_texture {
            if let Some(mask_tex) = engine.texture_pool.get(mask_handle) {
                engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(mask_tex));
            }
        }
    }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_maskTex") { engine.gl.uniform1i(Some(&loc), 1); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_hasMask") { engine.gl.uniform1i(Some(&loc), if has_mask { 1 } else { 0 }); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_fillColor") { engine.gl.uniform4f(Some(&loc), r, g, b, a); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_docSize") { engine.gl.uniform2f(Some(&loc), engine.doc_width as f32, engine.doc_height as f32); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_layerOffset") { engine.gl.uniform2f(Some(&loc), layer_x, layer_y); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_layerSize") { engine.gl.uniform2f(Some(&loc), lw as f32, lh as f32); }

    engine.draw_fullscreen_quad();

    // Copy scratch_a → layer texture
    let fbo = engine.gl.create_framebuffer()
        .ok_or("Failed to create FBO")?;
    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    engine.gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&layer_tex),
        0,
    );
    engine.gl.viewport(0, 0, lw as i32, lh as i32);

    engine.gl.use_program(Some(&engine.shaders.blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch) = engine.texture_pool.get(engine.scratch_texture_a) {
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch));
    }
    if let Some(loc) = engine.gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
        engine.gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));

    engine.mark_layer_dirty(layer_id);
    Ok(())
}

pub fn read_pixels(
    engine: &EngineInner,
    layer_id: &str,
) -> Result<Vec<u8>, String> {
    let tex_handle = engine.layer_textures.get(layer_id)
        .ok_or_else(|| format!("Layer {layer_id} not found"))?;
    let (w, h) = engine.texture_pool.get_size(*tex_handle).unwrap_or((0, 0));
    let texture = engine.texture_pool.get(*tex_handle)
        .ok_or("Texture not found")?;

    // Create temp FBO, attach texture, read pixels
    let fbo = engine.gl.create_framebuffer()
        .ok_or("Failed to create temp FBO")?;
    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    engine.gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(texture),
        0,
    );

    let pixels = engine.texture_pool.read_rgba(&engine.gl, 0, 0, w, h)?;

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));

    Ok(pixels)
}
