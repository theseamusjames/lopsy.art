//! Correlated colour temperature and tint of a white point, and back.
//!
//! A white point's correlated colour temperature (CCT) is the temperature
//! of the Planckian (black-body) radiator whose chromaticity lies nearest to
//! it in the CIE 1960 UCS (u, v) diagram; its distance from that point,
//! signed, is Duv. This is the CIE definition that Robertson's method
//! (1968) evaluates with a table of isotemperature lines. Here the same
//! definition is evaluated directly: the Planckian locus is the cubic
//! spline approximation of Kim et al. (US patent 7,024,034 and "Design of
//! advanced color temperature control system for HDTV applications",
//! J. Korean Phys. Soc. 41, 2002), valid from 1667 K to 25000 K, and the
//! nearest locus point is found by a search in mireds. Robertson's table
//! is not reproduced because it was not available to copy exactly; the
//! spline's coefficients were written from memory of the published
//! approximation, and the tests check them against the standard values
//! (illuminant A at 2856 K, D65 at 6504 K).
//!
//! Tint is `TINT_PER_DUV` × Duv. Positive tint is a white point above the
//! locus, a greener light, which a white balance renders more magenta: the
//! direction of the Photonamous tint slider. The scale gives tints of the
//! order raw converters show (D65 is about +10), but it was not matched to
//! any converter's.

use crate::colorimetry::Mat3;

/// The coldest and warmest temperatures the locus approximation covers.
pub const MIN_KELVIN: f64 = 1667.0;
pub const MAX_KELVIN: f64 = 25000.0;

/// Tint units per unit of Duv.
pub const TINT_PER_DUV: f64 = 3000.0;

/// CIE 1931 xy to CIE 1960 uv.
pub fn xy_to_uv(x: f64, y: f64) -> (f64, f64) {
    let d = -2.0 * x + 12.0 * y + 3.0;
    (4.0 * x / d, 6.0 * y / d)
}

/// CIE 1960 uv to CIE 1931 xy.
pub fn uv_to_xy(u: f64, v: f64) -> (f64, f64) {
    let d = 2.0 * u - 8.0 * v + 4.0;
    (3.0 * u / d, 2.0 * v / d)
}

/// The Planckian locus at `kelvin` (clamped to the approximation's range),
/// as xy.
pub fn planckian_xy(kelvin: f64) -> (f64, f64) {
    let t = kelvin.clamp(MIN_KELVIN, MAX_KELVIN);
    let (t2, t3) = (t * t, t * t * t);
    let x = if t <= 4000.0 {
        -0.266_123_9e9 / t3 - 0.234_358_9e6 / t2 + 0.877_695_6e3 / t + 0.179_910
    } else {
        -3.025_846_9e9 / t3 + 2.107_037_9e6 / t2 + 0.222_634_7e3 / t + 0.240_390
    };
    let (x2, x3) = (x * x, x * x * x);
    let y = if t <= 2222.0 {
        -1.106_381_4 * x3 - 1.348_110_20 * x2 + 2.185_558_32 * x - 0.202_196_83
    } else if t <= 4000.0 {
        -0.954_947_6 * x3 - 1.374_185_93 * x2 + 2.091_370_15 * x - 0.167_488_67
    } else {
        3.081_758_0 * x3 - 5.873_386_70 * x2 + 3.751_129_97 * x - 0.370_014_83
    };
    (x, y)
}

fn planckian_uv(kelvin: f64) -> (f64, f64) {
    let (x, y) = planckian_xy(kelvin);
    xy_to_uv(x, y)
}

/// Half the chord, in mireds, that the locus normal is taken across.
const NORMAL_CHORD_MIRED: f64 = 2.0;

/// The unit normal to the locus at `kelvin` in uv, pointing to larger v
/// (above the locus, toward green). It is taken from the chord over
/// ±`NORMAL_CHORD_MIRED`, not the derivative, because the spline's slope
/// jumps where its segments join (2222 K and 4000 K): a normal from the
/// chord turns smoothly there, so every white point near a join still has
/// exactly one temperature and tint.
fn locus_normal(kelvin: f64) -> (f64, f64) {
    let mired = 1e6 / kelvin.clamp(MIN_KELVIN, MAX_KELVIN);
    let lo = planckian_uv(1e6 / (mired + NORMAL_CHORD_MIRED));
    let hi = planckian_uv(1e6 / (mired - NORMAL_CHORD_MIRED).max(1.0));
    let (tu, tv) = (hi.0 - lo.0, hi.1 - lo.1);
    let len = (tu * tu + tv * tv).sqrt().max(1e-12);
    let (nu, nv) = (-tv / len, tu / len);
    if nv < 0.0 {
        (-nu, -nv)
    } else {
        (nu, nv)
    }
}

/// The white point (xy) of a temperature in kelvin and a tint: the locus
/// point moved `tint / TINT_PER_DUV` along the locus normal in uv.
pub fn xy_from_temperature(kelvin: f64, tint: f64) -> (f64, f64) {
    let (u, v) = planckian_uv(kelvin);
    let (nu, nv) = locus_normal(kelvin);
    let duv = tint / TINT_PER_DUV;
    uv_to_xy(u + duv * nu, v + duv * nv)
}

/// The correlated colour temperature (kelvin) and tint of the white point
/// `xy`: the temperature whose normal line through the locus passes through
/// the white point, which is the nearest locus point wherever the locus is
/// smooth. When several do (far from the locus), the one nearest the
/// locus. A white point warmer or colder than the approximation covers
/// reads as its end (1667 K or 25000 K) with its distance as the tint.
pub fn temperature_from_xy(x: f64, y: f64) -> (f64, f64) {
    let (u, v) = xy_to_uv(x, y);
    let offset = |mired: f64| {
        let kelvin = 1e6 / mired;
        let (lu, lv) = planckian_uv(kelvin);
        let (nu, nv) = locus_normal(kelvin);
        // Along the tangent (nv, -nu), and along the normal.
        ((u - lu) * nv - (v - lv) * nu, (u - lu) * nu + (v - lv) * nv)
    };
    let (lo_m, hi_m) = (1e6 / MAX_KELVIN, 1e6 / MIN_KELVIN);
    let steps = 1120;
    let step = (hi_m - lo_m) / steps as f64;
    let mut best: Option<(f64, f64)> = None;
    let mut prev = (lo_m, offset(lo_m).0);
    for i in 1..=steps {
        let m = lo_m + i as f64 * step;
        let f = offset(m).0;
        if prev.1 == 0.0 || prev.1.signum() != f.signum() {
            let (mut a, mut b, mut fa) = (prev.0, m, prev.1);
            for _ in 0..60 {
                let mid = 0.5 * (a + b);
                let fm = offset(mid).0;
                if fa.signum() == fm.signum() && fm != 0.0 {
                    a = mid;
                    fa = fm;
                } else {
                    b = mid;
                }
            }
            let root = 0.5 * (a + b);
            let duv = offset(root).1;
            if best.is_none_or(|(_, d)| duv.abs() < d.abs()) {
                best = Some((root, duv));
            }
        }
        prev = (m, f);
    }
    let (mired, duv) = best.unwrap_or_else(|| {
        // No normal line reaches the point: it lies beyond an end.
        let end = if offset(lo_m).1.abs() <= offset(hi_m).1.abs() { lo_m } else { hi_m };
        let (lu, lv) = planckian_uv(1e6 / end);
        let dist = ((u - lu).powi(2) + (v - lv).powi(2)).sqrt();
        (end, dist.copysign(offset(end).1))
    });
    (1e6 / mired, duv * TINT_PER_DUV)
}

/// XYZ (Y = 1) of a white point given as xy.
pub fn xy_to_xyz(x: f64, y: f64) -> [f64; 3] {
    crate::colorimetry::xy_to_xyz(x, y)
}

/// xy of an XYZ colour; `None` for a colour with no chromaticity (black,
/// or a sum that is not positive).
pub fn xyz_to_xy(xyz: [f64; 3]) -> Option<(f64, f64)> {
    let s = xyz[0] + xyz[1] + xyz[2];
    (s > 1e-12 && s.is_finite()).then(|| (xyz[0] / s, xyz[1] / s))
}

/// A 3×3 matrix as the row-major array the develop settings use.
pub fn flatten(m: &Mat3) -> [f32; 9] {
    [m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2]].map(|v| v as f32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn d65_is_6504_kelvin_and_a_little_green() {
        let (k, tint) = temperature_from_xy(0.31271, 0.32902);
        assert!((k - 6504.0).abs() < 10.0, "D65 read as {k} K");
        // D65 lies above the locus by about Duv 0.003.
        assert!(tint > 5.0 && tint < 15.0, "D65 tint {tint}");
    }

    #[test]
    fn illuminant_a_is_2856_kelvin_on_the_locus() {
        // CIE illuminant A: x = 0.44757, y = 0.40745.
        let (k, tint) = temperature_from_xy(0.44757, 0.40745);
        assert!((k - 2856.0).abs() < 10.0, "A read as {k} K");
        assert!(tint.abs() < 1.5, "A tint {tint}");
    }

    #[test]
    fn d50_is_about_5003_kelvin() {
        let (k, _) = temperature_from_xy(0.34567, 0.35850);
        assert!((k - 5003.0).abs() < 10.0, "D50 read as {k} K");
    }

    #[test]
    fn temperature_and_tint_round_trip() {
        let mut worst = (0.0f64, 0.0f64);
        for kelvin in (2000..=12000).step_by(250) {
            for tint in [-150.0, -60.0, -10.0, 0.0, 10.0, 60.0, 150.0] {
                let (x, y) = xy_from_temperature(kelvin as f64, tint);
                let (k2, t2) = temperature_from_xy(x, y);
                worst.0 = worst.0.max((k2 - kelvin as f64).abs());
                worst.1 = worst.1.max((t2 - tint).abs());
            }
        }
        assert!(worst.0 < 0.5 && worst.1 < 0.05, "worst round trip: {} K, {} tint", worst.0, worst.1);
    }

    #[test]
    fn locus_points_have_zero_tint_and_warmer_is_redder() {
        let (x3, _) = planckian_xy(3000.0);
        let (x6, _) = planckian_xy(6000.0);
        assert!(x3 > x6);
        let (x, y) = planckian_xy(4500.0);
        let (k, tint) = temperature_from_xy(x, y);
        assert!((k - 4500.0).abs() < 0.5 && tint.abs() < 0.05, "{k} {tint}");
    }

    #[test]
    fn uv_round_trips() {
        let (u, v) = xy_to_uv(0.3127, 0.3290);
        let (x, y) = uv_to_xy(u, v);
        assert!((x - 0.3127).abs() < 1e-12 && (y - 0.3290).abs() < 1e-12);
    }
}
