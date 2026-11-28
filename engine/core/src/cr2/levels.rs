//! What a CR2's sensor data says about itself: the black level, measured on
//! the sensor's masked border; the white level, where clipped highlights
//! pile up; and the colour filter's layout, from the data and the camera's
//! own preview. Each was worked out on the real files listed in `cr2`'s
//! module notes.
//!
//! **Black.** Every sample has a masked border down the left of the
//! sensor, wider than the picture's crop leaves (84 to 168 columns). Its
//! inner columns already see light on every file (the last 12 to 36 before
//! the crop), and its outer ones are dark and flat; the left half of the
//! border is dark on all of them. The black level of each position of the
//! 2×2 pattern is the mean of that half over the picture's rows: 2048 on
//! the 5D Mark III and 7D, 1024 on the 40D, 512 on the 5D Mark IV, 128 on
//! the 20D and 127 on the G16.
//!
//! **White.** A sensor's clip shows as a pile of samples at one value (or
//! two neighbouring ones) near the top of the data: 15464 on the 5D Mark
//! III at ISO 200, 15283 on another 5D Mark III frame (with a lone hot
//! pixel at 16383 above it), 16383 on the 5D Mark IV, 4095 on the G16. A
//! frame with such a pile in the top half of its range clips there; a
//! frame without one has nothing clipped, and takes the top of its bit
//! depth. Canon's colour data holds levels that may be the clip, but no
//! value in it is the pile seen on the 5D Mark III, so it is not used.
//!
//! **The colour filter.** Most bodies' sensors start red, green / green,
//! blue at the top left, but not all: the 7D's starts with green. A body
//! whose layout its sample established is not measured again (`SAMPLED`).
//! For any other, the two greens are the diagonal pair whose samples, less
//! each position's black, differ least from each other inside each 2×2
//! block; when the two pairs differ by too little to say (a dark or noisy
//! frame), the layout every sampled body but one has is taken, and the
//! debug log says so. Which of the other two is red is read from the
//! camera's own preview: across a grid of cells, the log ratio of the two
//! positions follows the preview's log ratio of red to blue, and runs
//! against blue to red. A preview that says too little (a grey scene, or
//! none) leaves the choice to the as-shot white balance: the assignment
//! under which the balanced frame is nearer grey.

use super::Crop;

/// The levels and layout measured from the mosaic.
#[derive(Clone, Debug, PartialEq)]
pub struct Measured {
    /// The black level of each position of the sensor's 2×2 pattern,
    /// from its top-left corner.
    pub black: [f64; 4],
    pub white: u32,
    /// The colour of each position (0 red, 1 green, 2 blue), from the
    /// sensor's top-left corner.
    pub cfa: [u8; 4],
    /// How the white level and the colour filter were settled, for the
    /// debug log.
    pub white_source: String,
    pub cfa_source: String,
}

/// The sensor's black level per position, from the left half of its
/// masked border over the crop's rows. An error when there is no border.
pub fn black_level(mosaic: &[u16], width: usize, crop: Crop) -> Result<[f64; 4], String> {
    let cols = crop.left as usize / 2;
    if cols < 4 {
        return Err("This Canon RAW has no masked border to measure its black level on, which is not supported".into());
    }
    let (mut sum, mut n) = ([0f64; 4], [0f64; 4]);
    for y in crop.top as usize..(crop.top + crop.height) as usize {
        let row = &mosaic[y * width..y * width + cols];
        for (x, &v) in row.iter().enumerate() {
            let p = (y & 1) * 2 + (x & 1);
            sum[p] += f64::from(v);
            n[p] += 1.0;
        }
    }
    Ok([0, 1, 2, 3].map(|p| sum[p] / n[p].max(1.0)))
}

/// The white level: the top of the data where samples pile up there, else
/// the top of `bits`. With the value it came from, for the log.
pub fn white_level(mosaic: &[u16], width: usize, crop: Crop, bits: u8) -> (u32, String) {
    let full = (1u32 << bits) - 1;
    let mut hist = vec![0u32; full as usize + 1];
    for y in crop.top as usize..(crop.top + crop.height) as usize {
        for &v in &mosaic[y * width + crop.left as usize..y * width + (crop.left + crop.width) as usize] {
            hist[(u32::from(v)).min(full) as usize] += 1;
        }
    }
    // The most frequent value in the top half of the range, and how often
    // the values a little below it occur.
    let Some(peak) = (full / 2..=full).max_by_key(|&v| (hist[v as usize], v)) else {
        return (full, format!("{bits}-bit range"));
    };
    let at = hist[peak as usize];
    let below = (peak.saturating_sub(40)..peak.saturating_sub(8)).map(|v| u64::from(hist[v as usize])).sum::<u64>() as f64 / 32.0;
    if at >= 16 && f64::from(at) >= 8.0 * below.max(1.0) {
        // A pile can straddle two values; a lone hot pixel above it is not
        // the clip (one at 16383 on a 5D Mark III that clips at 15283).
        let white = (peak..=(peak + 8).min(full)).filter(|&v| hist[v as usize] >= at / 8).max().unwrap_or(peak);
        (white, format!("{at} samples piled at {peak}"))
    } else {
        (full, format!("{bits}-bit range (nothing piled in the top half)"))
    }
}

/// Sums of the black-subtracted samples of each 2×2 position over a grid
/// of `gx` × `gy` cells of the crop.
fn cell_sums(mosaic: &[u16], width: usize, crop: Crop, black: &[f64; 4], gx: usize, gy: usize) -> Vec<[f64; 4]> {
    let mut cells = vec![[0f64; 4]; gx * gy];
    let (cw, ch) = (crop.width as usize, crop.height as usize);
    for y in 0..ch {
        let sy = y + crop.top as usize;
        let row = &mosaic[sy * width..];
        let cy = (y * gy / ch).min(gy - 1);
        for x in 0..cw {
            let sx = x + crop.left as usize;
            let p = (sy & 1) * 2 + (sx & 1);
            cells[cy * gx + (x * gx / cw).min(gx - 1)][p] += f64::from(row[sx]) - black[p];
        }
    }
    cells
}

/// The two diagonal pairs of the 2×2 pattern: (0, 3) and (1, 2). The
/// greens are the pair whose samples, each less its position's black
/// level, differ least inside each block. The margin is how much less the
/// main diagonal's differ than the other's, from -1 to 1: positive when
/// the greens are on the main diagonal.
fn green_diagonal_margin(mosaic: &[u16], width: usize, crop: Crop, black: &[f64; 4]) -> f64 {
    let (mut main, mut anti) = (0f64, 0f64);
    // Every other block each way is plenty.
    let (x0, y0) = ((crop.left & !1) as usize, (crop.top & !1) as usize);
    let at = |y: usize, x: usize| f64::from(mosaic[y * width + x]) - black[(y & 1) * 2 + (x & 1)];
    for y in (y0..(crop.top + crop.height) as usize - 1).step_by(4) {
        for x in (x0..(crop.left + crop.width) as usize - 1).step_by(4) {
            main += (at(y, x) - at(y + 1, x + 1)).abs();
            anti += (at(y, x + 1) - at(y + 1, x)).abs();
        }
    }
    if main + anti <= 0.0 {
        0.0
    } else {
        (anti - main) / (anti + main)
    }
}

/// The margin below which the greens' diagonal is not taken as measured.
const MIN_GREEN_MARGIN: f64 = 0.1;

/// The colour filter of each body whose layout our own samples established
/// (measured on its sample file, the greens at a clear margin and red and
/// blue from its preview), from the sensor's top-left corner, by IFD0's
/// `Model`. Such a body is not measured again.
const SAMPLED: &[(&str, [u8; 4])] = &[
    ("Canon EOS 20D", [0, 1, 1, 2]),
    ("Canon EOS 40D", [0, 1, 1, 2]),
    ("Canon EOS 5D Mark III", [0, 1, 1, 2]),
    ("Canon EOS 5D Mark IV", [0, 1, 1, 2]),
    ("Canon EOS 7D", [1, 2, 0, 1]),
    ("Canon PowerShot G16", [0, 1, 1, 2]),
];

/// The layout every sampled body but one (the 7D) has: what a body not
/// sampled takes when its own data does not say clearly.
const COMMON: [u8; 4] = [0, 1, 1, 2];

/// Pearson correlation of two series.
fn correlation(x: &[f64], y: &[f64]) -> f64 {
    let n = x.len() as f64;
    if x.len() < 8 {
        return 0.0;
    }
    let (mx, my) = (x.iter().sum::<f64>() / n, y.iter().sum::<f64>() / n);
    let (mut sxy, mut sxx, mut syy) = (0.0, 0.0, 0.0);
    for (a, b) in x.iter().zip(y) {
        sxy += (a - mx) * (b - my);
        sxx += (a - mx).powi(2);
        syy += (b - my).powi(2);
    }
    if sxx <= 0.0 || syy <= 0.0 {
        0.0
    } else {
        sxy / (sxx * syy).sqrt()
    }
}

/// The camera's preview, decoded small: `width` × `height` RGB bytes, the
/// same view as the crop (not turned).
pub struct PreviewRgb {
    pub width: usize,
    pub height: usize,
    pub rgb: Vec<u8>,
}

/// The correlation below which the preview does not decide red and blue.
const MIN_CORRELATION: f64 = 0.3;

/// Measure the black and white levels and the colour filter's layout.
///
/// The colour filter of a body in [`SAMPLED`] is the table's. Any other's
/// is measured: the greens' diagonal when its margin is clear (else the
/// layout of [`COMMON`], and the log says so), then red and blue.
pub fn measure(mosaic: &[u16], width: usize, crop: Crop, bits: u8, gain: [f32; 3], preview: Option<&PreviewRgb>, model: &str) -> Result<Measured, String> {
    let black = black_level(mosaic, width, crop)?;
    let (white, white_source) = white_level(mosaic, width, crop, bits);
    if black.iter().any(|&b| b.partial_cmp(&f64::from(white)) != Some(std::cmp::Ordering::Less)) {
        return Err(format!("This Canon RAW's black level {black:?} is not below its white level {white}"));
    }
    let margin = green_diagonal_margin(mosaic, width, crop, &black);
    if let Some((_, cfa)) = SAMPLED.iter().find(|(m, _)| *m == model) {
        let cfa_source = format!("the layout sampled for the {model} (the greens' margin on this file {margin:+.3})");
        return Ok(Measured { black, white, cfa: *cfa, white_source, cfa_source });
    }
    if margin.abs() < MIN_GREEN_MARGIN {
        let cfa_source = format!("the layout every sampled body but one has: the greens' margin {margin:+.3} is not clear");
        return Ok(Measured { black, white, cfa: COMMON, white_source, cfa_source });
    }
    // The positions of green, and the other two (a, b) in order.
    let (greens, (a, b)) = if margin > 0.0 { ([0usize, 3], (1usize, 2usize)) } else { ([1, 2], (0, 3)) };
    let (gx, gy) = (48usize, 32usize);
    let cells = cell_sums(mosaic, width, crop, &black, gx, gy);
    // From the preview: a is red when ln(a / b) follows ln(R / B).
    let mut decided: Option<(bool, String)> = None;
    if let Some(p) = preview.filter(|p| p.width >= gx && p.height >= gy) {
        let mut pc = vec![[0f64; 3]; gx * gy];
        let mut clipped = vec![false; gx * gy];
        for y in 0..p.height {
            for x in 0..p.width {
                let c = (y * gy / p.height) * gx + x * gx / p.width;
                let px = &p.rgb[(y * p.width + x) * 3..(y * p.width + x) * 3 + 3];
                for k in 0..3 {
                    pc[c][k] += f64::from(px[k]);
                }
                clipped[c] |= px.iter().any(|&v| v >= 250 || v <= 4);
            }
        }
        let (mut xs, mut ys) = (Vec::new(), Vec::new());
        for i in 0..gx * gy {
            let (ra, rb) = (cells[i][a], cells[i][b]);
            if !clipped[i] && ra > 0.0 && rb > 0.0 && pc[i][0] > 0.0 && pc[i][2] > 0.0 {
                xs.push((ra / rb).ln());
                ys.push((pc[i][0] / pc[i][2]).ln());
            }
        }
        let r = correlation(&xs, &ys);
        if r.abs() >= MIN_CORRELATION {
            decided = Some((r > 0.0, format!("the camera's preview (correlation {r:+.3} over {} cells)", xs.len())));
        }
    }
    let (a_is_red, cfa_source) = decided.unwrap_or_else(|| {
        // The as-shot balance: which assignment leaves the frame nearer grey.
        let total = |p: usize| cells.iter().map(|c| c[p]).sum::<f64>().max(1.0);
        let g = (total(greens[0]) + total(greens[1])) / 2.0;
        let err = |red: usize, blue: usize| (total(red) * f64::from(gain[0]) / g).ln().abs() + (total(blue) * f64::from(gain[2]) / g).ln().abs();
        let (ea, eb) = (err(a, b), err(b, a));
        (ea <= eb, format!("the as-shot white balance (nearer grey by {:.3})", (ea - eb).abs()))
    });
    let mut cfa = [1u8; 4];
    cfa[a] = if a_is_red { 0 } else { 2 };
    cfa[b] = if a_is_red { 2 } else { 0 };
    let cfa_source = format!("{cfa_source}, the greens' margin {margin:+.3}");
    Ok(Measured { black, white, cfa, white_source, cfa_source })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A made-up 2×2-patterned mosaic (not a camera's): a masked border of
    /// `black` on the left, then a picture whose red varies left to right
    /// and blue top to bottom, on a pattern given from the top-left.
    fn mosaic(cfa: [u8; 4], black: u16, w: usize, h: usize, left: usize) -> Vec<u16> {
        let mut m = vec![black; w * h];
        for y in 0..h {
            for x in left..w {
                let v = match cfa[(y & 1) * 2 + (x & 1)] {
                    0 => 300 + (x * 900 / w) as u16,
                    1 => 700,
                    _ => 300 + (y * 900 / h) as u16,
                };
                m[y * w + x] = black + v;
            }
        }
        m
    }

    fn preview(w: usize, h: usize) -> PreviewRgb {
        let mut rgb = Vec::new();
        for y in 0..h {
            for x in 0..w {
                rgb.extend_from_slice(&[(40 + x * 160 / w) as u8, 128, (40 + y * 160 / h) as u8]);
            }
        }
        PreviewRgb { width: w, height: h, rgb }
    }

    #[test]
    fn the_layout_and_levels_are_read_back_for_every_pattern() {
        let (w, h, left) = (400, 200, 40);
        let crop = Crop { left: left as u32, top: 0, width: (w - left) as u32, height: h as u32 };
        for cfa in [[0, 1, 1, 2], [2, 1, 1, 0], [1, 0, 2, 1], [1, 2, 0, 1]] {
            let m = mosaic(cfa, 512, w, h, left);
            let got = measure(&m, w, crop, 14, [1.0, 1.0, 1.0], Some(&preview(96, 48)), "a body not sampled").unwrap();
            assert_eq!(got.cfa, cfa, "{}", got.cfa_source);
            assert!(got.cfa_source.contains("preview"));
            assert_eq!(got.black, [512.0; 4]);
            assert_eq!(got.white, 16383);
        }
    }

    #[test]
    fn a_pile_at_the_top_is_the_white_level() {
        let (w, h) = (64, 64);
        let crop = Crop { left: 16, top: 0, width: 48, height: 64 };
        let mut m = vec![100u16; w * h];
        for (i, v) in m.iter_mut().enumerate() {
            if i % w >= 16 {
                *v = if i % 7 == 0 { 3000 } else { 1000 + (i % 1000) as u16 };
            }
        }
        assert_eq!(white_level(&m, w, crop, 12).0, 3000);
        // A lone hot pixel above the pile is not the clip.
        m[w * 10 + 20] = 4000;
        assert_eq!(white_level(&m, w, crop, 12).0, 3000);
        // Nothing piled: the top of the range.
        for v in m.iter_mut().filter(|v| **v == 3000) {
            *v = 1500;
        }
        assert_eq!(white_level(&m, w, crop, 12).0, 4095);
        // No masked border: refused.
        let narrow = Crop { left: 6, top: 0, width: 48, height: 64 };
        assert!(black_level(&m, w, narrow).is_err());
    }
    /// A made-up dark, noisy mosaic (not a camera's) on red, green /
    /// green, blue: a few counts of signal under noise of about ±12, on a
    /// black level that differs by position by more than the signal.
    fn dark_noisy(w: usize, h: usize, left: usize, black: [u16; 4]) -> Vec<u16> {
        let mut seed = 0x2545_f491u32;
        let mut noise = || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            ((seed >> 16) % 25) as i32 - 12
        };
        let mut m = vec![0u16; w * h];
        for y in 0..h {
            for x in 0..w {
                let p = (y & 1) * 2 + (x & 1);
                let signal = if x < left { 0 } else { [3, 5, 5, 3][p] };
                m[y * w + x] = (i32::from(black[p]) + signal + noise()) as u16;
            }
        }
        m
    }

    #[test]
    fn a_dark_noisy_frame_of_a_body_not_sampled_takes_the_common_layout_and_says_so() {
        let (w, h, left) = (400, 200, 40);
        let crop = Crop { left: left as u32, top: 0, width: (w - left) as u32, height: h as u32 };
        // Compared with the black still in, the anti-diagonal's two positions
        // differ by 120 and the main one's by none: the greens would be put on
        // the wrong diagonal, a green or magenta picture.
        let m = dark_noisy(w, h, left, [2048, 1990, 2110, 2048]);
        let got = measure(&m, w, crop, 14, [2.0, 1.0, 1.5], None, "a body not sampled").unwrap();
        assert_eq!(got.cfa, COMMON, "{}", got.cfa_source);
        assert!(got.cfa_source.contains("not clear"), "{}", got.cfa_source);
    }

    #[test]
    fn a_sampled_body_takes_its_layout_whatever_its_data_says() {
        let (w, h, left) = (400, 200, 40);
        let crop = Crop { left: left as u32, top: 0, width: (w - left) as u32, height: h as u32 };
        // A frame laid out blue, green / green, red, as the 5D Mark III's is not.
        let m = mosaic([2, 1, 1, 0], 512, w, h, left);
        let got = measure(&m, w, crop, 14, [1.0, 1.0, 1.0], Some(&preview(96, 48)), "Canon EOS 5D Mark III").unwrap();
        assert_eq!(got.cfa, [0, 1, 1, 2]);
        assert!(got.cfa_source.contains("sampled"), "{}", got.cfa_source);
    }
}
