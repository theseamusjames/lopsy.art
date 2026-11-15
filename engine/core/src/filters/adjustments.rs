use crate::color::{rgb_to_hsl, hsl_to_rgb};

/// Apply brightness and contrast adjustment
/// brightness: -1.0..1.0, contrast: -1.0..1.0
pub fn brightness_contrast(data: &mut [u8], width: u32, height: u32, brightness: f32, contrast: f32) {
    let total = (width * height) as usize;
    let contrast_factor = (1.0 + contrast) / (1.0 - contrast.min(0.999));

    for i in 0..total {
        let base = i * 4;
        for c in 0..3 {
            let v = data[base + c] as f32 / 255.0;
            let adjusted = ((v - 0.5) * contrast_factor + 0.5 + brightness).clamp(0.0, 1.0);
            data[base + c] = (adjusted * 255.0 + 0.5) as u8;
        }
    }
}

/// Apply hue/saturation/lightness adjustment
/// hue: -180..180, saturation: -100..100, lightness: -100..100
///
/// Lightness blends towards black (negative) or white (positive) after the
/// hue/saturation change, matching the GPU shaders and Photoshop.
pub fn hue_saturation(data: &mut [u8], width: u32, height: u32, hue: f32, saturation: f32, lightness: f32) {
    let total = (width * height) as usize;
    let hue_shift = hue / 360.0;
    let sat_factor = 1.0 + saturation / 100.0;
    let light = lightness / 100.0;

    for i in 0..total {
        let base = i * 4;
        let r = data[base] as f32 / 255.0;
        let g = data[base + 1] as f32 / 255.0;
        let b = data[base + 2] as f32 / 255.0;

        let (mut h, mut s, l) = rgb_to_hsl(r, g, b);
        h = (h + hue_shift).rem_euclid(1.0);
        s = (s * sat_factor).clamp(0.0, 1.0);

        let (nr, ng, nb) = hsl_to_rgb(h, s, l);
        data[base] = (apply_lightness(nr, light) * 255.0 + 0.5) as u8;
        data[base + 1] = (apply_lightness(ng, light) * 255.0 + 0.5) as u8;
        data[base + 2] = (apply_lightness(nb, light) * 255.0 + 0.5) as u8;
    }
}

fn apply_lightness(c: f32, light: f32) -> f32 {
    if light < 0.0 { c * (1.0 + light) } else { c + (1.0 - c) * light }
}

/// Invert colors (keep alpha)
pub fn invert(data: &mut [u8], width: u32, height: u32) {
    let total = (width * height) as usize;
    for i in 0..total {
        let base = i * 4;
        data[base] = 255 - data[base];
        data[base + 1] = 255 - data[base + 1];
        data[base + 2] = 255 - data[base + 2];
    }
}

/// Convert to grayscale (luminance method)
pub fn desaturate(data: &mut [u8], width: u32, height: u32) {
    let total = (width * height) as usize;
    for i in 0..total {
        let base = i * 4;
        let lum = (0.2126 * data[base] as f32
            + 0.7152 * data[base + 1] as f32
            + 0.0722 * data[base + 2] as f32)
            .round()
            .clamp(0.0, 255.0) as u8;
        data[base] = lum;
        data[base + 1] = lum;
        data[base + 2] = lum;
    }
}

/// Reduce color levels per channel
pub fn posterize(data: &mut [u8], width: u32, height: u32, levels: u32) {
    if levels < 2 {
        return;
    }
    let total = (width * height) as usize;
    let levels_f = levels as f32;

    for i in 0..total {
        let base = i * 4;
        for c in 0..3 {
            let v = data[base + c] as f32 / 255.0;
            let quantized = (v * (levels_f - 1.0)).round() / (levels_f - 1.0);
            data[base + c] = (quantized * 255.0 + 0.5) as u8;
        }
    }
}

/// Binary threshold based on luminance
pub fn threshold(data: &mut [u8], width: u32, height: u32, level: u8) {
    let total = (width * height) as usize;
    for i in 0..total {
        let base = i * 4;
        let lum = (0.2126 * data[base] as f32
            + 0.7152 * data[base + 1] as f32
            + 0.0722 * data[base + 2] as f32) as u8;
        let v = if lum >= level { 255 } else { 0 };
        data[base] = v;
        data[base + 1] = v;
        data[base + 2] = v;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negative_lightness_darkens_pale_tints_without_saturating_them() {
        // #1302: cream #FFF3DC at Lightness -40 must become a darker beige
        // (~#999284), not a vivid orange.
        let mut data = vec![0xFF, 0xF3, 0xDC, 255];
        hue_saturation(&mut data, 1, 1, 0.0, 0.0, -40.0);
        assert_eq!(&data[..3], &[0x99, 0x92, 0x84]);
        assert_eq!(data[3], 255);
    }

    #[test]
    fn positive_lightness_blends_towards_white() {
        let mut data = vec![0, 100, 200, 255];
        hue_saturation(&mut data, 1, 1, 0.0, 0.0, 50.0);
        assert_eq!(&data[..3], &[128, 178, 228]);
    }

    #[test]
    fn full_lightness_reaches_black_and_white() {
        let mut dark = vec![0xFF, 0xF3, 0xDC, 255];
        hue_saturation(&mut dark, 1, 1, 0.0, 0.0, -100.0);
        assert_eq!(&dark[..3], &[0, 0, 0]);
        let mut light = vec![0x12, 0x34, 0x56, 255];
        hue_saturation(&mut light, 1, 1, 0.0, 0.0, 100.0);
        assert_eq!(&light[..3], &[255, 255, 255]);
    }

    #[test]
    fn test_invert() {
        let mut data = vec![100, 150, 200, 255, 0, 0, 0, 128];
        invert(&mut data, 2, 1);
        assert_eq!(data[0], 155);
        assert_eq!(data[1], 105);
        assert_eq!(data[2], 55);
        assert_eq!(data[3], 255); // alpha unchanged
        assert_eq!(data[4], 255);
    }

    #[test]
    fn test_invert_double() {
        let original = vec![42u8, 100, 200, 255];
        let mut data = original.clone();
        invert(&mut data, 1, 1);
        invert(&mut data, 1, 1);
        assert_eq!(data, original);
    }

    #[test]
    fn test_desaturate() {
        let mut data = vec![255, 0, 0, 255]; // red
        desaturate(&mut data, 1, 1);
        assert_eq!(data[0], data[1]);
        assert_eq!(data[1], data[2]);
        assert!(data[0] > 0 && data[0] < 255);
    }

    #[test]
    fn test_posterize_2_levels() {
        let mut data = vec![100, 150, 200, 255];
        posterize(&mut data, 1, 1, 2);
        // Each channel snaps to 0 or 255
        assert!(data[0] == 0 || data[0] == 255);
        assert!(data[1] == 0 || data[1] == 255);
        assert!(data[2] == 0 || data[2] == 255);
    }

    #[test]
    fn test_threshold() {
        let mut data = vec![200, 200, 200, 255, 10, 10, 10, 255];
        threshold(&mut data, 2, 1, 128);
        assert_eq!(data[0], 255);
        assert_eq!(data[4], 0);
    }

    #[test]
    fn test_brightness() {
        let mut data = vec![128, 128, 128, 255];
        brightness_contrast(&mut data, 1, 1, 0.2, 0.0);
        assert!(data[0] > 128);
    }
}
