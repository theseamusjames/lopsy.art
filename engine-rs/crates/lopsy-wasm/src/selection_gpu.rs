use crate::engine::EngineInner;
use crate::gpu::pass::Target;

pub fn set_selection_mask(
    engine: &mut EngineInner,
    mask_data: &[u8],
    width: u32,
    height: u32,
) {
    // Release old selection texture if present
    if let Some(old_tex) = engine.selection_mask_texture.take() {
        engine.texture_pool.release(old_tex);
    }

    let tex_handle = match engine.upload_mask_texture(mask_data, width, height) {
        Ok(h) => h,
        Err(_) => return,
    };

    // Use NEAREST filtering to avoid interpolation at mask boundaries
    engine.texture_pool.set_nearest_filter(tex_handle);

    engine.selection_mask_texture = Some(tex_handle);
    engine.needs_recomposite = true;
}

/// Apply a Gaussian blur to the current selection mask texture on the GPU.
/// This implements feathering entirely in GPU space, preserving precision
/// and running at interactive speed regardless of document size.
pub fn feather_selection_mask(engine: &mut EngineInner, radius: u32) {
    if radius == 0 { return; }

    let mask_handle = match engine.selection_mask_texture {
        Some(h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(mask_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(mask_handle).is_none() {
        return;
    }

    // Switch to LINEAR filtering for smooth blur sampling
    engine.texture_pool.set_linear_filter(mask_handle);

    let clamped_radius = radius.min(63) as usize;
    let weights = gaussian_weights(clamped_radius);
    let mut w64 = [0.0f32; 64];
    for (i, &v) in weights.iter().enumerate() {
        if i < 64 { w64[i] = v; }
    }
    let blur_pass = |src, direction: (f32, f32)| {
        engine.pass(&engine.shaders.gaussian_blur)
            .i32("u_radius", clamped_radius as i32)
            .f32_array("u_weights[0]", &w64)
            .texture("u_tex", src)
            .vec2("u_direction", direction.0, direction.1)
            .viewport(0, 0, w as i32, h as i32)
    };

    // Pass 1: horizontal — mask → scratch A
    blur_pass(mask_handle, (1.0, 0.0)).draw(Target::Framebuffer(engine.scratch_fbo_a));
    // Pass 2: vertical — scratch A → scratch B
    blur_pass(engine.scratch_texture_a, (0.0, 1.0)).draw(Target::Framebuffer(engine.scratch_fbo_b));

    // Copy scratch B → mask texture
    engine.pass(&engine.shaders.blit)
        .texture("u_tex", engine.scratch_texture_b)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(mask_handle));

    // Keep LINEAR filtering so feathered mask samples smoothly
    engine.needs_recomposite = true;
}

/// Read the current selection mask texture back from the GPU as a single-channel
/// byte array. Returns (width, height, mask_bytes). Empty if no mask is set.
pub fn read_selection_mask(engine: &EngineInner) -> (u32, u32, Vec<u8>) {
    let mask_handle = match engine.selection_mask_texture {
        Some(h) => h,
        None => return (0, 0, Vec::new()),
    };
    let (w, h) = engine.texture_pool.get_size(mask_handle).unwrap_or((0, 0));
    if w == 0 || h == 0 { return (0, 0, Vec::new()); }
    if engine.texture_pool.get(mask_handle).is_none() {
        return (0, 0, Vec::new());
    }

    let rgba = engine.gpu().read_rgba(mask_handle, 0, 0, w, h).unwrap_or_default();

    let mut mask = vec![0u8; (w * h) as usize];
    for i in 0..(w * h) as usize {
        mask[i] = rgba.get(i * 4).copied().unwrap_or(0);
    }
    (w, h, mask)
}

fn gaussian_weights(radius: usize) -> Vec<f32> {
    let sigma = (radius as f32) / 2.0;
    let mut weights = Vec::with_capacity(radius + 1);
    let mut sum = 0.0f32;
    for i in 0..=radius {
        let w = (-((i as f32) * (i as f32)) / (2.0 * sigma * sigma)).exp();
        weights.push(w);
        sum += if i == 0 { w } else { 2.0 * w };
    }
    for w in weights.iter_mut() {
        *w /= sum;
    }
    weights
}
