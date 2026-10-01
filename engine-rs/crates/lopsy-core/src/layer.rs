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

impl StrokeDesc {
    /// How far past the layer's own edge the stroke paints, in pixels, or
    /// `None` when it adds nothing outside the layer (disabled, zero width,
    /// or an inside stroke). The drop shadow and outer glow are cast by the
    /// layer's silhouette grown by this much.
    pub fn outside_reach(&self) -> Option<f32> {
        if !self.enabled || self.width <= 0.0 {
            return None;
        }
        match self.position {
            StrokePosition::Inside => None,
            StrokePosition::Outside => Some(self.width),
            StrokePosition::Center => Some(self.width * 0.5),
        }
    }
}

/// A rectangle in document pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DocRect {
    pub x: f32,
    pub y: f32,
    pub width: u32,
    pub height: u32,
}

/// The region holding a layer's silhouette grown by a stroke reaching
/// `reach` px past its edge: the layer rect padded on every side. The extra
/// pixel keeps the ring's outermost texels off the region's border, where
/// sampling would clamp them.
pub fn stroke_silhouette_rect(layer: DocRect, reach: f32) -> DocRect {
    let pad = reach.max(0.0).ceil() as u32 + 1;
    DocRect {
        x: layer.x - pad as f32,
        y: layer.y - pad as f32,
        width: layer.width + 2 * pad,
        height: layer.height + 2 * pad,
    }
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

    fn stroke(position: StrokePosition, width: f32) -> StrokeDesc {
        StrokeDesc { enabled: true, color: [0.0, 0.0, 0.0, 1.0], width, position, opacity: 1.0 }
    }

    #[test]
    fn outside_reach_is_full_width_outside_and_half_width_centred() {
        assert_eq!(stroke(StrokePosition::Outside, 12.0).outside_reach(), Some(12.0));
        assert_eq!(stroke(StrokePosition::Center, 12.0).outside_reach(), Some(6.0));
    }

    #[test]
    fn inside_disabled_and_zero_width_strokes_do_not_grow_the_silhouette() {
        assert_eq!(stroke(StrokePosition::Inside, 12.0).outside_reach(), None);
        assert_eq!(stroke(StrokePosition::Outside, 0.0).outside_reach(), None);
        let mut off = stroke(StrokePosition::Outside, 12.0);
        off.enabled = false;
        assert_eq!(off.outside_reach(), None);
    }

    #[test]
    fn silhouette_rect_pads_every_side_past_the_stroke() {
        let layer = DocRect { x: 200.0, y: 150.0, width: 200, height: 100 };
        let rect = stroke_silhouette_rect(layer, 12.0);
        assert_eq!(rect, DocRect { x: 187.0, y: 137.0, width: 226, height: 126 });
        // A fractional reach rounds up so the ring's last texel still fits.
        let rect = stroke_silhouette_rect(layer, 2.5);
        assert_eq!(rect, DocRect { x: 196.0, y: 146.0, width: 208, height: 108 });
    }
}
