//! A document that is one tile of a larger picture
//! (`EngineInner::document_region`, `lopsy_core::tile`): the apron a tile
//! needs for the develop chain the document's settings run.
//!
//! A tile is the part kept plus an apron of real pixels around it, clipped
//! to the picture. Every neighbourhood stage clamps at its texture's edge,
//! so near a tile edge that is not the picture's edge its result can differ
//! from the whole's; how far in it can is the sum of the reaches of the
//! neighbourhood stages that run, in order, since each widens what the next
//! reads. The per-stage reaches are `lopsy_core::detail`'s and
//! `linear_detail`'s; this walks the chain (`compositor::MIDDLE_STAGES` and
//! the working space's scene stages) to add up the ones that draw.

use lopsy_core::detail::{self, DetailSettings, LocalContrastSettings};
use lopsy_core::linear_detail;

use crate::engine::{AreaLayer, EngineInner};

/// The pixels from a tile edge that is not an edge of the picture inside
/// which an export with the document's current settings can differ from
/// the whole picture's: the reaches of every neighbourhood stage the export
/// chain runs, the areas' layers included, at their own pixel scales. 0
/// when only per-pixel stages run. The same for every export (8-bit,
/// 16-bit, HDR): they differ only in per-pixel stages.
pub fn apron(engine: &EngineInner) -> u32 {
    let ws = engine.working_space.is_some();
    let reduces = engine.detail.filter(DetailSettings::reduces_noise);
    let sharpens = engine.detail.filter(DetailSettings::sharpens);
    let mut total = reduces.map_or(0, |d| detail::noise_reduction_reach(&d));
    total += local_contrast_apron(engine.local_contrast, ws);
    let count = engine.areas.as_ref().map_or(0, |v| v.len() / lopsy_core::areas::STRIDE).min(engine.area_layers.len());
    for layer in engine.area_layers[..count].iter().flatten() {
        total += area_layer_apron(layer, ws);
    }
    total + sharpens.map_or(0, |d| detail::sharpen_reach(&d))
}

/// Local contrast and haze. With the working space haze (on scene data, or
/// an area layer's on rendered data) and the large and small details are
/// passes of their own, each when it draws; without it one pass reads both
/// blurs whenever any of the three is set.
fn local_contrast_apron(lc: Option<LocalContrastSettings>, ws: bool) -> u32 {
    let Some(s) = lc else { return 0 };
    if !ws {
        return if s.is_active() { detail::local_contrast_reach(&s) } else { 0 };
    }
    let haze = if linear_detail::haze_draws(&s) { linear_detail::haze_reach(&s) } else { 0 };
    let details = if linear_detail::local_contrast_draws(&s) { detail::local_contrast_reach(&s) } else { 0 };
    haze + details
}

/// An area's layer: its own noise reduction, local contrast and haze, and
/// sharpening, as `compositor::apply_area_layers` runs them (its other
/// stages are per pixel, and its mix through the mask is too).
fn area_layer_apron(layer: &AreaLayer, ws: bool) -> u32 {
    if !crate::document::compositor::area_layer_draws(layer, ws) {
        return 0;
    }
    let noise = layer.detail.filter(DetailSettings::reduces_noise).map_or(0, |d| detail::noise_reduction_reach(&d));
    let sharpen = layer.detail.filter(DetailSettings::sharpens).map_or(0, |d| detail::sharpen_reach(&d));
    noise + local_contrast_apron(layer.local_contrast, ws) + sharpen
}
