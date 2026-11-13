//! Magnetic lasso selection tool — CPU-side Sobel edge field plus segment
//! snapping. Lives separate from `api/selection.rs` because it needs a
//! persistent edge field on the engine (begin/end lifecycle) while
//! everything else in selection is stateless mask math.


use crate::engine::EngineInner;
use crate::{commands};

// ============================================================
// Magnetic Lasso
// ============================================================
//
// begin(layerId) reads the active layer's pixels from the GPU, computes a
// doc-sized Sobel edge-magnitude field, and stores it on the engine. snap()
// queries that field to pull a candidate segment onto strong edges — only
// coordinates leave the Rust side. end() frees the field.

pub fn magnetic_lasso_begin(engine: &mut EngineInner, layer_id: &str) -> Result<(), String> {
    let doc_w = engine.doc_width;
    let doc_h = engine.doc_height;
    if doc_w == 0 || doc_h == 0 {
        return Err("Document has zero size".to_string());
    }

    let pixels = commands::fill::read_layer_pixels_for_fill(engine, layer_id)?;
    let edges = lopsy_core::magnetic_lasso::compute_edge_field(&pixels, doc_w, doc_h);
    engine.mlasso.edges = Some(edges);
    engine.mlasso.width = doc_w;
    engine.mlasso.height = doc_h;
    Ok(())
}

pub fn magnetic_lasso_snap(
    engine: &EngineInner,
    from_x: f32,
    from_y: f32,
    to_x: f32,
    to_y: f32,
    radius: u32,
    threshold: u8,
) -> Vec<f32> {
    let Some(edges) = engine.mlasso.edges.as_ref() else {
        return vec![from_x, from_y, to_x, to_y];
    };
    lopsy_core::magnetic_lasso::snap_segment(
        edges,
        engine.mlasso.width,
        engine.mlasso.height,
        from_x, from_y, to_x, to_y,
        radius, threshold,
    )
}

pub fn magnetic_lasso_snap_point(
    engine: &EngineInner,
    x: f32,
    y: f32,
    radius: u32,
    threshold: u8,
) -> Vec<f32> {
    let Some(edges) = engine.mlasso.edges.as_ref() else {
        return vec![x, y];
    };
    let (sx, sy) = lopsy_core::magnetic_lasso::snap_point(
        edges,
        engine.mlasso.width,
        engine.mlasso.height,
        x, y, radius, threshold,
    );
    vec![sx, sy]
}

pub fn magnetic_lasso_end(engine: &mut EngineInner) {
    engine.mlasso.edges = None;
    engine.mlasso.width = 0;
    engine.mlasso.height = 0;
}

