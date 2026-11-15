use crate::filters::blur::gaussian_blur;

/// Unsharp mask: sharpen by subtracting a blurred version
/// radius: blur radius, amount: strength (1.0 = normal), threshold: minimum difference to sharpen
pub fn unsharp_mask(data: &mut [u8], width: u32, height: u32, radius: u32, amount: f32, threshold: u8) {
    if radius == 0 || amount < 1e-7 {
        return;
    }

    let mut blurred = data.to_vec();
    gaussian_blur(&mut blurred, width, height, radius);

    let total = (width * height) as usize;
    for i in 0..total {
        let base = i * 4;
        for c in 0..3 {
            let orig = data[base + c] as f32;
            let blur = blurred[base + c] as f32;
            let diff = orig - blur;
            if diff.abs() >= threshold as f32 {
                let sharpened = orig + diff * amount;
                data[base + c] = sharpened.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unsharp_mask_uniform() {
        // Uniform image should stay the same
        let mut data = vec![128u8; 8 * 8 * 4];
        unsharp_mask(&mut data, 8, 8, 2, 1.5, 0);
        for &v in &data {
            assert!((v as i32 - 128).unsigned_abs() <= 2);
        }
    }

    #[test]
    fn test_unsharp_mask_zero_radius() {
        let mut data = vec![100u8; 4 * 4 * 4];
        let original = data.clone();
        unsharp_mask(&mut data, 4, 4, 0, 2.0, 0);
        assert_eq!(data, original);
    }
}
