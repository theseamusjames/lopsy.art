use std::collections::VecDeque;

/// Flood fill: returns a mask (Vec<u8>) where 255 = filled, 0 = not filled.
/// pixel_data is RGBA, tolerance is 0-255 range for color matching.
pub fn flood_fill(
    pixel_data: &[u8],
    width: u32,
    height: u32,
    start_x: u32,
    start_y: u32,
    tolerance: u32,
    contiguous: bool,
) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    let total = w * h;

    if start_x >= width || start_y >= height {
        return vec![0u8; total];
    }

    let start_idx = (start_y as usize * w + start_x as usize) * 4;
    let target = [
        pixel_data[start_idx],
        pixel_data[start_idx + 1],
        pixel_data[start_idx + 2],
        pixel_data[start_idx + 3],
    ];

    let tol_sq = (tolerance as u64) * (tolerance as u64);

    let matches = |idx: usize| -> bool {
        let i = idx * 4;
        let dr = pixel_data[i] as i64 - target[0] as i64;
        let dg = pixel_data[i + 1] as i64 - target[1] as i64;
        let db = pixel_data[i + 2] as i64 - target[2] as i64;
        let da = pixel_data[i + 3] as i64 - target[3] as i64;
        (dr * dr + dg * dg + db * db + da * da) as u64 <= tol_sq
    };

    let mut mask = vec![0u8; total];

    if contiguous {
        let mut queue = VecDeque::new();
        let start = start_y as usize * w + start_x as usize;
        mask[start] = 255;
        queue.push_back(start);

        while let Some(pos) = queue.pop_front() {
            let x = pos % w;
            let y = pos / w;

            let neighbors = [
                if x > 0 { Some(pos - 1) } else { None },
                if x + 1 < w { Some(pos + 1) } else { None },
                if y > 0 { Some(pos - w) } else { None },
                if y + 1 < h { Some(pos + w) } else { None },
            ];

            for n in neighbors.into_iter().flatten() {
                if mask[n] == 0 && matches(n) {
                    mask[n] = 255;
                    queue.push_back(n);
                }
            }
        }
    } else {
        for i in 0..total {
            if matches(i) {
                mask[i] = 255;
            }
        }
    }

    mask
}

/// Graduated flood fill: same as flood_fill but mask values range 0-255
/// based on colour distance from the sampled colour relative to tolerance.
/// Pixels exactly matching the seed colour get 255; pixels at distance == tolerance get 0.
/// Uses the formula: mask[i] = clamp(255 - (dist / tolerance) * 255, 0, 255).
/// When tolerance is 0, falls back to binary (0 or 255).
pub fn flood_fill_graduated(
    pixel_data: &[u8],
    width: u32,
    height: u32,
    start_x: u32,
    start_y: u32,
    tolerance: u32,
    contiguous: bool,
) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    let total = w * h;

    if start_x >= width || start_y >= height {
        return vec![0u8; total];
    }

    let start_idx = (start_y as usize * w + start_x as usize) * 4;
    let target = [
        pixel_data[start_idx],
        pixel_data[start_idx + 1],
        pixel_data[start_idx + 2],
        pixel_data[start_idx + 3],
    ];

    let tol_sq = (tolerance as u64) * (tolerance as u64);

    // Returns color distance (Euclidean in RGBA space, squared)
    let dist_sq = |idx: usize| -> u64 {
        let i = idx * 4;
        let dr = pixel_data[i] as i64 - target[0] as i64;
        let dg = pixel_data[i + 1] as i64 - target[1] as i64;
        let db = pixel_data[i + 2] as i64 - target[2] as i64;
        let da = pixel_data[i + 3] as i64 - target[3] as i64;
        (dr * dr + dg * dg + db * db + da * da) as u64
    };

    let matches = |d: u64| -> bool { d <= tol_sq };

    // When tolerance is 0, use binary output (no gradient possible)
    let to_mask_val = |d: u64| -> u8 {
        if tolerance == 0 {
            if d == 0 { 255 } else { 0 }
        } else {
            let dist = (d as f64).sqrt();
            let tol = tolerance as f64;
            let v = (1.0 - dist / tol) * 255.0;
            v.round().clamp(0.0, 255.0) as u8
        }
    };

    let mut mask = vec![0u8; total];

    if contiguous {
        let mut queue = std::collections::VecDeque::new();
        let start = start_y as usize * w + start_x as usize;
        let d = dist_sq(start);
        if matches(d) {
            mask[start] = to_mask_val(d);
            queue.push_back(start);
        }

        while let Some(pos) = queue.pop_front() {
            let x = pos % w;
            let y = pos / w;

            let neighbors = [
                if x > 0 { Some(pos - 1) } else { None },
                if x + 1 < w { Some(pos + 1) } else { None },
                if y > 0 { Some(pos - w) } else { None },
                if y + 1 < h { Some(pos + w) } else { None },
            ];

            for n in neighbors.into_iter().flatten() {
                if mask[n] == 0 {
                    let d = dist_sq(n);
                    if matches(d) {
                        mask[n] = to_mask_val(d).max(1); // ensure visited pixels aren't re-queued
                        queue.push_back(n);
                    }
                }
            }
        }
    } else {
        for i in 0..total {
            let d = dist_sq(i);
            if matches(d) {
                mask[i] = to_mask_val(d);
            }
        }
    }

    mask
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_image(_w: u32, _h: u32, pixels: &[[u8; 4]]) -> Vec<u8> {
        pixels.iter().flat_map(|p| p.iter().copied()).collect()
    }

    #[test]
    fn test_contiguous_fill() {
        // 3x3 image: red center, white border
        #[rustfmt::skip]
        let pixels = [
            [255,255,255,255], [255,255,255,255], [255,255,255,255],
            [255,255,255,255], [255,0,0,255],     [255,255,255,255],
            [255,255,255,255], [255,255,255,255], [255,255,255,255],
        ];
        let data = make_image(3, 3, &pixels);
        let mask = flood_fill(&data, 3, 3, 0, 0, 0, true);
        // Should fill all white pixels (8 of 9) but not the red center
        assert_eq!(mask[4], 0); // center is red, not filled
        assert_eq!(mask[0], 255); // corner is white, filled
        assert_eq!(mask.iter().filter(|&&v| v == 255).count(), 8);
    }

    #[test]
    fn test_non_contiguous_fill() {
        // 3x3: two separate red regions with white between
        #[rustfmt::skip]
        let pixels = [
            [255,0,0,255], [255,255,255,255], [255,0,0,255],
            [255,255,255,255], [255,255,255,255], [255,255,255,255],
            [255,0,0,255], [255,255,255,255], [255,0,0,255],
        ];
        let data = make_image(3, 3, &pixels);
        let mask = flood_fill(&data, 3, 3, 0, 0, 0, false);
        // All red pixels should be filled
        assert_eq!(mask[0], 255);
        assert_eq!(mask[2], 255);
        assert_eq!(mask[6], 255);
        assert_eq!(mask[8], 255);
        assert_eq!(mask[1], 0); // white, not filled
    }

    #[test]
    fn test_tolerance() {
        // 2x2: slightly different reds
        let pixels = [
            [255, 0, 0, 255],
            [250, 5, 0, 255],
            [200, 0, 0, 255],
            [100, 0, 0, 255],
        ];
        let data = make_image(2, 2, &pixels);
        // Low tolerance: only exact match
        let mask = flood_fill(&data, 2, 2, 0, 0, 0, false);
        assert_eq!(mask[0], 255);
        assert_eq!(mask[1], 0);

        // Higher tolerance: match similar reds
        let mask = flood_fill(&data, 2, 2, 0, 0, 10, false);
        assert_eq!(mask[0], 255);
        assert_eq!(mask[1], 255); // within tolerance
        assert_eq!(mask[2], 0);   // too different
    }

    #[test]
    fn test_contiguous_blocked() {
        // 3x1: red, white barrier, red -- contiguous from left should not reach right
        let pixels = [
            [255, 0, 0, 255],
            [255, 255, 255, 255],
            [255, 0, 0, 255],
        ];
        let data = make_image(3, 1, &pixels);
        let mask = flood_fill(&data, 3, 1, 0, 0, 0, true);
        assert_eq!(mask[0], 255);
        assert_eq!(mask[1], 0);
        assert_eq!(mask[2], 0); // blocked by white
    }

    #[test]
    fn test_graduated_non_contiguous_falloff() {
        // 1x3: exact match, half-tolerance-distance, and at-tolerance-distance
        // Seed = [100, 0, 0, 255], tolerance = 100
        // pixel 0: dist = 0 → 255
        // pixel 1: dist ≈ 50 → ~127
        // pixel 2: dist = 100 → 0  (exactly at tolerance edge)
        let pixels: &[[u8; 4]] = &[
            [100, 0, 0, 255], // seed
            [100, 50, 0, 255], // dist = sqrt(50^2) = 50 → ~127
            [100, 100, 0, 255], // dist = sqrt(100^2) = 100 → 0
        ];
        let data = pixels.iter().flat_map(|p| p.iter().copied()).collect::<Vec<u8>>();
        let mask = flood_fill_graduated(&data, 3, 1, 0, 0, 100, false);
        assert_eq!(mask[0], 255); // exact match
        assert!(mask[1] > 100 && mask[1] < 200); // roughly half
        assert_eq!(mask[2], 0); // at tolerance boundary
    }

    #[test]
    fn test_graduated_zero_tolerance_is_binary() {
        let pixels: &[[u8; 4]] = &[
            [255, 0, 0, 255],
            [255, 0, 0, 255],
            [200, 0, 0, 255],
        ];
        let data = pixels.iter().flat_map(|p| p.iter().copied()).collect::<Vec<u8>>();
        let mask = flood_fill_graduated(&data, 3, 1, 0, 0, 0, false);
        assert_eq!(mask[0], 255);
        assert_eq!(mask[1], 255); // exact match
        assert_eq!(mask[2], 0);   // different color, zero tolerance
    }
}
