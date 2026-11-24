//! Reconstruction of clipped channels, for the linear decode path.
//!
//! A sensor channel clips at the sensor, before any white balance, so which
//! samples are clipped is a property of the file. The develop stage applies
//! the user's white balance later, as a gain on the decoded data, so the
//! reconstruction is done once, here, on the white-balanced mosaic (camera
//! RGB at the as-shot balance), and its output is simply linear data that
//! may exceed the clip level. Lopsy's baked decode never runs it.
//!
//! # The method
//!
//! It follows the "inpaint opposed" idea as darktable's user manual
//! describes it (written from that description, not from any code): a
//! clipped channel is estimated from the channels that are not clipped
//! (the "opposed" ones) plus the colour difference measured on unclipped
//! pixels around the clipped region. Here:
//!
//! - **Chroma, measured once over the whole frame** ([`ChromaGrid::measure`]).
//!   The frame is cut into blocks that hold every colour (an X-Trans 3×3
//!   half-period, a Bayer 2×2). A block none of whose samples is near its
//!   clip level, and whose brightest channel is at least a quarter of its
//!   clip level, is a measurement: its log chroma `ln v − mean(ln v)` is
//!   added to its cell of a coarse grid (about 64 cells on the long edge),
//!   weighted by its brightness relative to clipping to the fourth power,
//!   so the bright surround of a highlight outweighs the dark parts of the
//!   cell. Cells with no measurement take the mean of their measured
//!   neighbours, growing inward until every cell has a value; a cell whose
//!   blocks are clipped in every channel is pulled toward neutral by the
//!   fraction of such blocks; then the grid is smoothed once (3×3). Read
//!   bilinearly between cell centres, the chroma is smooth across the
//!   frame, and being measured once, it is the same for every band and for
//!   the binned view.
//! - **The estimate, per sample** ([`estimate`]). For a sample of colour
//!   `c` near its clip, the mean of each colour in a small window around it
//!   gives the local values; each colour's closeness to clipping is a weight
//!   `w` from 0 (below 90 % of its clip level) to 1 (at 98 % and above),
//!   smooth in between. The brightness `ln Y` is the `(1 − w)`-weighted mean
//!   of `ln v_k − χ_k` over the other colours; as they clip too it blends
//!   into the largest lower bound `max_k(ln v_k − χ_k)` (every clipped value
//!   is a lower bound of the truth), and it is never below the sample's own
//!   `ln v − χ_c`. The estimate is `exp(ln Y + χ_c)`, and the sample becomes
//!   `v + w_c · max(0, estimate − v)`.
//!
//! So a sample below 90 % of its clip is untouched, reconstruction fades in
//! continuously over the last 10 % (no edge where it starts), the result is
//! never below the value it replaces, a coloured highlight keeps the hue of
//! its surround as it rises above the clip level, and where every channel
//! is clipped and the chroma is neutral every channel rises to the largest
//! of them: neutral, at or above the clip level.
//!
//! **On the mosaic, before the demosaic.** Clipped samples beside unclipped
//! ones of another colour are false colour edges, which a demosaic that
//! picks directions from colour differences (Markesteijn) turns into mazes
//! and fringes. Reconstructing first gives it consistent colour to work on.
//!
//! **Banding.** The estimate reads [`REACH_ROWS`] rows each way, which with
//! the demosaic's reach still fits the bands' halo, and the chroma comes
//! from the grid, so a band reconstructs exactly as the whole frame does.

use serde::{Deserialize, Serialize};

/// Fraction of a channel's clip level at which reconstruction starts.
pub const RAMP_START: f32 = 0.90;
/// Fraction of a channel's clip level from which a sample counts as fully
/// clipped. Clipped samples sit at the clip level itself.
pub const RAMP_END: f32 = 0.98;
/// A measurement block's brightest channel, as a fraction of its clip level,
/// must be at least this.
const MEASURE_FLOOR: f32 = 0.25;
/// Cells of the chroma grid on the frame's long edge, about: 126-pixel
/// cells on a 40 MP frame, local enough to tell a lamp from the sky beside
/// it, and a grid small enough to send to every band's worker as JSON.
const GRID_LONG_CELLS: usize = 64;
/// Logs are taken of values at least this, so black and negative samples
/// stay finite.
const LN_FLOOR: f32 = 1e-6;

/// Rows the estimate of a sample reads above and below it.
pub const REACH_ROWS: u32 = 2;

/// How clipped `v` is, given its channel clips at `clip`: 0 below
/// `RAMP_START` of it, 1 from `RAMP_END`, smoothstep between.
pub fn clip_weight(v: f32, clip: f32) -> f32 {
    if clip.is_nan() || clip <= 0.0 || !v.is_finite() {
        return 0.0;
    }
    let t = ((v / clip - RAMP_START) / (RAMP_END - RAMP_START)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The reconstructed value of a sample of colour `own` (0 R, 1 G, 2 B)
/// whose value is `v`, given the mean of each colour around it (`means`;
/// `means[own]` is not used), each colour's clip level and the log chroma
/// `chi` there. See the module notes.
pub fn estimate(own: usize, v: f32, means: [f32; 3], clip: [f32; 3], chi: [f32; 3]) -> f32 {
    let w_own = clip_weight(v, clip[own]);
    if w_own <= 0.0 {
        return v;
    }
    let ln = |x: f32| x.max(LN_FLOOR).ln();
    let own_bound = ln(v) - chi[own];
    let mut unclipped = 0.0f32;
    let mut weighted = 0.0f32;
    let mut bound = own_bound;
    for k in (0..3).filter(|&k| k != own) {
        let level = ln(means[k]) - chi[k];
        let free = 1.0 - clip_weight(means[k], clip[k]);
        unclipped += free;
        weighted += free * level;
        bound = bound.max(level);
    }
    let alpha = unclipped.min(1.0);
    let from_unclipped = if unclipped > 0.0 { weighted / unclipped } else { 0.0 };
    let ln_y = (alpha * from_unclipped + (1.0 - alpha) * bound).max(own_bound);
    let est = (ln_y + chi[own]).exp();
    v + w_own * (est - v).max(0.0)
}

/// The log chroma of a frame on a coarse grid, and the clip levels it was
/// measured against: what a linear render needs to reconstruct clipped
/// channels. Serialized into the render params (`highlightChroma`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromaGrid {
    pub cols: u32,
    pub rows: u32,
    /// Mosaic pixels per cell, each way; a multiple of 6.
    pub cell: u32,
    /// Each channel's clip level, in mosaic units (`RafRenderParams::clip_levels`).
    pub clip: [f32; 3],
    /// `ln v − mean(ln v)` for R, G and B, three per cell, row by row.
    pub chroma: Vec<f32>,
}

/// Side of the blocks chroma is measured on: the smallest that holds every
/// colour at each of its positions in the pattern.
fn block_size(cfa: &[u8], p: usize) -> usize {
    let holds_all = |b: usize| {
        (0..p).step_by(b).all(|py| {
            (0..p).step_by(b).all(|px| {
                let mut seen = [false; 3];
                for dy in 0..b {
                    for dx in 0..b {
                        seen[cfa[((py + dy) % p) * p + (px + dx) % p] as usize % 3] = true;
                    }
                }
                seen.iter().all(|&s| s)
            })
        })
    };
    if p == 6 && holds_all(3) {
        3
    } else {
        p
    }
}

impl ChromaGrid {
    /// Measure the chroma of a white-balanced mosaic of `w`×`h` (first row
    /// at CFA phase 0; `cfa` is the `p`×`p` pattern, 0 R, 1 G, 2 B) whose
    /// channels clip at `clip`. `None` when no sample reaches
    /// `RAMP_START` of its clip level: nothing to reconstruct.
    pub fn measure(mosaic: &[f32], w: usize, h: usize, cfa: &[u8], p: usize, clip: [f32; 3]) -> Option<Self> {
        if w == 0 || h == 0 || mosaic.len() < w * h || cfa.len() < p * p || clip.iter().any(|c| c.is_nan() || *c <= 0.0) {
            return None;
        }
        let b = block_size(cfa, p);
        let cell = w.max(h).div_ceil(GRID_LONG_CELLS).div_ceil(6).max(1) * 6;
        let (cols, rows) = (w.div_ceil(cell), h.div_ceil(cell));
        let n = cols * rows;
        let mut acc = vec![[0.0f64; 3]; n];
        let mut weight = vec![0.0f64; n];
        let mut full = vec![0u32; n];
        let mut blocks = vec![0u32; n];
        let start = clip.map(|c| RAMP_START * c);
        let mut any = false;
        for by in 0..h / b {
            for bx in 0..w / b {
                let mut sum = [0.0f32; 3];
                let mut count = [0u32; 3];
                let mut most = [0.0f32; 3];
                for dy in 0..b {
                    let row = by * b + dy;
                    let line = &mosaic[row * w + bx * b..row * w + bx * b + b];
                    for (dx, &v) in line.iter().enumerate() {
                        let c = cfa[(row % p) * p + (bx * b + dx) % p] as usize % 3;
                        sum[c] += v;
                        count[c] += 1;
                        if v >= start[c] {
                            most[c] = most[c].max(clip_weight(v, clip[c]));
                        }
                    }
                }
                let ci = (by * b / cell) * cols + bx * b / cell;
                blocks[ci] += 1;
                if most.iter().any(|&m| m > 0.0) {
                    any = true;
                    if most.iter().all(|&m| m >= 1.0) {
                        full[ci] += 1;
                    }
                    continue;
                }
                if count.contains(&0) {
                    continue;
                }
                let means: [f32; 3] = std::array::from_fn(|k| sum[k] / count[k] as f32);
                let t = (0..3).map(|k| means[k] / clip[k]).fold(0.0f32, f32::max);
                if t < MEASURE_FLOOR || means.iter().any(|&m| m <= LN_FLOOR) {
                    continue;
                }
                let ln = means.map(|m| f64::from(m).ln());
                let mid = (ln[0] + ln[1] + ln[2]) / 3.0;
                let wgt = f64::from(t).powi(4);
                for k in 0..3 {
                    acc[ci][k] += wgt * (ln[k] - mid);
                }
                weight[ci] += wgt;
            }
        }
        if !any {
            return None;
        }

        let mut chi = vec![[0.0f32; 3]; n];
        let mut known: Vec<bool> = weight.iter().map(|&w| w > 0.0).collect();
        for i in 0..n {
            if known[i] {
                chi[i] = acc[i].map(|a| (a / weight[i]) as f32);
            }
        }
        // Grow the measured cells inward, one ring at a time, so a cell deep
        // inside a clipped region takes the chroma of the nearest surround.
        if known.iter().any(|&k| k) {
            loop {
                let mut next = known.clone();
                let mut changed = false;
                for y in 0..rows {
                    for x in 0..cols {
                        let i = y * cols + x;
                        if known[i] {
                            continue;
                        }
                        let mut s = [0.0f32; 3];
                        let mut m = 0;
                        for ny in y.saturating_sub(1)..(y + 2).min(rows) {
                            for nx in x.saturating_sub(1)..(x + 2).min(cols) {
                                let j = ny * cols + nx;
                                if known[j] {
                                    (0..3).for_each(|k| s[k] += chi[j][k]);
                                    m += 1;
                                }
                            }
                        }
                        if m > 0 {
                            chi[i] = s.map(|v| v / m as f32);
                            next[i] = true;
                            changed = true;
                        }
                    }
                }
                known = next;
                if !changed {
                    break;
                }
            }
        }
        for i in 0..n {
            if blocks[i] > 0 {
                let keep = 1.0 - full[i] as f32 / blocks[i] as f32;
                chi[i] = chi[i].map(|v| v * keep);
            }
        }
        let mut chroma = Vec::with_capacity(n * 3);
        for y in 0..rows {
            for x in 0..cols {
                let mut s = [0.0f32; 3];
                let mut m = 0;
                for ny in y.saturating_sub(1)..(y + 2).min(rows) {
                    for nx in x.saturating_sub(1)..(x + 2).min(cols) {
                        (0..3).for_each(|k| s[k] += chi[ny * cols + nx][k]);
                        m += 1;
                    }
                }
                // Thousandths of a natural log are a tenth of a percent: far
                // below anything visible, and they keep the JSON short.
                chroma.extend(s.map(|v| (v / m as f32 * 1000.0).round() / 1000.0));
            }
        }
        Some(Self { cols: cols as u32, rows: rows as u32, cell: cell as u32, clip, chroma })
    }

    /// The log chroma at mosaic position (`x`, `y`) of the frame, bilinear
    /// between cell centres and held at the outer ones.
    pub fn chroma_at(&self, x: usize, y: usize) -> [f32; 3] {
        let (cols, rows) = (self.cols as usize, self.rows as usize);
        if cols == 0 || rows == 0 || self.chroma.len() < cols * rows * 3 {
            return [0.0; 3];
        }
        let cell = self.cell.max(1) as f32;
        let fx = ((x as f32 + 0.5) / cell - 0.5).clamp(0.0, (cols - 1) as f32);
        let fy = ((y as f32 + 0.5) / cell - 0.5).clamp(0.0, (rows - 1) as f32);
        let (x0, y0) = (fx as usize, fy as usize);
        let (x1, y1) = ((x0 + 1).min(cols - 1), (y0 + 1).min(rows - 1));
        let (tx, ty) = (fx - x0 as f32, fy - y0 as f32);
        let at = |cx: usize, cy: usize, k: usize| self.chroma[(cy * cols + cx) * 3 + k];
        std::array::from_fn(|k| {
            let top = at(x0, y0, k) * (1.0 - tx) + at(x1, y0, k) * tx;
            let bottom = at(x0, y1, k) * (1.0 - tx) + at(x1, y1, k) * tx;
            top * (1.0 - ty) + bottom * ty
        })
    }

    /// Per channel, the value below which a sample is certainly untouched:
    /// a little under `RAMP_START` of the clip level, so a sample at it
    /// still goes through [`estimate`], which leaves it as it is.
    pub fn thresholds(&self) -> [f32; 3] {
        self.clip.map(|c| 0.999 * RAMP_START * c)
    }

    /// The reconstructed value of the sample at column `x`, row `y` of
    /// `src`, which holds `rows` rows of a `w`-wide mosaic starting at frame
    /// row `y_offset` (a multiple of the CFA period `p`).
    #[allow(clippy::too_many_arguments)]
    pub fn sample(&self, src: &[f32], w: usize, rows: usize, x: usize, y: usize, y_offset: usize, cfa: &[u8], p: usize) -> f32 {
        let colour = |row: usize, col: usize| cfa[(row % p) * p + col % p] as usize % 3;
        let v = src[y * w + x];
        let own = colour(y, x);
        let r = if p == 6 { 2 } else { 1 };
        let mut sum = [0.0f32; 3];
        let mut count = [0u32; 3];
        for yy in y.saturating_sub(r)..(y + r + 1).min(rows) {
            for xx in x.saturating_sub(r)..(x + r + 1).min(w) {
                let c = colour(yy, xx);
                sum[c] += src[yy * w + xx];
                count[c] += 1;
            }
        }
        // Near an edge a window can miss a colour; that colour then tells
        // nothing, which a value at its clip level says (fully clipped
        // carries no estimate, only a lower bound).
        let means: [f32; 3] =
            std::array::from_fn(|k| if count[k] > 0 { sum[k] / count[k] as f32 } else { self.clip[k] });
        estimate(own, v, means, self.clip, self.chroma_at(x, y + y_offset))
    }

    /// `src` (`rows` rows of a `w`-wide mosaic from frame row `y_offset`)
    /// with every sample near its clip level reconstructed, or `None` when
    /// none changes. Each sample's estimate reads the original values, so
    /// the result does not depend on the order samples are visited.
    #[allow(clippy::too_many_arguments)]
    pub fn reconstruct(&self, src: &[f32], w: usize, rows: usize, y_offset: usize, cfa: &[u8], p: usize) -> Option<Vec<f32>> {
        let thresholds = self.thresholds();
        let mut updates: Vec<(usize, f32)> = Vec::new();
        for y in 0..rows {
            let line = &src[y * w..(y + 1) * w];
            for (x, &v) in line.iter().enumerate() {
                if v >= thresholds[cfa[(y % p) * p + x % p] as usize % 3] {
                    let out = self.sample(src, w, rows, x, y, y_offset, cfa, p);
                    if out.to_bits() != v.to_bits() {
                        updates.push((y * w + x, out));
                    }
                }
            }
        }
        if updates.is_empty() {
            return None;
        }
        let mut out = src[..w * rows].to_vec();
        for (i, v) in updates {
            out[i] = v;
        }
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLIP: [f32; 3] = [1.7, 1.0, 1.8];

    fn chi_of(c: [f32; 3]) -> [f32; 3] {
        let ln = c.map(f32::ln);
        let mid = (ln[0] + ln[1] + ln[2]) / 3.0;
        ln.map(|v| v - mid)
    }

    #[test]
    fn samples_below_the_ramp_are_untouched() {
        for v in [0.0f32, -0.01, 0.5, 0.89] {
            assert_eq!(estimate(1, v, [0.3, 0.0, 0.4], CLIP, [0.1, -0.2, 0.1]), v);
        }
        assert_eq!(clip_weight(0.9 * 1.0 - 1e-4, 1.0), 0.0);
        assert_eq!(clip_weight(0.98, 1.0), 1.0);
        assert_eq!(clip_weight(5.0, 1.0), 1.0);
    }

    #[test]
    fn one_clipped_channel_is_recovered_from_the_others_and_the_chroma() {
        // An orange highlight whose green would be 1.6 reads 1.0 (clipped);
        // red and blue are not clipped, and the chroma is the highlight's.
        let truth = [1.5f32, 1.6, 0.4];
        let chi = chi_of(truth);
        let got = estimate(1, 1.0, [truth[0], 0.0, truth[2]], CLIP, chi);
        assert!((got - 1.6).abs() < 1e-4, "{got}");
    }

    #[test]
    fn two_clipped_channels_follow_the_one_that_is_not() {
        let clip = [1.0f32, 1.0, 1.0];
        let truth = [3.0f32, 2.0, 0.5];
        let chi = chi_of(truth);
        let r = estimate(0, 1.0, [1.0, 1.0, 0.5], clip, chi);
        let g = estimate(1, 1.0, [1.0, 1.0, 0.5], clip, chi);
        assert!((r - 3.0).abs() < 1e-3 && (g - 2.0).abs() < 1e-3, "{r} {g}");
    }

    #[test]
    fn every_channel_clipped_with_neutral_chroma_goes_neutral_at_the_top() {
        let means = CLIP;
        let out: Vec<f32> = (0..3).map(|c| estimate(c, CLIP[c], means, CLIP, [0.0; 3])).collect();
        for v in &out {
            assert!((v - 1.8).abs() < 1e-5, "{out:?}");
        }
    }

    #[test]
    fn never_below_the_value_it_replaces() {
        let chis = [[0.0f32; 3], [0.5, -0.2, -0.3], [-0.6, 0.1, 0.5], [2.0, -1.0, -1.0]];
        for chi in chis {
            for own in 0..3 {
                for step in 0..=40 {
                    let v = CLIP[own] * (0.85 + step as f32 * 0.01);
                    for m in [0.01f32, 0.3, 1.0, 2.0] {
                        let means = [m * CLIP[0], m * CLIP[1], m * CLIP[2]];
                        let out = estimate(own, v, means, CLIP, chi);
                        assert!(out >= v, "own {own} v {v} means {means:?} chi {chi:?}: {out}");
                        assert!(out.is_finite());
                    }
                }
            }
        }
    }

    #[test]
    fn the_result_is_continuous_as_a_sample_crosses_its_clip_level() {
        // A green sample rising through the ramp beside unclipped red and
        // blue, and the same with red and blue clipping too: no step larger
        // than a small multiple of the input's.
        let chi = chi_of([1.2, 1.5, 0.6]);
        for others in [0.5f32, 0.95, 1.2] {
            let means = [others * CLIP[0], 0.0, others * CLIP[2]];
            let mut last = estimate(1, 0.85, means, CLIP, chi);
            for step in 1..=2000 {
                let v = 0.85 + step as f32 * 0.0001;
                let out = estimate(1, v, means, CLIP, chi);
                assert!((out - last).abs() < 0.01, "others {others}: jump at {v}: {last} -> {out}");
                last = out;
            }
        }
        // The others moving through their own ramps with the sample clipped.
        let mut last = estimate(1, 1.0, [0.85 * CLIP[0], 0.0, 0.85 * CLIP[2]], CLIP, chi);
        for step in 1..=2000 {
            let m = 0.85 + step as f32 * 0.0001;
            let out = estimate(1, 1.0, [m * CLIP[0], 0.0, m * CLIP[2]], CLIP, chi);
            assert!((out - last).abs() < 0.01, "jump at {m}: {last} -> {out}");
            last = out;
        }
    }

    #[test]
    fn x_trans_blocks_are_half_periods() {
        // The pattern the decoder falls back to, at the phase it aligns.
        let xtrans: [u8; 36] = [
            1, 0, 2, 1, 2, 0, 2, 1, 1, 0, 1, 1, 0, 1, 1, 2, 1, 1, 1, 2, 0, 1, 0, 2, 0, 1, 1, 2, 1, 1, 2, 1, 1, 0, 1, 1,
        ];
        assert_eq!(block_size(&xtrans, 6), 3);
        assert_eq!(block_size(&[0, 1, 1, 2], 2), 2);
    }

    #[test]
    fn chroma_grid_round_trips_through_json_exactly() {
        let g = ChromaGrid { cols: 2, rows: 1, cell: 6, clip: CLIP, chroma: vec![0.1, -0.3, 0.2, 0.001, 0.0, -0.001] };
        let back: ChromaGrid = serde_json::from_str(&serde_json::to_string(&g).unwrap()).unwrap();
        assert_eq!(back.chroma.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), g.chroma.iter().map(|v| v.to_bits()).collect::<Vec<_>>());
        assert_eq!(back, g);
    }

    /// A plain array standing for a white-balanced mosaic: an orange light
    /// whose brightness rises toward the middle, so green (the strongest
    /// channel here) clips in a disc while red and blue do not.
    fn orange_light(w: usize, h: usize, cfa: &[u8], p: usize, clip: [f32; 3]) -> Vec<f32> {
        let colour = [0.55f32, 1.0, 0.3];
        (0..h)
            .flat_map(|y| (0..w).map(move |x| (x, y)))
            .map(|(x, y)| {
                let (dx, dy) = (x as f32 - w as f32 / 2.0, y as f32 - h as f32 / 2.0);
                let bright = 1.6 * (-(dx * dx + dy * dy) / (2.0 * 14.0 * 14.0)).exp() + 0.2;
                let c = cfa[(y % p) * p + x % p] as usize % 3;
                (colour[c] * bright).min(clip[c])
            })
            .collect()
    }

    fn check_pattern(cfa: &[u8], p: usize) {
        let clip = [1.0f32, 1.0, 1.0];
        let (w, h) = (96usize, 96usize);
        let mosaic = orange_light(w, h, cfa, p, clip);
        let grid = ChromaGrid::measure(&mosaic, w, h, cfa, p, clip).expect("green clips");
        let whole = grid.reconstruct(&mosaic, w, h, 0, cfa, p).expect("something is reconstructed");
        // Rows [36, 60) rendered from their own rows plus the reach, as a
        // band would be, match the whole frame's.
        let (y0, y1, reach) = (36usize, 60usize, REACH_ROWS as usize + 4);
        let band = grid
            .reconstruct(&mosaic[(y0 - reach) * w..(y1 + reach) * w], w, y1 - y0 + 2 * reach, y0 - reach, cfa, p)
            .unwrap();
        for y in y0..y1 {
            for x in 0..w {
                assert_eq!(band[(y - y0 + reach) * w + x].to_bits(), whole[y * w + x].to_bits(), "({x}, {y})");
            }
        }
        // In the clipped disc, green rises above its clip level and keeps
        // close to the light's ratio to red: 1 / 0.55.
        let (cx, cy) = (w / 2, h / 2);
        let mut ratios = Vec::new();
        for y in cy - 3..cy + 3 {
            for x in cx - 3..cx + 3 {
                if cfa[(y % p) * p + x % p] == 1 {
                    assert!(whole[y * w + x] > 1.0, "green at ({x}, {y}) stayed at {}", whole[y * w + x]);
                    let red: Vec<f32> = (y - 2..=y + 2)
                        .flat_map(|yy| (x - 2..=x + 2).map(move |xx| (xx, yy)))
                        .filter(|&(xx, yy)| cfa[(yy % p) * p + xx % p] == 0)
                        .map(|(xx, yy)| mosaic[yy * w + xx])
                        .collect();
                    let red = red.iter().sum::<f32>() / red.len() as f32;
                    ratios.push(whole[y * w + x] / red);
                }
            }
        }
        let mean = ratios.iter().sum::<f32>() / ratios.len() as f32;
        assert!((mean - 1.0 / 0.55).abs() < 0.1 * (1.0 / 0.55), "green / red {mean}");
        // Nothing went down, and samples far below the clip did not move.
        for (i, (&a, &b)) in whole.iter().zip(&mosaic).enumerate() {
            assert!(a >= b, "sample {i} went down");
            if b < 0.85 {
                assert_eq!(a, b, "sample {i} moved");
            }
        }
    }

    #[test]
    fn a_clipped_light_keeps_its_colour_and_bands_exactly_on_bayer_and_x_trans() {
        check_pattern(&[0, 1, 1, 2], 2);
        let xtrans: [u8; 36] = [
            1, 0, 2, 1, 2, 0, 2, 1, 1, 0, 1, 1, 0, 1, 1, 2, 1, 1, 1, 2, 0, 1, 0, 2, 0, 1, 1, 2, 1, 1, 2, 1, 1, 0, 1, 1,
        ];
        check_pattern(&xtrans, 6);
    }
}
