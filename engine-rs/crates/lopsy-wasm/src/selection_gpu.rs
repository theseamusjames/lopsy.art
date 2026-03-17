use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;

pub fn set_selection_mask(
    engine: &mut EngineInner,
    mask_data: &[u8],
    width: u32,
    height: u32,
) {
    let gl = &engine.gl;

    // Release old selection texture if present
    if let Some(old_tex) = engine.selection_mask_texture.take() {
        engine.texture_pool.release(old_tex);
    }

    // Create new texture for the mask
    let tex_handle = match engine.texture_pool.acquire(gl, width, height) {
        Ok(h) => h,
        Err(_) => return,
    };

    // Upload mask as RGBA (mask value in R channel, replicated to all channels)
    // The mask data is single-channel, so expand to RGBA
    let mut rgba = vec![0u8; (width * height * 4) as usize];
    for i in 0..(width * height) as usize {
        let v = if i < mask_data.len() { mask_data[i] } else { 0 };
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
    }

    if let Some(texture) = engine.texture_pool.get(tex_handle) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(texture));
        let _ = gl.tex_sub_image_2d_with_i32_and_i32_and_u32_and_type_and_opt_u8_array(
            WebGl2RenderingContext::TEXTURE_2D,
            0, 0, 0,
            width as i32, height as i32,
            WebGl2RenderingContext::RGBA,
            WebGl2RenderingContext::UNSIGNED_BYTE,
            Some(&rgba),
        );
    }

    engine.selection_mask_texture = Some(tex_handle);
    engine.needs_recomposite = true;
}
