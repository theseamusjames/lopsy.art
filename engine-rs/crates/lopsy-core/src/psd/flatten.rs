use crate::blend::blend_colors;
use crate::color::{srgb_to_linear, linear_to_srgb, Color};
use super::types::{PsdDocument, PsdDepth, GroupKind};

/// Deinterleaved channel planes for the PSD merged composite.
pub struct ChannelPlanes {
    pub r: Vec<u8>,
    pub g: Vec<u8>,
    pub b: Vec<u8>,
    pub a: Vec<u8>,
    pub depth: PsdDepth,
}

/// Flatten all visible layers into deinterleaved channel planes for the merged composite.
///
/// Layers are in bottom-to-top order. Groups are treated as pass-through.
/// Blending is done in linear light; the output is in sRGB.
pub fn flatten_layers(doc: &PsdDocument) -> ChannelPlanes {
    let w = doc.width as usize;
    let h = doc.height as usize;
    let pixel_count = w * h;

    // Composite buffer in linear float
    let mut comp = vec![Color::transparent(); pixel_count];

    for layer in &doc.layers {
        if !layer.visible || layer.group_kind != GroupKind::Normal {
            continue;
        }

        let lw = layer.rect.width() as usize;
        let lh = layer.rect.height() as usize;
        if lw == 0 || lh == 0 {
            continue;
        }

        let layer_opacity = layer.opacity as f32 / 255.0;

        for ly in 0..lh {
            let doc_y = layer.rect.top as isize + ly as isize;
            if doc_y < 0 || doc_y >= h as isize {
                continue;
            }
            let doc_y = doc_y as usize;

            for lx in 0..lw {
                let doc_x = layer.rect.left as isize + lx as isize;
                if doc_x < 0 || doc_x >= w as isize {
                    continue;
                }
                let doc_x = doc_x as usize;

                let src_color = read_pixel(&layer.pixel_data, lx, ly, lw, doc.depth);
                if src_color.a < 1e-7 {
                    continue;
                }

                // Apply layer mask
                let mask_factor = if let Some(ref mask) = layer.mask {
                    let mask_x = doc_x as i32 - mask.rect.left;
                    let mask_y = doc_y as i32 - mask.rect.top;
                    let mw = mask.rect.width() as i32;
                    let mh = mask.rect.height() as i32;
                    if mask_x >= 0 && mask_x < mw && mask_y >= 0 && mask_y < mh {
                        mask.data[(mask_y as usize) * (mw as usize) + mask_x as usize] as f32 / 255.0
                    } else {
                        mask.default_color as f32 / 255.0
                    }
                } else {
                    1.0
                };

                let effective_alpha = src_color.a * layer_opacity * mask_factor;
                if effective_alpha < 1e-7 {
                    continue;
                }

                let src = Color::new(src_color.r, src_color.g, src_color.b, effective_alpha);
                let idx = doc_y * w + doc_x;
                comp[idx] = blend_colors(src, comp[idx], layer.blend_mode);
            }
        }
    }

    // Convert from linear to sRGB and deinterleave into channel planes
    match doc.depth {
        PsdDepth::Eight => {
            let mut r = Vec::with_capacity(pixel_count);
            let mut g = Vec::with_capacity(pixel_count);
            let mut b = Vec::with_capacity(pixel_count);
            let mut a = Vec::with_capacity(pixel_count);

            for c in &comp {
                r.push(linear_to_srgb(c.r));
                g.push(linear_to_srgb(c.g));
                b.push(linear_to_srgb(c.b));
                a.push((c.a.clamp(0.0, 1.0) * 255.0 + 0.5) as u8);
            }

            ChannelPlanes { r, g, b, a, depth: PsdDepth::Eight }
        }
        PsdDepth::Sixteen => {
            // For 16-bit, each channel plane stores big-endian u16 bytes
            let mut r = Vec::with_capacity(pixel_count * 2);
            let mut g = Vec::with_capacity(pixel_count * 2);
            let mut b = Vec::with_capacity(pixel_count * 2);
            let mut a = Vec::with_capacity(pixel_count * 2);

            for c in &comp {
                let rv = (linear_to_srgb_f32(c.r) * 65535.0 + 0.5).clamp(0.0, 65535.0) as u16;
                let gv = (linear_to_srgb_f32(c.g) * 65535.0 + 0.5).clamp(0.0, 65535.0) as u16;
                let bv = (linear_to_srgb_f32(c.b) * 65535.0 + 0.5).clamp(0.0, 65535.0) as u16;
                let av = (c.a.clamp(0.0, 1.0) * 65535.0 + 0.5) as u16;
                r.extend_from_slice(&rv.to_be_bytes());
                g.extend_from_slice(&gv.to_be_bytes());
                b.extend_from_slice(&bv.to_be_bytes());
                a.extend_from_slice(&av.to_be_bytes());
            }

            ChannelPlanes { r, g, b, a, depth: PsdDepth::Sixteen }
        }
    }
}

/// Read one pixel from interleaved RGBA layer data, converting to linear Color.
fn read_pixel(data: &[u8], x: usize, y: usize, width: usize, depth: PsdDepth) -> Color {
    match depth {
        PsdDepth::Eight => {
            let idx = (y * width + x) * 4;
            if idx + 3 >= data.len() {
                return Color::transparent();
            }
            Color {
                r: srgb_to_linear(data[idx]),
                g: srgb_to_linear(data[idx + 1]),
                b: srgb_to_linear(data[idx + 2]),
                a: data[idx + 3] as f32 / 255.0,
            }
        }
        PsdDepth::Sixteen => {
            let idx = (y * width + x) * 8;
            if idx + 7 >= data.len() {
                return Color::transparent();
            }
            let r = u16::from_be_bytes([data[idx], data[idx + 1]]) as f32 / 65535.0;
            let g = u16::from_be_bytes([data[idx + 2], data[idx + 3]]) as f32 / 65535.0;
            let b = u16::from_be_bytes([data[idx + 4], data[idx + 5]]) as f32 / 65535.0;
            let a = u16::from_be_bytes([data[idx + 6], data[idx + 7]]) as f32 / 65535.0;
            // sRGB to linear for the color channels
            Color {
                r: srgb_to_linear_f32(r),
                g: srgb_to_linear_f32(g),
                b: srgb_to_linear_f32(b),
                a,
            }
        }
    }
}

/// sRGB EOTF for f32 input (0.0-1.0 range)
fn srgb_to_linear_f32(s: f32) -> f32 {
    if s <= 0.04045 {
        s / 12.92
    } else {
        ((s + 0.055) / 1.055).powf(2.4)
    }
}

/// sRGB OETF returning f32 (0.0-1.0 range), for 16-bit output
fn linear_to_srgb_f32(c: f32) -> f32 {
    let v = c.clamp(0.0, 1.0);
    if v <= 0.0031308 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::BlendMode;
    use super::super::types::{PsdDocument, PsdLayer, PsdRect, PsdDepth, GroupKind};

    fn solid_layer_8bit(x: i32, y: i32, w: u32, h: u32, r: u8, g: u8, b: u8, a: u8, mode: BlendMode) -> PsdLayer {
        let pixel_count = (w * h) as usize;
        let mut data = Vec::with_capacity(pixel_count * 4);
        for _ in 0..pixel_count {
            data.extend_from_slice(&[r, g, b, a]);
        }
        PsdLayer {
            name: "test".to_string(),
            visible: true,
            opacity: 255,
            blend_mode: mode,
            clip_to_below: false,
            rect: PsdRect::from_xywh(x, y, w, h),
            pixel_data: data,
            mask: None,
            group_kind: GroupKind::Normal,
            effects_json: None,
        }
    }

    #[test]
    fn flatten_single_opaque_layer() {
        let doc = PsdDocument {
            width: 2,
            height: 2,
            depth: PsdDepth::Eight,
            layers: vec![solid_layer_8bit(0, 0, 2, 2, 255, 0, 0, 255, BlendMode::Normal)],
            icc_profile: None,
        };
        let planes = flatten_layers(&doc);
        assert_eq!(planes.r, vec![255, 255, 255, 255]);
        assert_eq!(planes.g, vec![0, 0, 0, 0]);
        assert_eq!(planes.b, vec![0, 0, 0, 0]);
        assert_eq!(planes.a, vec![255, 255, 255, 255]);
    }

    #[test]
    fn flatten_transparent_over_opaque() {
        let doc = PsdDocument {
            width: 1,
            height: 1,
            depth: PsdDepth::Eight,
            layers: vec![
                solid_layer_8bit(0, 0, 1, 1, 0, 0, 255, 255, BlendMode::Normal), // blue bg
                solid_layer_8bit(0, 0, 1, 1, 255, 0, 0, 128, BlendMode::Normal), // red 50%
            ],
            icc_profile: None,
        };
        let planes = flatten_layers(&doc);
        // Should be a blend of red over blue at ~50% opacity
        assert!(planes.r[0] > 100); // has red
        assert!(planes.b[0] > 50);  // has some blue
        assert_eq!(planes.a[0], 255);
    }

    #[test]
    fn flatten_invisible_layer_ignored() {
        let mut layer = solid_layer_8bit(0, 0, 1, 1, 255, 0, 0, 255, BlendMode::Normal);
        layer.visible = false;
        let doc = PsdDocument {
            width: 1,
            height: 1,
            depth: PsdDepth::Eight,
            layers: vec![layer],
            icc_profile: None,
        };
        let planes = flatten_layers(&doc);
        assert_eq!(planes.a[0], 0);
    }

    #[test]
    fn flatten_layer_with_offset() {
        // 2x2 doc, 1x1 layer at position (1, 1)
        let doc = PsdDocument {
            width: 2,
            height: 2,
            depth: PsdDepth::Eight,
            layers: vec![solid_layer_8bit(1, 1, 1, 1, 0, 255, 0, 255, BlendMode::Normal)],
            icc_profile: None,
        };
        let planes = flatten_layers(&doc);
        // Only bottom-right pixel should be opaque
        assert_eq!(planes.a[0], 0); // (0,0)
        assert_eq!(planes.a[1], 0); // (1,0)
        assert_eq!(planes.a[2], 0); // (0,1)
        assert_eq!(planes.a[3], 255); // (1,1)
    }

    #[test]
    fn flatten_multiply_blend() {
        let doc = PsdDocument {
            width: 1,
            height: 1,
            depth: PsdDepth::Eight,
            layers: vec![
                solid_layer_8bit(0, 0, 1, 1, 255, 255, 255, 255, BlendMode::Normal),
                solid_layer_8bit(0, 0, 1, 1, 128, 128, 128, 255, BlendMode::Multiply),
            ],
            icc_profile: None,
        };
        let planes = flatten_layers(&doc);
        // Multiply: white * mid-gray (in linear) should produce mid-gray
        assert!(planes.r[0] < 200 && planes.r[0] > 50);
    }
}
