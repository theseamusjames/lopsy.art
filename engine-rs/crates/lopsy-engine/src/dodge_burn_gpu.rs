use crate::coverage_stroke_gpu::{self as coverage, CoverageTool};
use crate::engine::EngineInner;

/// Begin a dodge/burn stroke on `layer_id` (`mode` 0 = dodge, 1 = burn).
/// See `coverage_stroke_gpu` for the coverage / preview / bake pipeline.
pub fn begin_dodge_burn_stroke(
    engine: &mut EngineInner,
    layer_id: &str,
    mode: u32,
) -> Result<(), String> {
    coverage::begin_stroke(engine, layer_id, mode, CoverageTool::DodgeBurn)
}

pub fn apply_dodge_burn_dab(
    engine: &mut EngineInner,
    layer_id: &str,
    cx: f64,
    cy: f64,
    size: f32,
    hardness: f32,
    exposure: f32,
) {
    apply_dodge_burn_dab_batch(engine, layer_id, &[cx, cy], size, hardness, exposure);
}

pub fn apply_dodge_burn_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    points: &[f64],
    size: f32,
    hardness: f32,
    exposure: f32,
) {
    coverage::accumulate_dabs(
        engine,
        layer_id,
        CoverageTool::DodgeBurn,
        points,
        size,
        hardness,
        exposure,
    );
}

/// Bake the accumulated coverage into the layer and release the stroke's
/// coverage and preview textures.
pub fn end_dodge_burn_stroke(engine: &mut EngineInner, layer_id: &str) {
    coverage::end_stroke(engine, layer_id, CoverageTool::DodgeBurn);
}
