use web_sys::WebGl2RenderingContext;
use lopsy_core::layer::LayerDesc;
use crate::engine::EngineInner;

pub fn add_layer(engine: &mut EngineInner, desc: LayerDesc) -> Result<(), String> {
    let tex = engine.texture_pool.acquire(&engine.gl, desc.width, desc.height)?;
    engine.layer_textures.insert(desc.id.clone(), tex);
    engine.layer_stack.push(desc);
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

pub fn upload_pixels(
    engine: &mut EngineInner,
    layer_id: &str,
    data: &[u8],
    width: u32,
    height: u32,
    _offset_x: i32,
    _offset_y: i32,
) -> Result<(), String> {
    // Ensure texture exists and is correct size
    if let Some(&tex_handle) = engine.layer_textures.get(layer_id) {
        let (tw, th) = engine.texture_pool.get_size(tex_handle).unwrap_or((0, 0));
        if tw != width || th != height {
            engine.texture_pool.release(tex_handle);
            let new_tex = engine.texture_pool.acquire(&engine.gl, width, height)?;
            engine.layer_textures.insert(layer_id.to_string(), new_tex);
        }
    }

    if let Some(&tex_handle) = engine.layer_textures.get(layer_id) {
        if let Some(texture) = engine.texture_pool.get(tex_handle) {
            engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(texture));
            engine.gl.tex_sub_image_2d_with_i32_and_i32_and_u32_and_type_and_opt_u8_array(
                WebGl2RenderingContext::TEXTURE_2D,
                0, 0, 0,
                width as i32, height as i32,
                WebGl2RenderingContext::RGBA,
                WebGl2RenderingContext::UNSIGNED_BYTE,
                Some(data),
            ).map_err(|e| format!("tex_sub_image_2d failed: {:?}", e))?;
        }
    }

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

    let mut pixels = vec![0u8; (w * h * 4) as usize];
    engine.gl.read_pixels_with_opt_u8_array(
        0, 0, w as i32, h as i32,
        WebGl2RenderingContext::RGBA,
        WebGl2RenderingContext::UNSIGNED_BYTE,
        Some(&mut pixels),
    ).map_err(|e| format!("readPixels failed: {:?}", e))?;

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));

    Ok(pixels)
}
