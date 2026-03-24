/// Simple hash function for deterministic noise
fn hash(x: u32, y: u32, seed: u32) -> u32 {
    let mut h = seed.wrapping_mul(374761393)
        .wrapping_add(x.wrapping_mul(668265263))
        .wrapping_add(y.wrapping_mul(2654435761));
    h = (h ^ (h >> 13)).wrapping_mul(1274126177);
    h ^ (h >> 16)
}

/// Add noise to existing pixel data
/// amount: 0.0..1.0
pub fn add_noise(data: &mut [u8], width: u32, height: u32, amount: f32, monochrome: bool, seed: u32) {
    let strength = (amount * 255.0) as i32;

    for y in 0..height {
        for x in 0..width {
            let base = ((y * width + x) * 4) as usize;

            if monochrome {
                let h = hash(x, y, seed);
                let noise = (h % (strength as u32 * 2 + 1)) as i32 - strength;
                for c in 0..3 {
                    data[base + c] = (data[base + c] as i32 + noise).clamp(0, 255) as u8;
                }
            } else {
                for c in 0..3u32 {
                    let h = hash(x, y, seed.wrapping_add(c * 7919));
                    let noise = (h % (strength as u32 * 2 + 1)) as i32 - strength;
                    data[base + c as usize] = (data[base + c as usize] as i32 + noise).clamp(0, 255) as u8;
                }
            }
        }
    }
}

/// Fill entire image with noise
pub fn fill_with_noise(data: &mut [u8], width: u32, height: u32, monochrome: bool, seed: u32) {
    for y in 0..height {
        for x in 0..width {
            let base = ((y * width + x) * 4) as usize;

            if monochrome {
                let h = hash(x, y, seed);
                let v = (h % 256) as u8;
                data[base] = v;
                data[base + 1] = v;
                data[base + 2] = v;
            } else {
                for c in 0..3u32 {
                    let h = hash(x, y, seed.wrapping_add(c * 7919));
                    data[base + c as usize] = (h % 256) as u8;
                }
            }
            data[base + 3] = 255;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_noise_deterministic() {
        let mut a = vec![128u8; 4 * 4 * 4];
        let mut b = a.clone();
        add_noise(&mut a, 4, 4, 0.5, false, 42);
        add_noise(&mut b, 4, 4, 0.5, false, 42);
        assert_eq!(a, b);
    }

    #[test]
    fn test_add_noise_different_seeds() {
        let mut a = vec![128u8; 4 * 4 * 4];
        let mut b = a.clone();
        add_noise(&mut a, 4, 4, 0.5, false, 42);
        add_noise(&mut b, 4, 4, 0.5, false, 99);
        assert_ne!(a, b);
    }

    #[test]
    fn test_monochrome_noise() {
        let mut data = vec![128u8; 4 * 4 * 4];
        add_noise(&mut data, 4, 4, 0.3, true, 1);
        // Each pixel should have equal R, G, B changes
        for i in 0..16 {
            let base = i * 4;
            let dr = data[base] as i32 - 128;
            let dg = data[base + 1] as i32 - 128;
            let db = data[base + 2] as i32 - 128;
            assert_eq!(dr, dg);
            assert_eq!(dg, db);
        }
    }

    #[test]
    fn test_fill_with_noise() {
        let mut data = vec![0u8; 4 * 4 * 4];
        fill_with_noise(&mut data, 4, 4, false, 42);
        // All alpha should be 255
        for i in 0..16 {
            assert_eq!(data[i * 4 + 3], 255);
        }
        // At least some variation
        let unique: std::collections::HashSet<u8> = data.iter().step_by(4).copied().collect();
        assert!(unique.len() > 1);
    }
}
