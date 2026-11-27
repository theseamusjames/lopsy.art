//! Converting encoded RGBA pixels from one RGB colour space to another, on
//! the CPU: decode the source curve, a 3×3 matrix in linear light, encode
//! with the destination's curve. Exports use it to write a file whose
//! pixels are in the space its profile names. Alpha is never touched.
//!
//! Both curves are lookup tables, so a 26-megapixel image costs table
//! reads and nine multiply-adds a pixel and no `powf`. Neutral pixels
//! (R = G = B) take a separate per-value table and stay exactly neutral;
//! when the two spaces share a curve they keep their value too. Results
//! outside the destination's gamut are clipped to 0..1 per channel.

use crate::color::ColorSpace;
use crate::colorimetry::{rgb_space, rgb_to_rgb_matrix, Transfer};

/// Intervals in the encoding table over linear 0..1. With linear
/// interpolation between entries this puts every result within a
/// hundredth of a 16-bit step of the exact curve, as both curves used here
/// are linear near black, where they are steepest.
const ENCODE_STEPS: usize = 65536;

/// Convert RGBA16 `pixels` in place from `from` to `to`.
pub fn convert_rgba16(pixels: &mut [u16], from: ColorSpace, to: ColorSpace) {
    let Some(c) = Conversion::new(from, to) else { return };
    let decode: Vec<f32> = (0..=u16::MAX).map(|v| c.from.to_linear(v as f64 / 65535.0) as f32).collect();
    let grey = c.grey_table(65536, 65535.0);
    for px in pixels.chunks_exact_mut(4) {
        let (r, g, b) = (px[0], px[1], px[2]);
        if r == g && g == b {
            let v = grey[r as usize] as u16;
            px[0] = v;
            px[1] = v;
            px[2] = v;
            continue;
        }
        let out = c.apply(decode[r as usize], decode[g as usize], decode[b as usize]);
        for (slot, v) in px.iter_mut().zip(out) {
            *slot = (v * 65535.0 + 0.5) as u16;
        }
    }
}

/// Convert RGBA8 `pixels` in place from `from` to `to`.
pub fn convert_rgba8(pixels: &mut [u8], from: ColorSpace, to: ColorSpace) {
    let Some(c) = Conversion::new(from, to) else { return };
    let decode: Vec<f32> = (0..=u8::MAX).map(|v| c.from.to_linear(v as f64 / 255.0) as f32).collect();
    let grey = c.grey_table(256, 255.0);
    for px in pixels.chunks_exact_mut(4) {
        let (r, g, b) = (px[0], px[1], px[2]);
        if r == g && g == b {
            let v = grey[r as usize] as u8;
            px[0] = v;
            px[1] = v;
            px[2] = v;
            continue;
        }
        let out = c.apply(decode[r as usize], decode[g as usize], decode[b as usize]);
        for (slot, v) in px.iter_mut().zip(out) {
            *slot = (v * 255.0 + 0.5) as u8;
        }
    }
}

struct Conversion {
    from: Transfer,
    to: Transfer,
    matrix: [f32; 9],
    /// The destination curve sampled at linear i / ENCODE_STEPS.
    encode: Vec<f32>,
}

impl Conversion {
    /// None when the two spaces are the same, which leaves pixels as they are.
    fn new(from: ColorSpace, to: ColorSpace) -> Option<Self> {
        let (src, dst) = (rgb_space(from), rgb_space(to));
        if src == dst {
            return None;
        }
        let m = rgb_to_rgb_matrix(&src, &dst);
        let mut matrix = [0.0f32; 9];
        for (i, slot) in matrix.iter_mut().enumerate() {
            *slot = m[i / 3][i % 3] as f32;
        }
        let encode = (0..=ENCODE_STEPS)
            .map(|i| dst.transfer.from_linear(i as f64 / ENCODE_STEPS as f64) as f32)
            .collect();
        Some(Self { from: src.transfer, to: dst.transfer, matrix, encode })
    }

    /// What each neutral value becomes, worked out in double precision.
    /// Neutrals keep their white point, so only the curve can move them.
    fn grey_table(&self, len: usize, max: f64) -> Vec<u32> {
        (0..len)
            .map(|v| {
                if self.from == self.to {
                    return v as u32;
                }
                let lin = self.from.to_linear(v as f64 / max);
                (self.to.from_linear(lin).clamp(0.0, 1.0) * max).round() as u32
            })
            .collect()
    }

    /// Linear source RGB to encoded destination RGB, each 0..1.
    #[inline]
    fn apply(&self, r: f32, g: f32, b: f32) -> [f32; 3] {
        let m = &self.matrix;
        [
            self.encode_one(m[0] * r + m[1] * g + m[2] * b),
            self.encode_one(m[3] * r + m[4] * g + m[5] * b),
            self.encode_one(m[6] * r + m[7] * g + m[8] * b),
        ]
    }

    #[inline]
    fn encode_one(&self, linear: f32) -> f32 {
        let pos = linear.clamp(0.0, 1.0) * ENCODE_STEPS as f32;
        let i = (pos as usize).min(ENCODE_STEPS - 1);
        let frac = pos - i as f32;
        let (a, b) = (self.encode[i], self.encode[i + 1]);
        a + (b - a) * frac
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The conversion of one 16-bit colour in double precision throughout.
    fn reference16(rgb: [u16; 3], from: ColorSpace, to: ColorSpace) -> [f64; 3] {
        let (src, dst) = (rgb_space(from), rgb_space(to));
        let m = rgb_to_rgb_matrix(&src, &dst);
        let lin = rgb.map(|v| src.transfer.to_linear(v as f64 / 65535.0));
        let out = crate::colorimetry::mat_vec(&m, &lin);
        out.map(|l| dst.transfer.from_linear(l.clamp(0.0, 1.0)) * 65535.0)
    }

    /// Convert many colours in one call, with an alpha that must survive.
    fn convert16_all(colours: &[[u16; 3]], from: ColorSpace, to: ColorSpace) -> Vec<[u16; 3]> {
        let mut px: Vec<u16> = colours.iter().flat_map(|c| [c[0], c[1], c[2], 0x1234]).collect();
        convert_rgba16(&mut px, from, to);
        px.chunks_exact(4)
            .map(|p| {
                assert_eq!(p[3], 0x1234, "alpha must not change");
                [p[0], p[1], p[2]]
            })
            .collect()
    }

    fn convert16(rgb: [u16; 3], from: ColorSpace, to: ColorSpace) -> [u16; 3] {
        convert16_all(&[rgb], from, to)[0]
    }

    /// Pseudo-random 16-bit colours, the same on every run.
    fn sample_colours(n: usize) -> Vec<[u16; 3]> {
        let mut s: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next = || {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            (s >> 48) as u16
        };
        (0..n).map(|_| [next(), next(), next()]).collect()
    }

    /// sRGB red, (1, 0, 0), is Display P3 (0.9175, 0.2003, 0.1386), CSS
    /// Color 4's figures: the sRGB curve decoded, the matrix from both
    /// spaces' primaries (both D65, so no adaptation), the sRGB curve
    /// encoded. Its linear P3 values are that matrix's first column,
    /// (0.82246, 0.03319, 0.01708), which encode to the figures below.
    #[test]
    fn saturated_srgb_red_gets_its_p3_numbers() {
        let p3 = convert16([65535, 0, 0], ColorSpace::Srgb, ColorSpace::DisplayP3);
        let expected = [0.917_488, 0.200_287, 0.138_561];
        for c in 0..3 {
            let got = p3[c] as f64 / 65535.0;
            assert!((got - expected[c]).abs() < 2e-5, "channel {c}: {got} vs {}", expected[c]);
        }
        let mut px8 = [255u8, 0, 0, 255];
        convert_rgba8(&mut px8, ColorSpace::Srgb, ColorSpace::DisplayP3);
        assert_eq!(px8, [234, 51, 35, 255]);
    }

    /// sRGB red in Rec. 2020 is linear (0.6274, 0.0691, 0.0164), the first
    /// column of BT.2087's matrix, which the BT.709 curve encodes to
    /// (0.7919, 0.2310, 0.0742): 8-bit (202, 59, 19).
    #[test]
    fn saturated_srgb_red_gets_its_rec2020_numbers() {
        let mut px8 = [255u8, 0, 0, 255];
        convert_rgba8(&mut px8, ColorSpace::Srgb, ColorSpace::Rec2020);
        assert_eq!(px8, [202, 59, 19, 255]);
    }

    /// The tables put every colour within rounding of the exact result.
    #[test]
    fn every_colour_is_within_rounding_of_the_reference() {
        let colours: Vec<[u16; 3]> = sample_colours(100_000)
            .into_iter()
            .chain([[0, 65535, 0], [0, 0, 65535], [65535, 65535, 0], [0, 65535, 65535], [65535, 0, 65535]])
            .collect();
        for (from, to) in [
            (ColorSpace::Srgb, ColorSpace::DisplayP3),
            (ColorSpace::Srgb, ColorSpace::Rec2020),
            (ColorSpace::DisplayP3, ColorSpace::Srgb),
        ] {
            let got = convert16_all(&colours, from, to);
            for (rgb, got) in colours.iter().zip(got) {
                let want = reference16(*rgb, from, to);
                for c in 0..3 {
                    assert!((got[c] as f64 - want[c]).abs() <= 0.52, "{rgb:?} {from:?} → {to:?}: {got:?} vs {want:?}");
                }
            }
        }
    }

    /// A grey stays exactly grey; between spaces with the same curve it
    /// keeps its value too.
    #[test]
    fn greys_stay_grey() {
        let greys: Vec<[u16; 3]> = (0..=65535u16).map(|v| [v, v, v]).collect();
        assert_eq!(convert16_all(&greys, ColorSpace::Srgb, ColorSpace::DisplayP3), greys);
        assert_eq!(convert16_all(&greys, ColorSpace::DisplayP3, ColorSpace::Srgb), greys);
        for (grey, rec) in greys.iter().zip(convert16_all(&greys, ColorSpace::Srgb, ColorSpace::Rec2020)) {
            assert!(rec[0] == rec[1] && rec[1] == rec[2], "{grey:?}: {rec:?}");
            let want = reference16(*grey, ColorSpace::Srgb, ColorSpace::Rec2020)[0];
            assert!((rec[0] as f64 - want).abs() <= 0.501, "{grey:?}: {rec:?} vs {want}");
        }
        assert_eq!(convert16([0; 3], ColorSpace::Srgb, ColorSpace::Rec2020), [0; 3]);
        assert_eq!(convert16([65535; 3], ColorSpace::Srgb, ColorSpace::Rec2020), [65535; 3]);
        let mut px8: Vec<u8> = (0..=255u8).flat_map(|v| [v, v, v, 7]).collect();
        let before = px8.clone();
        convert_rgba8(&mut px8, ColorSpace::Srgb, ColorSpace::DisplayP3);
        assert_eq!(px8, before);
    }

    /// sRGB → P3 → sRGB through 16-bit P3 is the identity to within the
    /// precision a 16-bit P3 file has: one step where the channels are
    /// close in value. Where one channel is dark and another bright, P3's
    /// rounding of the bright one leaks through the matrix onto the steep
    /// foot of the dark one's curve and moves it up to nine steps in 65535.
    /// The same round trip in double precision, rounding only to store the
    /// P3 file, moves it as far, so that is the file's precision and not
    /// the conversion's.
    #[test]
    fn p3_and_back_is_the_identity() {
        let colours: Vec<[u16; 3]> = sample_colours(100_000)
            .into_iter()
            .chain([[65535, 0, 0], [0, 65535, 0], [0, 0, 65535], [30000, 30001, 29999]])
            .collect();
        let p3 = convert16_all(&colours, ColorSpace::Srgb, ColorSpace::DisplayP3);
        let back = convert16_all(&p3, ColorSpace::DisplayP3, ColorSpace::Srgb);
        let (mut worst, mut worst_exact) = (0i32, 0i32);
        for (rgb, back) in colours.iter().zip(back) {
            let exact = reference16(
                reference16(*rgb, ColorSpace::Srgb, ColorSpace::DisplayP3).map(|v| v.round() as u16),
                ColorSpace::DisplayP3,
                ColorSpace::Srgb,
            );
            let (lo, hi) = (*rgb.iter().min().unwrap(), *rgb.iter().max().unwrap());
            for c in 0..3 {
                let d = (back[c] as i32 - rgb[c] as i32).abs();
                worst = worst.max(d);
                worst_exact = worst_exact.max((exact[c].round() as i32 - rgb[c] as i32).abs());
                if hi - lo < 4096 {
                    assert!(d <= 1, "{rgb:?} → {back:?}");
                }
            }
        }
        assert!(worst <= worst_exact.max(1), "{worst} steps, exact arithmetic {worst_exact}");
        assert!(worst <= 9, "{worst} steps");
    }

    #[test]
    fn same_space_changes_nothing() {
        let mut px: Vec<u16> = sample_colours(100).into_iter().flat_map(|c| [c[0], c[1], c[2], 9]).collect();
        let before = px.clone();
        convert_rgba16(&mut px, ColorSpace::DisplayP3, ColorSpace::DisplayP3);
        assert_eq!(px, before);
    }

    /// P3 red is outside sRGB and clips to sRGB red.
    #[test]
    fn out_of_gamut_clips() {
        let mut px = [255u8, 0, 0, 255];
        convert_rgba8(&mut px, ColorSpace::DisplayP3, ColorSpace::Srgb);
        assert_eq!(px, [255, 0, 0, 255]);
    }

    /// The tables, not the pixels, are most of the cost of a small image;
    /// a large one is a few table reads and multiply-adds a pixel.
    ///
    /// `cargo test` builds without optimisation and runs the other tests
    /// beside this one, so a single timing on a shared CI runner can be
    /// three times this machine's (511 ms against 152 ms). The fastest of
    /// three conversions is judged, against a limit with room for that:
    /// what it guards against, building the tables again for each pixel,
    /// is many times slower still.
    #[test]
    fn a_large_image_converts_quickly() {
        let n = 26_000_000 / 8;
        let source: Vec<u16> = (0..n * 4).map(|i| (i as u32).wrapping_mul(2_654_435_761) as u16).collect();
        let fastest = (0..3)
            .map(|_| {
                let mut px = source.clone();
                let t = std::time::Instant::now();
                convert_rgba16(&mut px, ColorSpace::Srgb, ColorSpace::DisplayP3);
                t.elapsed().as_secs_f64()
            })
            .fold(f64::INFINITY, f64::min);
        let per_mp = fastest / (n as f64 / 1e6);
        eprintln!("sRGB → P3: {:.1} ms a megapixel, the fastest of three", per_mp * 1000.0);
        assert!(per_mp < 1.0, "{per_mp} s a megapixel");
    }
}
