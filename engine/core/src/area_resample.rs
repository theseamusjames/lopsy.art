//! Area (box) downscale of RGBA f32 images, band by band.
//!
//! Each destination pixel is the mean of the source area it covers: a
//! source pixel wholly inside that area counts fully, one on its edge by
//! the fraction of it inside, so any scale works, whole or not. Every
//! channel is averaged as it is, alpha too, so it is meant for opaque
//! pictures (a RAW frame, a decoded photo), whose values may be linear and
//! may go above 1.
//!
//! The filter is separable: each source row is reduced across, then the
//! reduced rows down. Each destination pixel's weights depend only on its
//! own position, never on which band it was made in, so a picture reduced
//! band by band is bit for bit the one reduced whole ([`AreaScale::reduce`]
//! takes any rectangle of the source that covers the destination rectangle
//! asked for). That lets a large picture be reduced without ever holding
//! it whole: [`AreaScale::source_rows`] says which source rows a band of
//! destination rows needs.

/// A rectangle of pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PixelRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl PixelRect {
    pub fn new(x: u32, y: u32, width: u32, height: u32) -> Self {
        PixelRect { x, y, width, height }
    }

    fn right(&self) -> u64 {
        u64::from(self.x) + u64::from(self.width)
    }

    fn bottom(&self) -> u64 {
        u64::from(self.y) + u64::from(self.height)
    }
}

/// The source pixels one destination pixel reads along one axis, and how
/// much each counts.
#[derive(Clone, Debug)]
struct Taps {
    first: u32,
    weights: Vec<f64>,
}

/// One axis: `src` source pixels onto `dst` destination pixels.
#[derive(Clone, Debug)]
struct Axis {
    taps: Vec<Taps>,
}

impl Axis {
    /// Destination pixel `d` covers `[d·src, (d+1)·src)` in units where a
    /// source pixel `c` is `[c·dst, (c+1)·dst)`: integers, so the overlaps
    /// (and the weights' sum, `src`) are exact before the one division.
    fn new(src: u32, dst: u32) -> Self {
        let (s, d) = (u64::from(src), u64::from(dst));
        let taps = (0..d)
            .map(|i| {
                let start = i * s;
                let end = (i + 1) * s;
                let first = start / d;
                let last = end.div_ceil(d);
                let weights = (first..last)
                    .map(|c| {
                        let overlap = ((c + 1) * d).min(end) - (c * d).max(start);
                        overlap as f64 / s as f64
                    })
                    .collect();
                Taps { first: first as u32, weights }
            })
            .collect();
        Axis { taps }
    }

    /// The source span `[first, last)` destination pixels `[d0, d1)` read.
    fn span(&self, d0: u32, d1: u32) -> (u32, u32) {
        let first = self.taps[d0 as usize].first;
        let last = &self.taps[d1 as usize - 1];
        (first, last.first + last.weights.len() as u32)
    }
}

/// A downscale of a `src_width`×`src_height` picture to
/// `dst_width`×`dst_height`, each side no larger than the source's.
#[derive(Clone, Debug)]
pub struct AreaScale {
    src_width: u32,
    src_height: u32,
    dst_width: u32,
    dst_height: u32,
    x: Axis,
    y: Axis,
}

/// The sentence for an output that cannot be allocated.
const NO_MEMORY: &str = "not enough memory to reduce the picture";

fn try_zeroed(n: usize) -> Result<Vec<f32>, String> {
    let mut v = Vec::new();
    v.try_reserve_exact(n).map_err(|_| NO_MEMORY.to_string())?;
    v.resize(n, 0.0);
    Ok(v)
}

impl AreaScale {
    pub fn new(src_width: u32, src_height: u32, dst_width: u32, dst_height: u32) -> Result<Self, String> {
        let fits = (1..=src_width).contains(&dst_width) && (1..=src_height).contains(&dst_height);
        if !fits {
            return Err(format!("cannot reduce a {src_width}×{src_height} picture to {dst_width}×{dst_height}"));
        }
        Ok(AreaScale {
            src_width,
            src_height,
            dst_width,
            dst_height,
            x: Axis::new(src_width, dst_width),
            y: Axis::new(src_height, dst_height),
        })
    }

    pub fn dst_size(&self) -> (u32, u32) {
        (self.dst_width, self.dst_height)
    }

    /// The source rows `[first, last)` destination rows `[y0, y1)` read.
    pub fn source_rows(&self, y0: u32, y1: u32) -> (u32, u32) {
        self.y.span(y0, y1)
    }

    /// The source columns `[first, last)` destination columns `[x0, x1)` read.
    pub fn source_columns(&self, x0: u32, x1: u32) -> (u32, u32) {
        self.x.span(x0, x1)
    }

    /// The destination rectangle `dst` (RGBA f32, row-major), from `src`,
    /// which holds the source rectangle `src_rect` (RGBA f32, row-major).
    /// `src_rect` must cover every source pixel `dst` reads
    /// ([`AreaScale::source_rows`], [`AreaScale::source_columns`]); what
    /// else it holds is not read.
    pub fn reduce(&self, src: &[f32], src_rect: PixelRect, dst: PixelRect) -> Result<Vec<f32>, String> {
        let inside = dst.width > 0
            && dst.height > 0
            && dst.right() <= u64::from(self.dst_width)
            && dst.bottom() <= u64::from(self.dst_height)
            && src_rect.right() <= u64::from(self.src_width)
            && src_rect.bottom() <= u64::from(self.src_height);
        if !inside {
            return Err(format!("{dst:?} or {src_rect:?} is outside the {}×{} reduction", self.dst_width, self.dst_height));
        }
        if src.len() != src_rect.width as usize * src_rect.height as usize * 4 {
            return Err(format!("the source holds {} values, not {}×{} RGBA pixels", src.len(), src_rect.width, src_rect.height));
        }
        let (row0, row1) = self.source_rows(dst.y, dst.y + dst.height);
        let (col0, col1) = self.source_columns(dst.x, dst.x + dst.width);
        let covers = src_rect.x <= col0 && u64::from(col1) <= src_rect.right() && src_rect.y <= row0 && u64::from(row1) <= src_rect.bottom();
        if !covers {
            return Err(format!("{src_rect:?} does not cover columns {col0}..{col1} and rows {row0}..{row1}, which {dst:?} reads"));
        }

        // Across: each source row `row0..row1` to the destination's columns.
        let dw = dst.width as usize;
        let stride = src_rect.width as usize * 4;
        let mut across = try_zeroed((row1 - row0) as usize * dw * 4)?;
        for (r, out_row) in (row0..row1).zip(across.chunks_exact_mut(dw * 4)) {
            let row = &src[(r - src_rect.y) as usize * stride..][..stride];
            for (taps, out) in self.x.taps[dst.x as usize..][..dw].iter().zip(out_row.chunks_exact_mut(4)) {
                let mut acc = [0.0f64; 4];
                for (k, &w) in taps.weights.iter().enumerate() {
                    let at = (taps.first - src_rect.x) as usize + k;
                    for (a, &v) in acc.iter_mut().zip(&row[at * 4..at * 4 + 4]) {
                        *a += w * f64::from(v);
                    }
                }
                for (o, a) in out.iter_mut().zip(acc) {
                    *o = a as f32;
                }
            }
        }

        // Down: the reduced rows to the destination's rows.
        let mut out = try_zeroed(dw * dst.height as usize * 4)?;
        for (taps, out_row) in self.y.taps[dst.y as usize..][..dst.height as usize].iter().zip(out.chunks_exact_mut(dw * 4)) {
            for (i, o) in out_row.iter_mut().enumerate() {
                let mut acc = 0.0f64;
                for (k, &w) in taps.weights.iter().enumerate() {
                    let r = (taps.first - row0) as usize + k;
                    acc += w * f64::from(across[r * dw * 4 + i]);
                }
                *o = acc as f32;
            }
        }
        Ok(out)
    }
}

/// The largest size within `max_side` on each side with the aspect of
/// `width`×`height`: the size itself when it fits, otherwise the long side
/// at `max_side` and the short one rounded, at least 1. The same rounding
/// as the app's `limitSize` (`apps/photonamous/src/engine/viewport.ts`).
pub fn fit_within(width: u32, height: u32, max_side: u32) -> (u32, u32) {
    let long = width.max(height);
    if long <= max_side || long == 0 {
        return (width, height);
    }
    let scale = f64::from(max_side) / f64::from(long);
    let side = |v: u32| ((f64::from(v) * scale).round() as u32).max(1);
    (side(width), side(height))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A `w`×`h` RGBA picture whose pixel (x, y) is `f(x, y)` in every
    /// colour channel, alpha 1.
    fn picture(w: u32, h: u32, f: impl Fn(u32, u32) -> f32) -> Vec<f32> {
        (0..h).flat_map(|y| (0..w).map(move |x| (x, y))).flat_map(|(x, y)| [f(x, y), f(x, y) * 0.5, f(x, y) + 1.0, 1.0]).collect()
    }

    fn whole(scale: &AreaScale, src: &[f32]) -> Vec<f32> {
        let (dw, dh) = scale.dst_size();
        scale.reduce(src, PixelRect::new(0, 0, scale.src_width, scale.src_height), PixelRect::new(0, 0, dw, dh)).unwrap()
    }

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() <= 1e-6 * b.abs().max(1.0)
    }

    #[test]
    fn a_constant_picture_stays_constant_at_any_scale() {
        for &(sw, sh, dw, dh) in &[(9, 7, 4, 3), (8368, 3, 8192, 2), (5, 5, 5, 5), (100, 60, 37, 22), (3, 3, 1, 1)] {
            let src = picture(sw, sh, |_, _| 0.734_15);
            let out = whole(&AreaScale::new(sw, sh, dw, dh).unwrap(), &src);
            assert_eq!(out.len(), (dw * dh * 4) as usize);
            for px in out.chunks_exact(4) {
                assert_eq!(px, [0.734_15, 0.734_15 * 0.5, 0.734_15 + 1.0, 1.0], "{sw}×{sh} → {dw}×{dh}");
            }
        }
    }

    #[test]
    fn two_to_one_is_the_mean_of_each_two_by_two_block() {
        // 4×2 → 2×1; values in red: row 0 = 1 2 3 4, row 1 = 5 6 7 8.
        let src = picture(4, 2, |x, y| (y * 4 + x + 1) as f32);
        let out = whole(&AreaScale::new(4, 2, 2, 1).unwrap(), &src);
        // (1 + 2 + 5 + 6) / 4 and (3 + 4 + 7 + 8) / 4.
        assert_eq!(out[0], 3.5);
        assert_eq!(out[4], 5.5);
        assert_eq!(out[1], 1.75);
        assert_eq!(out[6], 6.5);
        assert_eq!(out[7], 1.0);
    }

    #[test]
    fn three_to_two_weights_the_shared_pixel_by_the_part_each_side_covers() {
        // 3 → 2 on each axis: destination 0 covers source [0, 1.5), so pixel
        // 0 counts 2/3 and pixel 1 1/3; destination 1 covers [1.5, 3), pixel
        // 1 1/3 and pixel 2 2/3.
        let src = picture(3, 3, |x, y| [[1.0, 4.0, 7.0], [10.0, 13.0, 16.0], [19.0, 22.0, 25.0]][y as usize][x as usize]);
        let out = whole(&AreaScale::new(3, 3, 2, 2).unwrap(), &src);
        // Rows across: row 0 → (2·1 + 4)/3 = 2, (4 + 2·7)/3 = 6; row 1 → 11, 15; row 2 → 20, 24.
        // Down: (2·2 + 11)/3 = 5, (2·6 + 15)/3 = 9, (11 + 2·20)/3 = 17, (15 + 2·24)/3 = 21.
        let red: Vec<f32> = out.chunks_exact(4).map(|p| p[0]).collect();
        for (got, want) in red.iter().zip([5.0, 9.0, 17.0, 21.0]) {
            assert!(close(*got, want), "{red:?}");
        }
    }

    #[test]
    fn a_non_integer_scale_matches_the_area_average_by_hand() {
        // 5 → 2 across, one row: destination 0 covers [0, 2.5), destination 1 [2.5, 5).
        let src = picture(5, 1, |x, _| [2.0, 4.0, 8.0, 16.0, 32.0][x as usize]);
        let out = whole(&AreaScale::new(5, 1, 2, 1).unwrap(), &src);
        // (2 + 4 + 0.5·8) / 2.5 = 4; (0.5·8 + 16 + 32) / 2.5 = 20.8.
        assert!(close(out[0], 4.0), "{}", out[0]);
        assert!(close(out[4], 20.8), "{}", out[4]);
    }

    #[test]
    fn band_by_band_is_bit_for_bit_the_whole_picture() {
        let (sw, sh, dw, dh) = (211, 157, 97, 61);
        let src = picture(sw, sh, |x, y| ((x * 7919 + y * 104_729) % 1000) as f32 / 997.0 + (x as f32 * 0.01).sin());
        let scale = AreaScale::new(sw, sh, dw, dh).unwrap();
        let reference = whole(&scale, &src);
        let row = (sw * 4) as usize;

        // Row bands, each given only the source rows it reads (plus a few more).
        let mut rows = Vec::new();
        for (y0, y1) in [(0, 13), (13, 14), (14, 40), (40, 61)] {
            let (r0, r1) = scale.source_rows(y0, y1);
            let (r0, r1) = (r0.saturating_sub(2), (r1 + 3).min(sh));
            let part = &src[r0 as usize * row..r1 as usize * row];
            rows.extend(scale.reduce(part, PixelRect::new(0, r0, sw, r1 - r0), PixelRect::new(0, y0, dw, y1 - y0)).unwrap());
        }
        assert!(rows.iter().zip(&reference).all(|(a, b)| a.to_bits() == b.to_bits()));

        // Column bands, as a RAW frame turned a quarter is rendered.
        let mut columns = vec![0.0f32; reference.len()];
        for (x0, x1) in [(0, 30), (30, 31), (31, 97)] {
            let (c0, c1) = scale.source_columns(x0, x1);
            let part: Vec<f32> = (0..sh).flat_map(|y| src[(y * sw + c0) as usize * 4..(y * sw + c1) as usize * 4].to_vec()).collect();
            let out = scale.reduce(&part, PixelRect::new(c0, 0, c1 - c0, sh), PixelRect::new(x0, 0, x1 - x0, dh)).unwrap();
            for y in 0..dh {
                let w = (x1 - x0) as usize * 4;
                columns[(y * dw + x0) as usize * 4..][..w].copy_from_slice(&out[y as usize * w..][..w]);
            }
        }
        assert!(columns.iter().zip(&reference).all(|(a, b)| a.to_bits() == b.to_bits()));
    }

    #[test]
    fn a_source_that_does_not_cover_the_band_is_refused() {
        let scale = AreaScale::new(10, 10, 4, 4).unwrap();
        let (r0, r1) = scale.source_rows(1, 2);
        assert_eq!((r0, r1), (2, 5));
        let short = vec![0.0; 10 * 2 * 4];
        assert!(scale.reduce(&short, PixelRect::new(0, 2, 10, 2), PixelRect::new(0, 1, 4, 1)).is_err());
        assert!(AreaScale::new(10, 10, 11, 4).is_err());
        assert!(AreaScale::new(10, 10, 0, 4).is_err());
    }

    #[test]
    fn fit_within_keeps_a_picture_that_fits_and_puts_the_long_side_at_the_limit() {
        assert_eq!(fit_within(8192, 5000, 8192), (8192, 5000));
        assert_eq!(fit_within(8368, 5584, 8192), (8192, 5467));
        assert_eq!(fit_within(5584, 8368, 8192), (5467, 8192));
        assert_eq!(fit_within(20000, 1, 8192), (8192, 1));
    }
}
