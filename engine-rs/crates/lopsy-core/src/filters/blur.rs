/// Generate 1D Gaussian kernel
pub fn gaussian_kernel(radius: u32) -> Vec<f32> {
    let size = (radius * 2 + 1) as usize;
    let sigma = radius as f32 / 3.0;
    let mut kernel = vec![0.0f32; size];
    let mut sum = 0.0;

    for i in 0..size {
        let x = i as f32 - radius as f32;
        let v = (-x * x / (2.0 * sigma * sigma)).exp();
        kernel[i] = v;
        sum += v;
    }

    for v in &mut kernel {
        *v /= sum;
    }
    kernel
}

/// CPU separable Gaussian blur on RGBA data
pub fn gaussian_blur(data: &mut [u8], width: u32, height: u32, radius: u32) {
    if radius == 0 {
        return;
    }

    let kernel = gaussian_kernel(radius);
    let r = radius as i32;
    let w = width as i32;
    let h = height as i32;

    // Horizontal pass
    let mut temp = data.to_vec();
    for y in 0..h {
        for x in 0..w {
            let mut rgba = [0.0f32; 4];
            for k in -r..=r {
                let sx = (x + k).clamp(0, w - 1);
                let src = ((y * w + sx) * 4) as usize;
                let weight = kernel[(k + r) as usize];
                for c in 0..4 {
                    rgba[c] += data[src + c] as f32 * weight;
                }
            }
            let dst = ((y * w + x) * 4) as usize;
            for c in 0..4 {
                temp[dst + c] = rgba[c].round().clamp(0.0, 255.0) as u8;
            }
        }
    }

    // Vertical pass
    for y in 0..h {
        for x in 0..w {
            let mut rgba = [0.0f32; 4];
            for k in -r..=r {
                let sy = (y + k).clamp(0, h - 1);
                let src = ((sy * w + x) * 4) as usize;
                let weight = kernel[(k + r) as usize];
                for c in 0..4 {
                    rgba[c] += temp[src + c] as f32 * weight;
                }
            }
            let dst = ((y * w + x) * 4) as usize;
            for c in 0..4 {
                data[dst + c] = rgba[c].round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

/// CPU separable box blur on RGBA data
pub fn box_blur(data: &mut [u8], width: u32, height: u32, radius: u32) {
    if radius == 0 {
        return;
    }

    let r = radius as i32;
    let w = width as i32;
    let h = height as i32;
    let diam = (2 * r + 1) as f32;

    // Horizontal pass
    let mut temp = data.to_vec();
    for y in 0..h {
        for x in 0..w {
            let mut rgba = [0.0f32; 4];
            for k in -r..=r {
                let sx = (x + k).clamp(0, w - 1);
                let src = ((y * w + sx) * 4) as usize;
                for c in 0..4 {
                    rgba[c] += data[src + c] as f32;
                }
            }
            let dst = ((y * w + x) * 4) as usize;
            for c in 0..4 {
                temp[dst + c] = (rgba[c] / diam).round().clamp(0.0, 255.0) as u8;
            }
        }
    }

    // Vertical pass
    for y in 0..h {
        for x in 0..w {
            let mut rgba = [0.0f32; 4];
            for k in -r..=r {
                let sy = (y + k).clamp(0, h - 1);
                let src = ((sy * w + x) * 4) as usize;
                for c in 0..4 {
                    rgba[c] += temp[src + c] as f32;
                }
            }
            let dst = ((y * w + x) * 4) as usize;
            for c in 0..4 {
                data[dst + c] = (rgba[c] / diam).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gaussian_kernel_sums_to_one() {
        let kernel = gaussian_kernel(5);
        let sum: f32 = kernel.iter().sum();
        assert!((sum - 1.0).abs() < 1e-5);
    }

    #[test]
    fn test_gaussian_blur_uniform() {
        // Uniform image should stay uniform
        let mut data = vec![128u8; 10 * 10 * 4];
        gaussian_blur(&mut data, 10, 10, 2);
        for &v in &data {
            assert!((v as i32 - 128).unsigned_abs() <= 1);
        }
    }

    #[test]
    fn test_box_blur_uniform() {
        let mut data = vec![200u8; 8 * 8 * 4];
        box_blur(&mut data, 8, 8, 1);
        for &v in &data {
            assert!((v as i32 - 200).unsigned_abs() <= 1);
        }
    }

    #[test]
    fn test_blur_zero_radius() {
        let mut data = vec![100u8; 4 * 4 * 4];
        let original = data.clone();
        gaussian_blur(&mut data, 4, 4, 0);
        assert_eq!(data, original);
    }
}
