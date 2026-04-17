//! Magnetic lasso selection tool — CPU-side Sobel edge field plus segment
//! snapping. Lives separate from `api/selection.rs` because it needs a
//! persistent edge field on the engine (begin/end lifecycle) while
//! everything else in selection is stateless mask math.

use wasm_bindgen::prelude::*;

use crate::{Engine, api};

// ============================================================
// Magnetic Lasso
// ============================================================
//
// begin(layerId) reads the active layer's pixels from the GPU, computes a
// doc-sized Sobel edge-magnitude field, and stores it on the engine. snap()
// queries that field to pull a candidate segment onto strong edges — only
// coordinates leave the Rust side. end() frees the field.

#[wasm_bindgen(js_name = "magneticLassoBegin")]
pub fn magnetic_lasso_begin(engine: &mut Engine, layer_id: &str) -> Result<(), JsError> {
    let doc_w = engine.inner.doc_width;
    let doc_h = engine.inner.doc_height;
    if doc_w == 0 || doc_h == 0 {
        return Err(JsError::new("Document has zero size"));
    }

    let pixels = api::fill::read_layer_pixels_for_fill(engine, layer_id)?;
    let edges = lopsy_core::magnetic_lasso::compute_edge_field(&pixels, doc_w, doc_h);
    engine.inner.magnetic_lasso_edges = Some(edges);
    engine.inner.magnetic_lasso_width = doc_w;
    engine.inner.magnetic_lasso_height = doc_h;
    Ok(())
}

#[wasm_bindgen(js_name = "magneticLassoSnap")]
pub fn magnetic_lasso_snap(
    engine: &Engine,
    from_x: f32,
    from_y: f32,
    to_x: f32,
    to_y: f32,
    radius: u32,
    threshold: u8,
) -> Vec<f32> {
    let Some(edges) = engine.inner.magnetic_lasso_edges.as_ref() else {
        return vec![from_x, from_y, to_x, to_y];
    };
    lopsy_core::magnetic_lasso::snap_segment(
        edges,
        engine.inner.magnetic_lasso_width,
        engine.inner.magnetic_lasso_height,
        from_x, from_y, to_x, to_y,
        radius, threshold,
    )
}

#[wasm_bindgen(js_name = "magneticLassoSnapPoint")]
pub fn magnetic_lasso_snap_point(
    engine: &Engine,
    x: f32,
    y: f32,
    radius: u32,
    threshold: u8,
) -> Vec<f32> {
    let Some(edges) = engine.inner.magnetic_lasso_edges.as_ref() else {
        return vec![x, y];
    };
    let (sx, sy) = lopsy_core::magnetic_lasso::snap_point(
        edges,
        engine.inner.magnetic_lasso_width,
        engine.inner.magnetic_lasso_height,
        x, y, radius, threshold,
    );
    vec![sx, sy]
}

#[wasm_bindgen(js_name = "magneticLassoEnd")]
pub fn magnetic_lasso_end(engine: &mut Engine) {
    engine.inner.magnetic_lasso_edges = None;
    engine.inner.magnetic_lasso_width = 0;
    engine.inner.magnetic_lasso_height = 0;
}

