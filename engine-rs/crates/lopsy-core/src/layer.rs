use serde::{Deserialize, Serialize};
use crate::color::BlendMode;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LayerType {
    Raster,
    Text,
    Shape,
    Group,
    Adjustment,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlowDesc {
    pub enabled: bool,
    pub color: [f32; 4],
    pub size: f32,
    pub spread: f32,
    pub opacity: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShadowDesc {
    pub enabled: bool,
    pub color: [f32; 4],
    pub offset_x: f32,
    pub offset_y: f32,
    pub blur: f32,
    pub spread: f32,
    pub opacity: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrokeDesc {
    pub enabled: bool,
    pub color: [f32; 4],
    pub width: f32,
    pub position: StrokePosition,
    pub opacity: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StrokePosition {
    Outside,
    Inside,
    Center,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorOverlayDesc {
    pub enabled: bool,
    pub color: [f32; 4],
    pub opacity: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EffectsDesc {
    pub outer_glow: Option<GlowDesc>,
    pub inner_glow: Option<GlowDesc>,
    pub drop_shadow: Option<ShadowDesc>,
    pub stroke: Option<StrokeDesc>,
    pub color_overlay: Option<ColorOverlayDesc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaskDesc {
    pub enabled: bool,
    pub linked: bool,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerDesc {
    pub id: String,
    pub name: String,
    pub layer_type: LayerType,
    pub visible: bool,
    pub locked: bool,
    pub opacity: f32,
    pub blend_mode: BlendMode,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub clip_to_below: bool,
    #[serde(default)]
    pub effects: EffectsDesc,
    pub mask: Option<MaskDesc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_layer_desc_deserialize() {
        let json = r#"{
            "id": "layer1",
            "name": "Background",
            "layer_type": "Raster",
            "visible": true,
            "locked": false,
            "opacity": 1.0,
            "blend_mode": "Normal",
            "x": 0, "y": 0,
            "width": 1920, "height": 1080,
            "clip_to_below": false,
            "mask": null
        }"#;
        let desc: LayerDesc = serde_json::from_str(json).unwrap();
        assert_eq!(desc.id, "layer1");
        assert_eq!(desc.blend_mode, BlendMode::Normal);
        assert_eq!(desc.width, 1920);
        assert!(desc.mask.is_none());
    }
}
