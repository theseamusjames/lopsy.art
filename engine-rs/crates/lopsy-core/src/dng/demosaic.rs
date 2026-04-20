/// Bilinear Bayer demosaicing.
///
/// CFA pattern is 4 bytes: [top-left, top-right, bottom-left, bottom-right]
/// where 0=Red, 1=Green, 2=Blue.
/// Common patterns: RGGB=[0,1,1,2], BGGR=[2,1,1,0], GRBG=[1,0,2,1], GBRG=[1,2,0,1]

pub fn bilinear(raw: &[f32], width: u32, height: u32, pattern: &[u8]) -> Vec<f32> {
    let w = width as usize;
    let h = height as usize;
    let mut rgb = vec![0.0f32; w * h * 3];

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

    rgb
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
