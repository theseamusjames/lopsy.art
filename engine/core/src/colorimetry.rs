//! The RGB colour spaces exports are written in, as numbers: primaries,
//! white point and transfer curve, and the matrices between them. The ICC
//! profiles (`export`) and the pixel conversion (`space_convert`) are both
//! built from these, so a file's pixels and its profile cannot disagree.

use crate::color::ColorSpace;

pub type Mat3 = [[f64; 3]; 3];

/// CIE chromaticities of the D65 white point (x, y).
pub const D65_XY: (f64, f64) = (0.3127, 0.3290);

/// The ICC profile connection space illuminant (D50), exactly as its
/// s15Fixed16 encoding in a profile header (0xF6D6, 0x10000, 0xD32D).
pub const PCS_D50: [f64; 3] = [63190.0 / 65536.0, 1.0, 54061.0 / 65536.0];

/// Bradford cone response matrix, which ICC prescribes for adapting
/// colorants to the D50 connection space.
pub const BRADFORD: Mat3 = [
    [0.8951, 0.2664, -0.1614],
    [-0.7502, 1.7135, 0.0367],
    [0.0389, -0.0685, 1.0296],
];

/// sRGB (and Rec. 709) primaries as CIE chromaticities: red, green, blue.
pub const SRGB_PRIMARIES_XY: [(f64, f64); 3] = [(0.640, 0.330), (0.300, 0.600), (0.150, 0.060)];

/// Display P3 primaries as CIE chromaticities: red, green, blue.
pub const P3_PRIMARIES_XY: [(f64, f64); 3] = [(0.680, 0.320), (0.265, 0.690), (0.150, 0.060)];

/// Rec. 2020 primaries as CIE chromaticities: red, green, blue.
pub const REC2020_PRIMARIES_XY: [(f64, f64); 3] = [(0.708, 0.292), (0.170, 0.797), (0.131, 0.046)];

/// The constants of the BT.709 / BT.2020 OETF at full precision, the
/// values that make its two segments meet (BT.2020 table 4, H.273).
pub const BT709_ALPHA: f64 = 1.099_296_826_809_44;
pub const BT709_BETA: f64 = 0.018_053_968_510_807;

/// How a space's numbers encode linear light.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transfer {
    /// The piecewise sRGB curve, which Display P3 shares.
    Srgb,
    /// The BT.709 OETF, which BT.2020 uses unchanged. Rec. 2020 files are
    /// encoded with it because it has an exact ICC parametric form and a
    /// cICP code point.
    Bt709,
    Linear,
}

impl Transfer {
    /// Encoded value (0..1) to linear light.
    pub fn to_linear(self, v: f64) -> f64 {
        match self {
            Transfer::Srgb => {
                if v <= 0.04045 {
                    v / 12.92
                } else {
                    ((v + 0.055) / 1.055).powf(2.4)
                }
            }
            Transfer::Bt709 => {
                if v < 4.5 * BT709_BETA {
                    v / 4.5
                } else {
                    ((v + (BT709_ALPHA - 1.0)) / BT709_ALPHA).powf(1.0 / 0.45)
                }
            }
            Transfer::Linear => v,
        }
    }

    /// Linear light to encoded value. The inverse of `to_linear`.
    pub fn from_linear(self, l: f64) -> f64 {
        match self {
            Transfer::Srgb => {
                if l <= 0.0031308 {
                    l * 12.92
                } else {
                    1.055 * l.powf(1.0 / 2.4) - 0.055
                }
            }
            Transfer::Bt709 => {
                if l < BT709_BETA {
                    4.5 * l
                } else {
                    BT709_ALPHA * l.powf(0.45) - (BT709_ALPHA - 1.0)
                }
            }
            Transfer::Linear => l,
        }
    }

    /// The curve as ICC `parametricCurveType` function 3: linear =
    /// (a·v + b)^g for v ≥ d, else c·v. Returns [g, a, b, c, d].
    pub fn icc_parametric(self) -> [f64; 5] {
        match self {
            Transfer::Srgb => [2.4, 1.0 / 1.055, 0.055 / 1.055, 1.0 / 12.92, 0.04045],
            Transfer::Bt709 => [
                1.0 / 0.45,
                1.0 / BT709_ALPHA,
                (BT709_ALPHA - 1.0) / BT709_ALPHA,
                1.0 / 4.5,
                4.5 * BT709_BETA,
            ],
            // A function-3 curve with c = a = 1, b = 0 and g = 1 is the identity.
            Transfer::Linear => [1.0, 1.0, 0.0, 1.0, 0.0],
        }
    }
}

/// An RGB colour space as the numbers that define it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RgbSpace {
    pub primaries: [(f64, f64); 3],
    pub white: (f64, f64),
    pub transfer: Transfer,
}

/// The definition of each colour space an export can be written in.
pub fn rgb_space(color_space: ColorSpace) -> RgbSpace {
    let (primaries, transfer) = match color_space {
        ColorSpace::Srgb => (SRGB_PRIMARIES_XY, Transfer::Srgb),
        ColorSpace::LinearSrgb => (SRGB_PRIMARIES_XY, Transfer::Linear),
        ColorSpace::DisplayP3 => (P3_PRIMARIES_XY, Transfer::Srgb),
        ColorSpace::Rec2020 => (REC2020_PRIMARIES_XY, Transfer::Bt709),
    };
    RgbSpace { primaries, white: D65_XY, transfer }
}

pub fn xy_to_xyz(x: f64, y: f64) -> [f64; 3] {
    [x / y, 1.0, (1.0 - x - y) / y]
}

pub fn mat_mul(a: &Mat3, b: &Mat3) -> Mat3 {
    let mut out = [[0.0; 3]; 3];
    for (i, row) in out.iter_mut().enumerate() {
        for (j, cell) in row.iter_mut().enumerate() {
            *cell = (0..3).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    out
}

pub fn mat_vec(m: &Mat3, v: &[f64; 3]) -> [f64; 3] {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

pub fn mat_inverse(m: &Mat3) -> Mat3 {
    let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    let inv_det = 1.0 / det;
    [
        [
            (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * inv_det,
            (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * inv_det,
            (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * inv_det,
        ],
        [
            (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * inv_det,
            (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * inv_det,
            (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * inv_det,
        ],
        [
            (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * inv_det,
            (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * inv_det,
            (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * inv_det,
        ],
    ]
}

/// Bradford chromatic adaptation matrix taking colours from `src_white` to
/// `dst_white` (both XYZ with Y = 1).
pub fn bradford_adaptation(src_white: &[f64; 3], dst_white: &[f64; 3]) -> Mat3 {
    let cone_src = mat_vec(&BRADFORD, src_white);
    let cone_dst = mat_vec(&BRADFORD, dst_white);
    let scale = [
        [cone_dst[0] / cone_src[0], 0.0, 0.0],
        [0.0, cone_dst[1] / cone_src[1], 0.0],
        [0.0, 0.0, cone_dst[2] / cone_src[2]],
    ];
    mat_mul(&mat_inverse(&BRADFORD), &mat_mul(&scale, &BRADFORD))
}

/// Linear RGB to XYZ (the columns are the colorants) for the given
/// primaries and white point, relative to that white point.
pub fn rgb_to_xyz_matrix(primaries_xy: &[(f64, f64); 3], white_xyz: &[f64; 3]) -> Mat3 {
    let p: Vec<[f64; 3]> = primaries_xy.iter().map(|&(x, y)| xy_to_xyz(x, y)).collect();
    let m = [
        [p[0][0], p[1][0], p[2][0]],
        [p[0][1], p[1][1], p[2][1]],
        [p[0][2], p[1][2], p[2][2]],
    ];
    let s = mat_vec(&mat_inverse(&m), white_xyz);
    [
        [m[0][0] * s[0], m[0][1] * s[1], m[0][2] * s[2]],
        [m[1][0] * s[0], m[1][1] * s[1], m[1][2] * s[2]],
        [m[2][0] * s[0], m[2][1] * s[1], m[2][2] * s[2]],
    ]
}

/// A space's colorants adapted to the D50 connection space, and the
/// adaptation used (the profile's `chad` tag).
pub fn pcs_colorants(space: &RgbSpace) -> (Mat3, Mat3) {
    let white = xy_to_xyz(space.white.0, space.white.1);
    let chad = bradford_adaptation(&white, &PCS_D50);
    let m = rgb_to_xyz_matrix(&space.primaries, &white);
    (mat_mul(&chad, &m), chad)
}

/// Linear RGB in `from` to linear RGB in `to`, through XYZ. Spaces with
/// different white points are adapted with Bradford.
pub fn rgb_to_rgb_matrix(from: &RgbSpace, to: &RgbSpace) -> Mat3 {
    let from_white = xy_to_xyz(from.white.0, from.white.1);
    let to_white = xy_to_xyz(to.white.0, to.white.1);
    let from_xyz = rgb_to_xyz_matrix(&from.primaries, &from_white);
    let to_rgb = mat_inverse(&rgb_to_xyz_matrix(&to.primaries, &to_white));
    let adapt = bradford_adaptation(&from_white, &to_white);
    mat_mul(&to_rgb, &mat_mul(&adapt, &from_xyz))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfers_invert() {
        for t in [Transfer::Srgb, Transfer::Bt709, Transfer::Linear] {
            for i in 0..=1000 {
                let v = i as f64 / 1000.0;
                assert!((t.from_linear(t.to_linear(v)) - v).abs() < 1e-12, "{t:?} at {v}");
            }
        }
    }

    /// The parametric form reproduces each curve.
    #[test]
    fn parametric_curves_match_the_transfers() {
        for t in [Transfer::Srgb, Transfer::Bt709, Transfer::Linear] {
            let [g, a, b, c, d] = t.icc_parametric();
            for i in 0..=1000 {
                let v = i as f64 / 1000.0;
                let y = if v >= d { (a * v + b).powf(g) } else { c * v };
                assert!((y - t.to_linear(v)).abs() < 1e-9, "{t:?} at {v}: {y}");
            }
        }
    }

    /// BT.709's segments meet: the constants are the full-precision ones.
    #[test]
    fn bt709_is_continuous() {
        let lin = 4.5 * BT709_BETA;
        let pow = BT709_ALPHA * BT709_BETA.powf(0.45) - (BT709_ALPHA - 1.0);
        assert!((lin - pow).abs() < 1e-12);
    }

    /// The well-known linear sRGB → Display P3 matrix (CSS Color 4).
    #[test]
    fn srgb_to_p3_matrix_is_the_published_one() {
        let m = rgb_to_rgb_matrix(&rgb_space(ColorSpace::Srgb), &rgb_space(ColorSpace::DisplayP3));
        let expected = [
            [0.822_461_969, 0.177_538_031, 0.0],
            [0.033_194_199, 0.966_805_801, 0.0],
            [0.017_082_631, 0.072_397_440, 0.910_519_929],
        ];
        for i in 0..3 {
            for j in 0..3 {
                assert!((m[i][j] - expected[i][j]).abs() < 1e-4, "[{i}][{j}] = {}", m[i][j]);
            }
        }
    }

    /// The well-known linear sRGB → Rec. 2020 matrix (BT.2087).
    #[test]
    fn srgb_to_rec2020_matrix_is_the_published_one() {
        let m = rgb_to_rgb_matrix(&rgb_space(ColorSpace::Srgb), &rgb_space(ColorSpace::Rec2020));
        let expected = [[0.6274, 0.3293, 0.0433], [0.0691, 0.9195, 0.0114], [0.0164, 0.0880, 0.8956]];
        for i in 0..3 {
            for j in 0..3 {
                assert!((m[i][j] - expected[i][j]).abs() < 1e-3, "[{i}][{j}] = {}", m[i][j]);
            }
        }
    }
}
