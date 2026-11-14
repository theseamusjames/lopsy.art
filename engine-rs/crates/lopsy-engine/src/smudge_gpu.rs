use lopsy_core::dab_rect::dab_rect;

use crate::dab_pass_gpu::scratch_dab_pass;
use crate::engine::EngineInner;
use crate::gpu::params::brush::SmudgeDabParams;

pub fn apply_smudge_dab(
    engine: &mut EngineInner,
    layer_id: &str,
    cx: f64,
    cy: f64,
    prev_x: f64,
    prev_y: f64,
    size: f32,
    strength: f32,
) {
    apply_smudge_dab_batch(engine, layer_id, &[prev_x, prev_y, cx, cy], size, strength);
}

/// Apply a chain of smudge dabs. `points` is a flat array
/// `[p0.x, p0.y, p1.x, p1.y, ...]` where p0 is the starting "previous" point
/// and each subsequent pair becomes a dab whose `prev` is the pair before it.
pub fn apply_smudge_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    points: &[f64],
    size: f32,
    strength: f32,
) {
    if points.len() < 4 {
        return;
    }
    // Smudge is not a registry paint tool, so no pointer-down `beginStroke`
    // grows the layer for it. A no-op once the layer covers the document
    // (it never reallocates per move), and it also sizes scratch to the
    // layer, which each dab's copy-back needs.
    let _ = engine.ensure_layer_full_size(layer_id);

    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }
    if engine.ensure_scratch_size(w, h).is_err() {
        return;
    }

    for pair in points.windows(4).step_by(2) {
        let (prev_x, prev_y) = (pair[0] as f32, pair[1] as f32);
        let (cx, cy) = (pair[2] as f32, pair[3] as f32);
        // Only texels within the radius of the new centre change; the shader
        // reads the dragged pixels from `- (center - prev)` anywhere in the layer.
        let Some(rect) = dab_rect(cx, cy, size, w, h) else {
            continue;
        };
        scratch_dab_pass(
            engine,
            tex_handle,
            w,
            h,
            rect,
            engine
                .pass(&engine.shaders.smudge_dab, SmudgeDabParams {
                    center: [cx, cy],
                    prev: [prev_x, prev_y],
                    size,
                    strength,
                    tex_size: [w as f32, h as f32],
                })
                .texture("u_sourceTex", tex_handle),
        );
    }

    engine.mark_layer_dirty(layer_id);
}
