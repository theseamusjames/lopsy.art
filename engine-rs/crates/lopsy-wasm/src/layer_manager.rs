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
        engine.texture_pool.upload_rgba(
            &engine.gl, tex_handle,
            0, 0, width, height, data,
        )?;
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

    let pixels = engine.texture_pool.read_rgba(&engine.gl, 0, 0, w, h)?;

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));

    Ok(pixels)
}
