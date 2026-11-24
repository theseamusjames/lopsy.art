//! Gain maps: the second picture in a JPEG that a gain-map-aware reader
//! uses to turn the ordinary (SDR) photo into its HDR rendition.
//!
//! The model is the one ISO 21496-1, Adobe's Gain Map specification and
//! Google's Ultra HDR Image Format v1.1 share. Each pixel's gain is
//!
//! ```text
//! G = log2((Y_hdr + k_hdr) / (Y_sdr + k_sdr))
//! ```
//!
//! normalised between `gain_map_min` and `gain_map_max` (both log2), raised
//! to `gamma` and stored in 8 bits. A reader recovers the HDR picture as
//!
//! ```text
//! HDR = (SDR + k_sdr) · 2^(G · weight) − k_hdr
//! ```
//!
//! per channel, with `weight` from 0 to 1 depending on how much headroom
//! the display has between `hdr_capacity_min` and `hdr_capacity_max`.
//!
//! The map is single-channel, computed on luminance, which is the form
//! Ultra HDR recommends and every reader supports. Luminance does not
//! depend on the primaries for colours with the same white, so the HDR
//! picture's Rec. 2020 luminance and the SDR picture's own luminance are
//! the same quantity, and the map applies in the SDR picture's colour
//! space ("use base colour space" in ISO 21496-1).
//!
//! A single gain per pixel scales all three channels alike, so it
//! reproduces the HDR picture's luminance exactly (to the map's 8-bit
//! precision) and its colour where the SDR rendition has the HDR
//! picture's chromaticity. With offsets k the channels then differ from
//! the HDR picture by k·(r − 1)·(Y_sdr − C_sdr)/(Y_sdr + k), where r is the
//! ratio of HDR to SDR luminance: nothing on a neutral, and most on a
//! saturated blue highlight, whose blue channel is large and luminance
//! small (about 10% low at 2.5× with the default 1/64 offsets).

use crate::color::ColorSpace;
use crate::colorimetry::{rgb_space, rgb_to_xyz_matrix, xy_to_xyz, REC2020_PRIMARIES_XY, D65_XY};

/// Ultra HDR's recommended offsets, 1/64, which keep the ratio finite in
/// black and limit how much noise near black can swing the gain.
pub const DEFAULT_OFFSET: f64 = 1.0 / 64.0;

/// The smallest span between `gain_map_min` and `gain_map_max`, in stops.
/// A picture with no highlights still needs `hdr_capacity_max` above
/// `hdr_capacity_min`, which Ultra HDR requires.
const MIN_SPAN: f64 = 1.0 / 64.0;

/// What a reader needs to apply a gain map, in the units of Ultra HDR's
/// `hdrgm` XMP: gains and capacities are log2, offsets linear (in units
/// of SDR white).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GainMapMetadata {
    /// log2 of the smallest gain the map stores (code 0). At most 0.
    pub gain_map_min: f64,
    /// log2 of the largest gain the map stores (code 255). At least 0.
    pub gain_map_max: f64,
    /// The map's encoding gamma; 1.0 stores the normalised gain linearly.
    pub gamma: f64,
    /// k_sdr, added to the SDR picture before the gain.
    pub offset_sdr: f64,
    /// k_hdr, taken from the result after the gain.
    pub offset_hdr: f64,
    /// log2 of the display headroom below which the reader shows SDR.
    pub hdr_capacity_min: f64,
    /// log2 of the display headroom at and above which it applies all of
    /// the map.
    pub hdr_capacity_max: f64,
    /// Always false here: the base picture is the SDR rendition.
    pub base_rendition_is_hdr: bool,
}

impl GainMapMetadata {
    /// The metadata as seven numbers, the form a host passes across to
    /// JavaScript and back: gain map min, gain map max, gamma, offset SDR,
    /// offset HDR, HDR capacity min, HDR capacity max. The base is the SDR
    /// rendition, so `base_rendition_is_hdr` is not among them.
    pub fn to_values(&self) -> [f64; 7] {
        [
            self.gain_map_min,
            self.gain_map_max,
            self.gamma,
            self.offset_sdr,
            self.offset_hdr,
            self.hdr_capacity_min,
            self.hdr_capacity_max,
        ]
    }

    /// The inverse of `to_values`.
    pub fn from_values(v: &[f64]) -> Result<Self, String> {
        let &[gain_map_min, gain_map_max, gamma, offset_sdr, offset_hdr, hdr_capacity_min, hdr_capacity_max] = v else {
            return Err(format!("gain map metadata is seven numbers, got {}", v.len()));
        };
        Ok(Self {
            gain_map_min,
            gain_map_max,
            gamma,
            offset_sdr,
            offset_hdr,
            hdr_capacity_min,
            hdr_capacity_max,
            base_rendition_is_hdr: false,
        })
    }
}

/// The gain map's size relative to the picture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GainMapScale {
    Full,
    /// Half the width and height, rounded up, each value the average of
    /// the log2 gains of a 2×2 block. Ultra HDR leaves the size to the
    /// writer; a smaller map costs little because gains vary slowly.
    Half,
}

impl GainMapScale {
    /// 1 is full size, 2 half; anything else is an error.
    pub fn from_divisor(d: u32) -> Result<Self, String> {
        match d {
            1 => Ok(Self::Full),
            2 => Ok(Self::Half),
            _ => Err(format!("gain map scale must be 1 (full) or 2 (half), got {d}")),
        }
    }

    fn divisor(self) -> usize {
        match self {
            Self::Full => 1,
            Self::Half => 2,
        }
    }
}

/// A computed gain map: 8-bit grey written as RGBA (R = G = B, A = 255) so
/// that a browser can draw it to a canvas and encode it as a JPEG.
#[derive(Debug, Clone, PartialEq)]
pub struct GainMap {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub metadata: GainMapMetadata,
}

/// The luminance row (Y of XYZ) of a space with D65 white.
fn luminance_weights(primaries: &[(f64, f64); 3]) -> [f32; 3] {
    let m = rgb_to_xyz_matrix(primaries, &xy_to_xyz(D65_XY.0, D65_XY.1));
    [m[1][0] as f32, m[1][1] as f32, m[1][2] as f32]
}

/// Compute the gain map that takes `sdr` to `hdr`.
///
/// - `hdr`: RGBA, four f32 per pixel, row-major from the top-left,
///   `width * height * 4` values; linear light in Rec. 2020 primaries with
///   1.0 at SDR reference white. Alpha is ignored. Negative components
///   count toward luminance as they are; a negative luminance counts as 0.
/// - `sdr`: RGBA, four u8 per pixel, the same size: the picture as an
///   ordinary screen shows it, encoded in `sdr_space` (sRGB or Display
///   P3; any space `colorimetry::rgb_space` knows works). Alpha is ignored.
/// - `scale`: full or half size.
///
/// The gains use Ultra HDR's offsets (1/64) and gamma 1.0. `gain_map_min`
/// and `gain_map_max` are the smallest and largest gains in the map,
/// widened to include 0 (Ultra HDR requires min ≤ 0 ≤ max) and to span at
/// least 1/64 stop; `hdr_capacity_min` is 0 and `hdr_capacity_max` is
/// `gain_map_max`, as Ultra HDR advises, so a display with as much
/// headroom as the brightest gain shows the whole HDR picture.
pub fn compute_gain_map(
    hdr: &[f32],
    sdr: &[u8],
    width: u32,
    height: u32,
    sdr_space: ColorSpace,
    scale: GainMapScale,
) -> Result<GainMap, String> {
    if width == 0 || height == 0 {
        return Err("image has no pixels".into());
    }
    let n = (width as usize).checked_mul(height as usize).ok_or("image is too large")?;
    let values = n.checked_mul(4).ok_or("image is too large")?;
    if hdr.len() != values {
        return Err(format!("expected {values} HDR floats for {width}×{height} RGBA, got {}", hdr.len()));
    }
    if sdr.len() != values {
        return Err(format!("expected {values} SDR bytes for {width}×{height} RGBA, got {}", sdr.len()));
    }

    let space = rgb_space(sdr_space);
    let sdr_weights = luminance_weights(&space.primaries);
    let hdr_weights = luminance_weights(&REC2020_PRIMARIES_XY);
    let decode: Vec<f32> = (0..=255u8).map(|v| space.transfer.to_linear(v as f64 / 255.0) as f32).collect();
    let (k_sdr, k_hdr) = (DEFAULT_OFFSET as f32, DEFAULT_OFFSET as f32);

    let (w, h) = (width as usize, height as usize);
    let d = scale.divisor();
    let (mw, mh) = (w.div_ceil(d), h.div_ceil(d));
    // Log2 gains, summed per map pixel, then divided by the pixels summed.
    let mut gains = vec![0f32; mw * mh];
    for y in 0..h {
        let row = (y / d) * mw;
        for x in 0..w {
            let i = (y * w + x) * 4;
            let yh = (hdr_weights[0] * hdr[i] + hdr_weights[1] * hdr[i + 1] + hdr_weights[2] * hdr[i + 2]).max(0.0);
            let ys = sdr_weights[0] * decode[sdr[i] as usize]
                + sdr_weights[1] * decode[sdr[i + 1] as usize]
                + sdr_weights[2] * decode[sdr[i + 2] as usize];
            // NaN in the HDR picture would poison the range; it counts as no gain.
            let g = ((yh + k_hdr) / (ys + k_sdr)).log2();
            gains[row + x / d] += if g.is_finite() { g } else { 0.0 };
        }
    }
    if d > 1 {
        for my in 0..mh {
            let rows = (h - my * d).min(d);
            for mx in 0..mw {
                let cols = (w - mx * d).min(d);
                gains[my * mw + mx] /= (rows * cols) as f32;
            }
        }
    }

    let (lo, hi) = gains.iter().fold((0f32, 0f32), |(lo, hi), &g| (lo.min(g), hi.max(g)));
    let min = lo as f64;
    let max = (hi as f64).max(min + MIN_SPAN);
    let metadata = GainMapMetadata {
        gain_map_min: min,
        gain_map_max: max,
        gamma: 1.0,
        offset_sdr: DEFAULT_OFFSET,
        offset_hdr: DEFAULT_OFFSET,
        hdr_capacity_min: min.max(0.0),
        hdr_capacity_max: max,
        base_rendition_is_hdr: false,
    };

    let (minf, span) = (min as f32, (max - min) as f32);
    let mut rgba = vec![255u8; mw * mh * 4];
    for (px, &g) in rgba.chunks_exact_mut(4).zip(&gains) {
        // Gamma is 1.0, so the normalised gain is stored as it is.
        let v = ((g - minf) / span).clamp(0.0, 1.0);
        let code = (v * 255.0 + 0.5) as u8;
        px[0] = code;
        px[1] = code;
        px[2] = code;
    }
    Ok(GainMap { width: mw as u32, height: mh as u32, rgba, metadata })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::colorimetry::{mat_vec, rgb_to_rgb_matrix};

    /// What a reader does: SDR decoded to linear in its own primaries, the
    /// map sampled at the nearest map pixel, applied with full weight.
    fn apply(sdr: &[u8], space: ColorSpace, w: usize, map: &GainMap) -> Vec<[f64; 3]> {
        let t = rgb_space(space).transfer;
        let m = &map.metadata;
        let d = w.div_ceil(map.width as usize);
        sdr.chunks_exact(4)
            .enumerate()
            .map(|(i, px)| {
                let (x, y) = (i % w, i / w);
                let code = map.rgba[((y / d) * map.width as usize + x / d) * 4] as f64;
                let g = m.gain_map_min + (m.gain_map_max - m.gain_map_min) * (code / 255.0).powf(1.0 / m.gamma);
                let boost = g.exp2();
                [0, 1, 2].map(|c| (t.to_linear(px[c] as f64 / 255.0) + m.offset_sdr) * boost - m.offset_hdr)
            })
            .collect()
    }

    struct Scene {
        w: usize,
        h: usize,
        sdr: Vec<u8>,
        /// The HDR picture in the SDR's linear primaries (sRGB).
        hdr_srgb: Vec<[f64; 3]>,
        /// The same as the encoder's input: linear Rec. 2020 RGBA.
        hdr_2020: Vec<f32>,
    }

    /// A 64×24 picture in three bands: a neutral-to-warm highlight ramp
    /// running from 1× to 4× white, saturated colours pushed 2.5×, and
    /// shadows the HDR rendition holds darker than the SDR one (0.5×).
    /// The SDR picture comes first, and the HDR one is it times a known
    /// brightness, so the reference is exact.
    fn scene() -> Scene {
        let (w, h) = (64usize, 24usize);
        let saturated: [[u8; 3]; 4] = [[250, 20, 10], [20, 230, 30], [15, 25, 245], [240, 200, 5]];
        let to_2020 = rgb_to_rgb_matrix(&rgb_space(ColorSpace::Srgb), &rgb_space(ColorSpace::Rec2020));
        let t = rgb_space(ColorSpace::Srgb).transfer;
        let (mut sdr, mut hdr_srgb, mut hdr_2020) = (Vec::new(), Vec::new(), Vec::new());
        for y in 0..h {
            for x in 0..w {
                let (rgb, boost) = match y / 8 {
                    0 => ([235u8, 230, 220 - (x as u8)], 1.0 + 3.0 * x as f64 / (w - 1) as f64),
                    1 => (saturated[x * 4 / w], 2.5),
                    _ => ([(x * 2) as u8 + 2, (x * 2) as u8 + 1, x as u8 + 3], 0.5),
                };
                sdr.extend_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
                let lin = rgb.map(|v| t.to_linear(v as f64 / 255.0) * boost);
                hdr_srgb.push(lin);
                let r2020 = mat_vec(&to_2020, &lin);
                hdr_2020.extend_from_slice(&[r2020[0] as f32, r2020[1] as f32, r2020[2] as f32, 1.0]);
            }
        }
        Scene { w, h, sdr, hdr_srgb, hdr_2020 }
    }

    /// Applying the map to the SDR picture gives back the HDR one: its
    /// luminance to within the map's 8-bit step, and each channel to within
    /// that plus the offset term the module doc derives.
    #[test]
    fn applying_the_map_reproduces_the_hdr_picture() {
        let s = scene();
        let map = compute_gain_map(&s.hdr_2020, &s.sdr, s.w as u32, s.h as u32, ColorSpace::Srgb, GainMapScale::Full).unwrap();
        let m = map.metadata;
        assert!(m.gain_map_min < -0.5 && m.gain_map_min > -1.01, "{m:?}");
        assert!(m.gain_map_max > 1.9 && m.gain_map_max < 2.01, "{m:?}");
        assert_eq!((m.hdr_capacity_min, m.hdr_capacity_max), (0.0, m.gain_map_max));
        // One code is span/255 stops, so half a code moves a value by this factor.
        let step = ((m.gain_map_max - m.gain_map_min) / 510.0).exp2() - 1.0;
        let wy = luminance_weights(&rgb_space(ColorSpace::Srgb).primaries).map(|v| v as f64);
        let t = rgb_space(ColorSpace::Srgb).transfer;
        let k = DEFAULT_OFFSET;
        let applied = apply(&s.sdr, ColorSpace::Srgb, s.w, &map);
        let (mut worst_y, mut worst_c) = (0f64, 0f64);
        for (i, (got, want)) in applied.iter().zip(&s.hdr_srgb).enumerate() {
            let y = |c: &[f64; 3]| wy[0] * c[0] + wy[1] * c[1] + wy[2] * c[2];
            let (yg, yw) = (y(got), y(want));
            let quant = (yw + k) * step + 2e-6;
            assert!((yg - yw).abs() <= quant, "pixel {i}: luminance {yg} vs {yw}");
            worst_y = worst_y.max((yg - yw).abs() / (yw + k));
            let sdr = [0, 1, 2].map(|c| t.to_linear(s.sdr[i * 4 + c] as f64 / 255.0));
            let ys = y(&sdr);
            let r = yw / ys;
            for c in 0..3 {
                let offset_term = k * (r - 1.0).abs() * (ys - sdr[c]).abs() / (ys + k);
                let bound = offset_term + (got[c] + k) * step + 1e-5;
                assert!((got[c] - want[c]).abs() <= bound, "pixel {i} channel {c}: {} vs {} (bound {bound})", got[c], want[c]);
                let brightest = want[0].max(want[1]).max(want[2]);
                worst_c = worst_c.max((got[c] - want[c]).abs() / (brightest + k));
            }
            // A neutral comes back exactly but for the 8-bit step.
            if sdr[0] == sdr[1] && sdr[1] == sdr[2] {
                assert!((got[0] - want[0]).abs() <= quant);
            }
        }
        eprintln!(
            "gain map round trip: luminance within {:.3}% (one half-code is {:.3}%), channels within {:.2}% of the pixel's brightest",
            worst_y * 100.0,
            step * 100.0,
            worst_c * 100.0
        );
        assert!(worst_y <= step * 1.001);
        // The worst is saturated blue pushed 2.5×: blue is most of that
        // colour's brightness and little of its luminance, so the offset
        // term is largest there (about a tenth).
        assert!(worst_c < 0.11);
    }

    /// The map is grey RGBA with opaque alpha, and its codes reach both
    /// ends of the range it declares.
    #[test]
    fn the_map_is_opaque_grey_spanning_its_range() {
        let s = scene();
        let map = compute_gain_map(&s.hdr_2020, &s.sdr, s.w as u32, s.h as u32, ColorSpace::Srgb, GainMapScale::Full).unwrap();
        assert_eq!((map.width, map.height), (64, 24));
        assert!(map.rgba.chunks_exact(4).all(|p| p[0] == p[1] && p[1] == p[2] && p[3] == 255));
        assert_eq!(map.rgba.chunks_exact(4).map(|p| p[0]).min(), Some(0));
        assert_eq!(map.rgba.chunks_exact(4).map(|p| p[0]).max(), Some(255));
    }

    /// At half size each map pixel holds its 2×2 block's average gain,
    /// and odd sizes round up.
    #[test]
    fn half_size_averages_blocks() {
        let s = scene();
        let full = compute_gain_map(&s.hdr_2020, &s.sdr, s.w as u32, s.h as u32, ColorSpace::Srgb, GainMapScale::Full).unwrap();
        let half = compute_gain_map(&s.hdr_2020, &s.sdr, s.w as u32, s.h as u32, ColorSpace::Srgb, GainMapScale::Half).unwrap();
        assert_eq!((half.width, half.height), (32, 12));
        // Rows 0..8 change only along x, 8..16 are blocks of one colour.
        let g = |m: &GainMap, x: usize, y: usize| {
            let c = m.rgba[(y * m.width as usize + x) * 4] as f64 / 255.0;
            m.metadata.gain_map_min + c * (m.metadata.gain_map_max - m.metadata.gain_map_min)
        };
        let one_code = (half.metadata.gain_map_max - half.metadata.gain_map_min) / 255.0;
        for (hx, hy) in [(0, 0), (31, 3), (3, 5), (20, 11)] {
            let avg = (g(&full, hx * 2, hy * 2) + g(&full, hx * 2 + 1, hy * 2) + g(&full, hx * 2, hy * 2 + 1) + g(&full, hx * 2 + 1, hy * 2 + 1)) / 4.0;
            assert!((g(&half, hx, hy) - avg).abs() <= one_code, "({hx}, {hy})");
        }
        let odd: Vec<f32> = [2.0, 2.0, 2.0, 1.0].repeat(3 * 5);
        let map = compute_gain_map(&odd, &[255u8; 4].repeat(15), 3, 5, ColorSpace::DisplayP3, GainMapScale::Half).unwrap();
        assert_eq!((map.width, map.height), (2, 3));
    }

    /// A picture with nothing above white still gets a valid range.
    #[test]
    fn an_sdr_picture_gets_a_valid_range() {
        let hdr = [1.0f32, 1.0, 1.0, 1.0].repeat(4);
        let map = compute_gain_map(&hdr, &[255u8; 16], 2, 2, ColorSpace::Srgb, GainMapScale::Full).unwrap();
        let m = map.metadata;
        assert!(m.gain_map_min <= 0.0 && m.gain_map_max > m.gain_map_min);
        assert!(m.hdr_capacity_max > m.hdr_capacity_min);
        assert!(m.gain_map_min.abs() < 1e-5);
    }

    #[test]
    fn metadata_values_round_trip() {
        let s = scene();
        let m = compute_gain_map(&s.hdr_2020, &s.sdr, s.w as u32, s.h as u32, ColorSpace::Srgb, GainMapScale::Full).unwrap().metadata;
        assert_eq!(GainMapMetadata::from_values(&m.to_values()), Ok(m));
        assert!(GainMapMetadata::from_values(&[0.0; 6]).is_err());
    }

    #[test]
    fn bad_input_is_an_error() {
        let s = |n: usize| vec![0u8; n];
        assert!(compute_gain_map(&[0.0; 4], &s(4), 0, 1, ColorSpace::Srgb, GainMapScale::Full).is_err());
        assert!(compute_gain_map(&[0.0; 4], &s(8), 1, 1, ColorSpace::Srgb, GainMapScale::Full).is_err());
        assert!(compute_gain_map(&[0.0; 8], &s(4), 1, 1, ColorSpace::Srgb, GainMapScale::Full).is_err());
        assert!(GainMapScale::from_divisor(3).is_err());
        let nan = [f32::NAN, 0.0, 0.0, 1.0];
        let map = compute_gain_map(&nan, &s(4), 1, 1, ColorSpace::Srgb, GainMapScale::Full).unwrap();
        assert!(map.metadata.gain_map_max.is_finite());
    }
}
