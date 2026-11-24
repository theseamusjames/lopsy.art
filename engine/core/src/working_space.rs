//! The develop chain's working space: linear Rec. 2020 (D65), float, with
//! nothing clamped. This module holds the colour spaces the chain converts
//! between, their conversion matrices, and the CPU references of the two
//! conversions that are not tone or output: the input step that brings a
//! photo that is not RAW into the working space, and the display encoding
//! the stages written for sRGB-encoded values run in
//! (`engine/src/develop/working_space.rs` is the GPU side).
//!
//! Every matrix here is derived from the spaces' primaries and white point
//! in f64, so the CPU references and the shaders' uniforms share one source
//! and no table of rounded constants can drift from another.

/// An RGB colour space the develop chain reads from or writes to. Each is
/// defined by its primaries; all share the D65 white.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gamut {
    Srgb,
    DisplayP3,
    Rec2020,
}

impl Gamut {
    /// The CIE xy chromaticities of red, green and blue.
    const fn primaries(self) -> [[f64; 2]; 3] {
        match self {
            Gamut::Srgb => [[0.640, 0.330], [0.300, 0.600], [0.150, 0.060]],
            Gamut::DisplayP3 => [[0.680, 0.320], [0.265, 0.690], [0.150, 0.060]],
            Gamut::Rec2020 => [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046]],
        }
    }

    /// How wide the gamut is: each one here holds every colour of the
    /// ones ranked below it (Display P3's red is outside Rec. 2020 by 0.12%
    /// of a channel, which counts as inside).
    const fn rank(self) -> u8 {
        match self {
            Gamut::Srgb => 0,
            Gamut::DisplayP3 => 1,
            Gamut::Rec2020 => 2,
        }
    }

    /// Whether every colour of `self` is inside `other`.
    pub const fn is_inside(self, other: Gamut) -> bool {
        self.rank() <= other.rank()
    }
}

/// The D65 white point's xy chromaticity.
const D65: [f64; 2] = [0.3127, 0.3290];

fn xy_to_xyz([x, y]: [f64; 2]) -> [f64; 3] {
    [x / y, 1.0, (1.0 - x - y) / y]
}

type M3 = [[f64; 3]; 3];

fn mul(a: &M3, b: &M3) -> M3 {
    let mut out = [[0.0; 3]; 3];
    for (r, row) in out.iter_mut().enumerate() {
        for (c, v) in row.iter_mut().enumerate() {
            *v = (0..3).map(|k| a[r][k] * b[k][c]).sum();
        }
    }
    out
}

fn invert(m: &M3) -> M3 {
    let c00 = m[1][1] * m[2][2] - m[1][2] * m[2][1];
    let c01 = m[1][2] * m[2][0] - m[1][0] * m[2][2];
    let c02 = m[1][0] * m[2][1] - m[1][1] * m[2][0];
    let det = m[0][0] * c00 + m[0][1] * c01 + m[0][2] * c02;
    let inv = [
        [c00, m[0][2] * m[2][1] - m[0][1] * m[2][2], m[0][1] * m[1][2] - m[0][2] * m[1][1]],
        [c01, m[0][0] * m[2][2] - m[0][2] * m[2][0], m[0][2] * m[1][0] - m[0][0] * m[1][2]],
        [c02, m[0][1] * m[2][0] - m[0][0] * m[2][1], m[0][0] * m[1][1] - m[0][1] * m[1][0]],
    ];
    inv.map(|row| row.map(|v| v / det))
}

/// Linear RGB in `gamut` to CIE XYZ, white at Y = 1.
fn rgb_to_xyz(gamut: Gamut) -> M3 {
    let p = gamut.primaries().map(xy_to_xyz);
    // Columns are the primaries' XYZ, each scaled so that they add up to white.
    let columns: M3 = [[p[0][0], p[1][0], p[2][0]], [p[0][1], p[1][1], p[2][1]], [p[0][2], p[1][2], p[2][2]]];
    let w = xy_to_xyz(D65);
    let inv = invert(&columns);
    let s: [f64; 3] = std::array::from_fn(|r| (0..3).map(|k| inv[r][k] * w[k]).sum());
    columns.map(|row| [row[0] * s[0], row[1] * s[1], row[2] * s[2]])
}

/// The matrix that takes linear RGB in `from` to linear RGB in `to`,
/// row-major. White maps to white, so each row sums to 1.
pub fn conversion(from: Gamut, to: Gamut) -> [f32; 9] {
    let m = mul(&invert(&rgb_to_xyz(to)), &rgb_to_xyz(from));
    [m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2]].map(|v| v as f32)
}

/// The weights that give luminance (CIE Y) from linear RGB in `gamut`.
/// Rec. 2020's are about (0.2627, 0.6780, 0.0593); sRGB's are Rec. 709's.
pub fn luma(gamut: Gamut) -> [f32; 3] {
    rgb_to_xyz(gamut)[1].map(|v| v as f32)
}

/// `m` (row-major) times `rgb`.
pub fn apply(m: &[f32; 9], [r, g, b]: [f32; 3]) -> [f32; 3] {
    [
        m[0] * r + m[1] * g + m[2] * b,
        m[3] * r + m[4] * g + m[5] * b,
        m[6] * r + m[7] * g + m[8] * b,
    ]
}

/// The sRGB transfer curve (encoding), extended to every real value: odd
/// about 0, and the same formula above 1, so negative and above-white values
/// survive an encode and a decode.
pub fn srgb_encode(v: f32) -> f32 {
    let a = v.abs();
    let e = if a <= 0.0031308 { a * 12.92 } else { 1.055 * a.powf(1.0 / 2.4) - 0.055 };
    e.copysign(v)
}

/// The inverse of [`srgb_encode`].
pub fn srgb_decode(e: f32) -> f32 {
    let a = e.abs();
    let v = if a <= 0.04045 { a / 12.92 } else { ((a + 0.055) / 1.055).powf(2.4) };
    v.copysign(e)
}

/// How a photo that is not RAW is encoded when it reaches the chain: the
/// sRGB transfer curve on sRGB or Display P3 primaries. The engine has no
/// colour space of its own for a document, so the host says which when it
/// turns the working space on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceEncoding {
    Srgb,
    DisplayP3,
}

impl SourceEncoding {
    /// 0 is sRGB, 1 Display P3; anything else is refused.
    pub fn from_code(code: u8) -> Result<Self, String> {
        match code {
            0 => Ok(Self::Srgb),
            1 => Ok(Self::DisplayP3),
            _ => Err(format!("Source colour space {code} is not 0 (sRGB) or 1 (Display P3)")),
        }
    }

    pub const fn gamut(self) -> Gamut {
        match self {
            Self::Srgb => Gamut::Srgb,
            Self::DisplayP3 => Gamut::DisplayP3,
        }
    }
}

/// The input step on the CPU: straight-alpha RGBA, encoded as `source`
/// says, to linear Rec. 2020 with no tone curve (the identity profile:
/// rendered equals scene). Colour is decoded and converted; alpha is
/// untouched, since the composite holds straight alpha.
pub fn input_reference(rgba: &[f32], source: SourceEncoding) -> Vec<f32> {
    let m = conversion(source.gamut(), Gamut::Rec2020);
    map_rgb(rgba, |c| apply(&m, c.map(srgb_decode)))
}

/// Rendered linear Rec. 2020 to the display encoding the wrapped stages
/// work in: sRGB primaries and the extended sRGB curve, nothing clamped.
pub fn to_display_reference(rgba: &[f32]) -> Vec<f32> {
    let m = conversion(Gamut::Rec2020, Gamut::Srgb);
    map_rgb(rgba, |c| apply(&m, c).map(srgb_encode))
}

/// The inverse of [`to_display_reference`].
pub fn from_display_reference(rgba: &[f32]) -> Vec<f32> {
    let m = conversion(Gamut::Srgb, Gamut::Rec2020);
    map_rgb(rgba, |c| apply(&m, c.map(srgb_decode)))
}

/// Each pixel's colour through `f`, alpha kept.
pub(crate) fn map_rgb(rgba: &[f32], mut f: impl FnMut([f32; 3]) -> [f32; 3]) -> Vec<f32> {
    let mut out = Vec::with_capacity(rgba.len());
    for px in rgba.chunks_exact(4) {
        let [r, g, b] = f([px[0], px[1], px[2]]);
        out.extend_from_slice(&[r, g, b, px[3]]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f32, b: f32, tol: f32) -> bool {
        (a - b).abs() <= tol
    }

    #[test]
    fn the_luminance_weights_are_the_published_ones() {
        let srgb = luma(Gamut::Srgb);
        for (got, want) in srgb.iter().zip([0.2126, 0.7152, 0.0722]) {
            assert!(close(*got, want, 1e-4), "{srgb:?}");
        }
        let r2020 = luma(Gamut::Rec2020);
        for (got, want) in r2020.iter().zip([0.2627, 0.6780, 0.0593]) {
            assert!(close(*got, want, 1e-4), "{r2020:?}");
        }
    }

    #[test]
    fn conversions_keep_white_and_invert_each_other() {
        for (a, b) in [(Gamut::Srgb, Gamut::Rec2020), (Gamut::DisplayP3, Gamut::Rec2020), (Gamut::Srgb, Gamut::DisplayP3)] {
            let there = conversion(a, b);
            let back = conversion(b, a);
            for row in there.chunks(3) {
                assert!(close(row.iter().sum(), 1.0, 1e-6), "{a:?} -> {b:?}: {there:?}");
            }
            let c = [0.3, 0.7, 0.1];
            let round = apply(&back, apply(&there, c));
            assert!(round.iter().zip(c).all(|(x, y)| close(*x, y, 1e-6)), "{round:?}");
        }
        // The published sRGB -> Rec. 2020 matrix (ITU-R BT.2087).
        let m = conversion(Gamut::Srgb, Gamut::Rec2020);
        for (got, want) in m.iter().zip([0.6274, 0.3293, 0.0433, 0.0691, 0.9195, 0.0114, 0.0164, 0.0880, 0.8956]) {
            assert!(close(*got, want, 2e-4), "{m:?}");
        }
    }

    #[test]
    fn luminance_does_not_depend_on_the_primaries() {
        let c = [0.8, 0.2, 0.4];
        let y_srgb: f32 = luma(Gamut::Srgb).iter().zip(c).map(|(w, v)| w * v).sum();
        let in_2020 = apply(&conversion(Gamut::Srgb, Gamut::Rec2020), c);
        let y_2020: f32 = luma(Gamut::Rec2020).iter().zip(in_2020).map(|(w, v)| w * v).sum();
        assert!(close(y_srgb, y_2020, 1e-6));
    }

    #[test]
    fn the_extended_curve_is_odd_and_round_trips() {
        for v in [-2.0f32, -0.5, -0.001, 0.0, 0.002, 0.18, 0.5, 1.0, 3.0, 16.0] {
            let e = srgb_encode(v);
            assert!(e.signum() * v.signum() >= 0.0);
            assert!(close(srgb_decode(e), v, 1e-5 * v.abs().max(1.0)), "{v} -> {e}");
            assert_eq!(srgb_encode(-v), -e);
        }
        assert!(close(srgb_encode(0.18), 0.4613, 1e-3));
        assert!(srgb_encode(2.0) > 1.0);
    }

    #[test]
    fn the_input_step_and_the_display_encoding_agree_on_srgb() {
        // An sRGB-encoded pixel brought in, then encoded for display, is itself.
        let px = [0.9f32, 0.25, 0.04, 0.5, 0.0, 1.0, 0.5, 1.0];
        let linear = input_reference(&px, SourceEncoding::Srgb);
        let back = to_display_reference(&linear);
        assert!(back.iter().zip(&px).all(|(a, b)| close(*a, *b, 1e-5)), "{back:?}");
        let again = from_display_reference(&back);
        assert!(again.iter().zip(&linear).all(|(a, b)| close(*a, *b, 1e-5)));
        assert_eq!(linear[3], 0.5);
    }

    #[test]
    fn p3_red_is_outside_srgb_and_inside_rec2020() {
        let red = input_reference(&[1.0, 0.0, 0.0, 1.0], SourceEncoding::DisplayP3);
        let in_srgb = apply(&conversion(Gamut::Rec2020, Gamut::Srgb), [red[0], red[1], red[2]]);
        assert!(in_srgb[0] > 1.0 && in_srgb[1] < 0.0, "{in_srgb:?}");
        // P3's red sits a hair outside Rec. 2020's red-blue edge.
        assert!(red[..3].iter().all(|v| (-0.002..=1.0).contains(v)), "{red:?}");
        assert!(Gamut::Srgb.is_inside(Gamut::DisplayP3) && !Gamut::Rec2020.is_inside(Gamut::DisplayP3));
    }
}
