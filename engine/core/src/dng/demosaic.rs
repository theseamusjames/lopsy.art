/// Bilinear Bayer demosaicing.
///
/// CFA pattern is 4 bytes: [top-left, top-right, bottom-left, bottom-right]
/// where 0=Red, 1=Green, 2=Blue.
/// Common patterns: RGGB=[0,1,1,2], BGGR=[2,1,1,0], GRBG=[1,0,2,1], GBRG=[1,2,0,1]

pub fn bilinear(raw: &[f32], width: u32, height: u32, pattern: &[u8]) -> Vec<f32> {
    let mut rgb = vec![0.0f32; width as usize * height as usize * 3];
    bilinear_into(raw, width, height, pattern, &mut rgb);
    rgb
}

/// [`bilinear`], or `None` when its output cannot be allocated (a band
/// render returns a sentence then instead of aborting the worker).
pub fn try_bilinear(raw: &[f32], width: u32, height: u32, pattern: &[u8]) -> Option<Vec<f32>> {
    let n = (width as usize).checked_mul(height as usize)?.checked_mul(3)?;
    let mut rgb: Vec<f32> = Vec::new();
    rgb.try_reserve_exact(n).ok()?;
    rgb.resize(n, 0.0);
    bilinear_into(raw, width, height, pattern, &mut rgb);
    Some(rgb)
}

fn bilinear_into(raw: &[f32], width: u32, height: u32, pattern: &[u8], rgb: &mut [f32]) {
    let w = width as usize;
    let h = height as usize;

    // Map CFA pattern to per-pixel color channel
    let cfa = |row: usize, col: usize| -> usize {
        let pr = row & 1;
        let pc = col & 1;
        pattern[pr * 2 + pc] as usize
    };

    for row in 0..h {
        for col in 0..w {
            let idx = row * w + col;
            let color = cfa(row, col);
            let out = idx * 3;

            // Set the known channel
            rgb[out + color] = raw[idx];

            // Interpolate missing channels
            match color {
                0 => {
                    // Red pixel: interpolate G and B
                    rgb[out + 1] = avg_cross(raw, w, h, row, col);
                    rgb[out + 2] = avg_diag(raw, w, h, row, col);
                }
                2 => {
                    // Blue pixel: interpolate R and G
                    rgb[out + 0] = avg_diag(raw, w, h, row, col);
                    rgb[out + 1] = avg_cross(raw, w, h, row, col);
                }
                1 => {
                    // Green pixel: interpolate R and B
                    // Need to figure out which neighbors are R and which are B
                    let row_color = cfa(row, (col + 1) % 2);
                    let col_color = cfa((row + 1) % 2, col);
                    rgb[out + row_color] = avg_horiz(raw, w, row, col);
                    rgb[out + col_color] = avg_vert(raw, w, h, row, col);
                }
                _ => {}
            }
        }
    }
}

fn avg_cross(raw: &[f32], w: usize, h: usize, row: usize, col: usize) -> f32 {
    let mut sum = 0.0f32;
    let mut count = 0u32;
    if row > 0     { sum += raw[(row - 1) * w + col]; count += 1; }
    if row < h - 1 { sum += raw[(row + 1) * w + col]; count += 1; }
    if col > 0     { sum += raw[row * w + col - 1]; count += 1; }
    if col < w - 1 { sum += raw[row * w + col + 1]; count += 1; }
    if count > 0 { sum / count as f32 } else { 0.0 }
}

fn avg_diag(raw: &[f32], w: usize, h: usize, row: usize, col: usize) -> f32 {
    let mut sum = 0.0f32;
    let mut count = 0u32;
    if row > 0 && col > 0         { sum += raw[(row - 1) * w + col - 1]; count += 1; }
    if row > 0 && col < w - 1     { sum += raw[(row - 1) * w + col + 1]; count += 1; }
    if row < h - 1 && col > 0     { sum += raw[(row + 1) * w + col - 1]; count += 1; }
    if row < h - 1 && col < w - 1 { sum += raw[(row + 1) * w + col + 1]; count += 1; }
    if count > 0 { sum / count as f32 } else { 0.0 }
}

fn avg_horiz(raw: &[f32], w: usize, row: usize, col: usize) -> f32 {
    let mut sum = 0.0f32;
    let mut count = 0u32;
    if col > 0     { sum += raw[row * w + col - 1]; count += 1; }
    if col < w - 1 { sum += raw[row * w + col + 1]; count += 1; }
    if count > 0 { sum / count as f32 } else { 0.0 }
}

fn avg_vert(raw: &[f32], w: usize, h: usize, row: usize, col: usize) -> f32 {
    let mut sum = 0.0f32;
    let mut count = 0u32;
    if row > 0     { sum += raw[(row - 1) * w + col]; count += 1; }
    if row < h - 1 { sum += raw[(row + 1) * w + col]; count += 1; }
    if count > 0 { sum / count as f32 } else { 0.0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What the baked ARW, NEF and CR2 decodes rely on: a size that cannot
    /// be allocated is `None`, not an abort, and the input is not read.
    #[test]
    fn the_fallible_demosaic_refuses_a_size_it_cannot_allocate() {
        assert!(try_bilinear(&[], u32::MAX, u32::MAX, &[0, 1, 1, 2]).is_none());
    }

    #[test]
    fn the_fallible_demosaic_is_the_same_demosaic() {
        let raw: Vec<f32> = (0..6 * 4).map(|i| ((i * 37) % 11) as f32 / 10.0).collect();
        let want = bilinear(&raw, 6, 4, &[1, 0, 2, 1]);
        assert_eq!(try_bilinear(&raw, 6, 4, &[1, 0, 2, 1]), Some(want));
    }
}
