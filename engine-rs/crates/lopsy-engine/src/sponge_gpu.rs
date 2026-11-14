use crate::coverage_stroke_gpu::{self as coverage, CoverageTool};
use crate::engine::EngineInner;

/// Begin a sponge stroke on `layer_id` (`mode` 0 = saturate, 1 = desaturate).
/// See `coverage_stroke_gpu` for the coverage / preview / bake pipeline.
pub fn begin_sponge_stroke(
    engine: &mut EngineInner,
    layer_id: &str,
    mode: u32,
) -> Result<(), String> {
    coverage::begin_stroke(engine, layer_id, mode, CoverageTool::Sponge)
}

pub fn apply_sponge_dab(
    engine: &mut EngineInner,
    layer_id: &str,
    cx: f64,
    cy: f64,
    size: f32,
    hardness: f32,
    strength: f32,
) {
    apply_sponge_dab_batch(engine, layer_id, &[cx, cy], size, hardness, strength);
}

pub fn apply_sponge_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    points: &[f64],
    size: f32,
    hardness: f32,
    strength: f32,
) {
    coverage::accumulate_dabs(
        engine,
        layer_id,
        CoverageTool::Sponge,
        points,
        size,
        hardness,
        strength,
    );
}

/// Bake the accumulated coverage into the layer and release the stroke's
/// coverage and preview textures.
pub fn end_sponge_stroke(engine: &mut EngineInner, layer_id: &str) {
    coverage::end_stroke(engine, layer_id, CoverageTool::Sponge);
}
