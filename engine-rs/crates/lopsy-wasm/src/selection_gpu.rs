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

    let _ = engine.texture_pool.upload_rgba(
        gl, tex_handle, 0, 0, width, height, &rgba,
    );

    // Use NEAREST filtering to avoid interpolation at mask boundaries
    engine.texture_pool.set_nearest_filter(gl, tex_handle);

    engine.selection_mask_texture = Some(tex_handle);
    engine.needs_recomposite = true;
}
