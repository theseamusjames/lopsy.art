//! Clone Stamp / Healing Brush source preview (#1220).
//!
//! Inside the brush disc the screen shows what the stamp would copy there:
//! the active layer at the source offset. It is drawn straight from the
//! layer texture after the final blit, so hovering never reads the layer
//! back to the CPU and the preview follows every dab of a stroke. The ring
//! and the source crosshair stay on the 2D overlay canvas above it.

use lopsy_core::dab_rect::viewport_disc_rect;

use crate::engine::EngineInner;
use crate::gpu::pass::{Blend, Scissor, Target};
use crate::gpu::params::brush::StampPreviewParams;

/// The preview's opacity over the composite.
const PREVIEW_OPACITY: f32 = 0.7;

#[derive(Clone, Debug, PartialEq)]
pub struct StampPreview {
    pub layer_id: String,
    /// Document-space centre of the brush disc.
    pub cursor: (f64, f64),
    /// Document-space point whose pixels appear at `cursor`.
    pub source: (f64, f64),
    /// Disc radius in document pixels.
    pub radius: f64,
}

/// Show `preview`, or hide it with `None`. Only the final blit reruns: the
/// composite texture does not change.
pub fn set_stamp_preview(engine: &mut EngineInner, preview: Option<StampPreview>) {
    if engine.stamp_preview == preview {
        return;
    }
    engine.stamp_preview = preview;
    engine.needs_present = true;
}

/// Draw the preview over the default framebuffer (`fb_w`×`fb_h` device
/// pixels). Called by `compositor::present` after the final blit.
pub(crate) fn draw(engine: &mut EngineInner, fb_w: i32, fb_h: i32) {
    let Some(preview) = engine.stamp_preview.clone() else {
        return;
    };
    let Some(&tex_handle) = engine.layer_textures.get(&preview.layer_id) else {
        return;
    };
    let Some((tw, th)) = engine.texture_pool.get_size(tex_handle) else {
        return;
    };
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }
    let (lx, ly) = engine
        .layer_stack
        .iter()
        .find(|l| l.id == preview.layer_id)
        .map(|l| (l.x as f32, l.y as f32))
        .unwrap_or((0.0, 0.0));
    let Some(rect) = viewport_disc_rect(
        preview.cursor,
        preview.radius,
        (engine.doc_width, engine.doc_height),
        &engine.viewport,
        (fb_w.max(0) as u32, fb_h.max(0) as u32),
    ) else {
        return;
    };

    engine
        .pass(&engine.shaders.stamp_preview, StampPreviewParams {
            resolution: [fb_w as f32, fb_h as f32],
            zoom: engine.viewport.zoom as f32,
            pan: [engine.viewport.pan_x as f32, engine.viewport.pan_y as f32],
            doc_size: [engine.doc_width as f32, engine.doc_height as f32],
            cursor: [preview.cursor.0 as f32, preview.cursor.1 as f32],
            source: [preview.source.0 as f32, preview.source.1 as f32],
            radius: preview.radius as f32,
            layer_origin: [lx, ly],
            layer_size: [tw as f32, th as f32],
            opacity: PREVIEW_OPACITY,
        })
        .texture("u_layerTex", tex_handle)
        // Keep the canvas alpha the final blit wrote; blend colour "over" it.
        .blend(Blend::OverKeepAlpha)
        .scissor(Scissor::Rect(rect))
        .draw(Target::Screen);
}
