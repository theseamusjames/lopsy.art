//! PSD format I/O — export the current engine as a .psd file and parse
//! .psd files back into a layer manifest + per-layer pixel/mask readers.
//!
//! Heavy lifting lives in `lopsy_core::psd::{reader, writer}`. These
//! functions are thin wasm_bindgen wrappers that shuttle bytes and JSON
//! between the engine and the core PSD module.

use wasm_bindgen::prelude::*;

use lopsy_core::color::BlendMode;

use crate::Engine;
use crate::layer_manager;

// ============================================================
// PSD Export / Import
// ============================================================

/// Export the current document as a PSD file.
///
/// `layers_json`: JSON array of objects with layer metadata:
///   `{ id, name, visible, opacity, blendMode, x, y, width, height, clipToBelow, groupKind, maskWidth?, maskHeight?, maskX?, maskY?, maskOffset?, maskLength?, maskDefaultColor? }`
///
/// `mask_data`: all mask pixel data concatenated. Each layer references its slice via maskOffset + maskLength.
///
/// `depth`: 8 or 16.
///
/// Returns the PSD file as bytes.
#[wasm_bindgen(js_name = "exportPsd")]
pub fn export_psd(
    engine: &Engine,
    layers_json: &str,
    mask_data: &[u8],
    depth: u8,
) -> Result<Vec<u8>, JsError> {
    use lopsy_core::psd::types::*;
    use lopsy_core::psd::writer::write_psd;

    let psd_depth = match depth {
        16 => PsdDepth::Sixteen,
        _ => PsdDepth::Eight,
    };

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct LayerMeta {
        id: String,
        name: String,
        visible: bool,
        opacity: u8,
        blend_mode: u8,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        clip_to_below: bool,
        group_kind: u8, // 0=Normal, 1=GroupOpen, 2=GroupClosed, 3=GroupEnd
        mask_width: Option<u32>,
        mask_height: Option<u32>,
        mask_x: Option<i32>,
        mask_y: Option<i32>,
        mask_offset: Option<usize>,
        mask_length: Option<usize>,
        mask_default_color: Option<u8>,
    }

    let layer_metas: Vec<LayerMeta> = serde_json::from_str(layers_json)
        .map_err(|e| JsError::new(&format!("invalid layers JSON: {e}")))?;

    let mut psd_layers = Vec::with_capacity(layer_metas.len());

    for meta in &layer_metas {
        let blend_mode = BlendMode::from_u8(meta.blend_mode)
            .unwrap_or(BlendMode::Normal);

        let group_kind = match meta.group_kind {
            1 => GroupKind::GroupOpen,
            2 => GroupKind::GroupClosed,
            3 => GroupKind::GroupEnd,
            _ => GroupKind::Normal,
        };

        let pixel_data = if meta.width > 0 && meta.height > 0 && group_kind == GroupKind::Normal {
            match psd_depth {
                PsdDepth::Eight => {
                    layer_manager::read_pixels(&engine.inner, &meta.id)
                        .map_err(|e| JsError::new(&e))?
                }
                PsdDepth::Sixteen => {
                    let gpu_u16 = layer_manager::read_pixels_u16(&engine.inner, &meta.id)
                        .map_err(|e| JsError::new(&e))?;
                    let mut data16 = Vec::with_capacity(gpu_u16.len() * 2);
                    for &val in &gpu_u16 {
                        data16.extend_from_slice(&val.to_be_bytes());
                    }
                    data16
                }
            }
        } else {
            Vec::new()
        };

        // Extract mask data
        let mask = if let (Some(mw), Some(mh), Some(mx), Some(my), Some(offset), Some(length)) = (
            meta.mask_width, meta.mask_height,
            meta.mask_x, meta.mask_y,
            meta.mask_offset, meta.mask_length,
        ) {
            if mw > 0 && mh > 0 && offset + length <= mask_data.len() {
                Some(PsdMask {
                    rect: PsdRect::from_xywh(mx, my, mw, mh),
                    data: mask_data[offset..offset + length].to_vec(),
                    default_color: meta.mask_default_color.unwrap_or(0),
                })
            } else {
                None
            }
        } else {
            None
        };

        psd_layers.push(PsdLayer {
            name: meta.name.clone(),
            visible: meta.visible,
            opacity: meta.opacity,
            blend_mode,
            clip_to_below: meta.clip_to_below,
            rect: PsdRect::from_xywh(meta.x, meta.y, meta.width, meta.height),
            pixel_data,
            mask,
            group_kind,
        });
    }

    let doc = PsdDocument {
        width: engine.inner.doc_width,
        height: engine.inner.doc_height,
        depth: psd_depth,
        layers: psd_layers,
        icc_profile: None,
    };

    Ok(write_psd(&doc))
}

/// Parse a PSD file and return a JSON manifest describing the document.
///
/// Returns JSON: `{ width, height, depth, layers: [{ name, visible, opacity, blendMode, x, y, width, height, clipToBelow, groupKind, hasMask, maskX?, maskY?, maskWidth?, maskHeight? }] }`
///
/// Layer pixel data is uploaded directly to the GPU via `decodeAndUploadPsdLayer`.
#[wasm_bindgen(js_name = "parsePsd")]
pub fn parse_psd(data: &[u8]) -> Result<String, JsError> {
    use lopsy_core::psd::reader::read_psd;

    let doc = read_psd(data).map_err(|e| JsError::new(&e.to_string()))?;

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct LayerInfo {
        name: String,
        visible: bool,
        opacity: u8,
        blend_mode: u8,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        clip_to_below: bool,
        group_kind: u8,
        has_mask: bool,
        mask_x: Option<i32>,
        mask_y: Option<i32>,
        mask_width: Option<u32>,
        mask_height: Option<u32>,
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct DocInfo {
        width: u32,
        height: u32,
        depth: u8,
        layers: Vec<LayerInfo>,
    }

    let layers: Vec<LayerInfo> = doc.layers.iter().map(|l| {
        let group_kind = match l.group_kind {
            lopsy_core::psd::types::GroupKind::Normal => 0u8,
            lopsy_core::psd::types::GroupKind::GroupOpen => 1,
            lopsy_core::psd::types::GroupKind::GroupClosed => 2,
            lopsy_core::psd::types::GroupKind::GroupEnd => 3,
        };

        LayerInfo {
            name: l.name.clone(),
            visible: l.visible,
            opacity: l.opacity,
            blend_mode: l.blend_mode as u8,
            x: l.rect.left,
            y: l.rect.top,
            width: l.rect.width(),
            height: l.rect.height(),
            clip_to_below: l.clip_to_below,
            group_kind,
            has_mask: l.mask.is_some(),
            mask_x: l.mask.as_ref().map(|m| m.rect.left),
            mask_y: l.mask.as_ref().map(|m| m.rect.top),
            mask_width: l.mask.as_ref().map(|m| m.rect.width()),
            mask_height: l.mask.as_ref().map(|m| m.rect.height()),
        }
    }).collect();

    let doc_info = DocInfo {
        width: doc.width,
        height: doc.height,
        depth: doc.depth.bits_per_channel() as u8,
        layers,
    };

    serde_json::to_string(&doc_info)
        .map_err(|e| JsError::new(&format!("JSON serialize: {e}")))
}

/// Parse a PSD and upload a single layer's pixels directly to its GPU texture.
/// For 16-bit PSDs this preserves precision by uploading normalized f32 RGBA;
/// the JS side never sees the raw u16 pairs, so nothing gets truncated.
#[wasm_bindgen(js_name = "decodeAndUploadPsdLayer")]
pub fn decode_and_upload_psd_layer(
    engine: &mut Engine,
    layer_id: &str,
    data: &[u8],
    layer_index: u32,
) -> Result<(), JsError> {
    use lopsy_core::psd::reader::read_psd;
    use lopsy_core::psd::types::PsdDepth;

    let doc = read_psd(data).map_err(|e| JsError::new(&e.to_string()))?;
    let idx = layer_index as usize;

    let layer = doc.layers.get(idx)
        .ok_or_else(|| JsError::new(&format!("layer index {idx} out of range ({})", doc.layers.len())))?;

    let width = layer.rect.width();
    let height = layer.rect.height();
    if width == 0 || height == 0 || layer.pixel_data.is_empty() {
        return Ok(());
    }

    match doc.depth {
        PsdDepth::Eight => {
            layer_manager::upload_pixels(
                &mut engine.inner, layer_id, &layer.pixel_data, width, height, 0, 0,
            ).map_err(|e| JsError::new(&e))
        }
        PsdDepth::Sixteen => {
            let pixel_count = (width as usize) * (height as usize) * 4;
            let src = &layer.pixel_data;
            if src.len() < pixel_count * 2 {
                return Err(JsError::new("16-bit PSD layer: pixel_data too short"));
            }
            let mut f32_data = Vec::with_capacity(pixel_count);
            for p in 0..pixel_count {
                let hi = src[p * 2] as u16;
                let lo = src[p * 2 + 1] as u16;
                let val = (hi << 8) | lo;
                f32_data.push(val as f32 / 65535.0);
            }
            layer_manager::upload_pixels_f32(
                &mut engine.inner, layer_id, &f32_data, width, height,
            ).map_err(|e| JsError::new(&e))
        }
    }
}

/// Get the mask data for a specific layer from a parsed PSD file.
/// Returns grayscale u8 data, or empty vec if no mask.
#[wasm_bindgen(js_name = "getPsdLayerMask")]
pub fn get_psd_layer_mask(data: &[u8], layer_index: u32) -> Result<Vec<u8>, JsError> {
    use lopsy_core::psd::reader::read_psd;

    let doc = read_psd(data).map_err(|e| JsError::new(&e.to_string()))?;
    let idx = layer_index as usize;

    if idx >= doc.layers.len() {
        return Err(JsError::new(&format!("layer index {idx} out of range ({})", doc.layers.len())));
    }

    match &doc.layers[idx].mask {
        Some(mask) => Ok(mask.data.clone()),
        None => Ok(Vec::new()),
    }
}
