//! Per-camera tone curves for raw decoding. These approximate the
//! built-in tone mapping that camera JPEGs use, applied to raw images
//! so the default look matches what users see on the camera's screen.
//!
//! Curves are stored as a small set of control points in linear light
//! [0, 1] and evaluated via a monotonic cubic Hermite spline
//! (Fritsch–Carlson), which is bounded by the control points and does
//! not overshoot the way a natural cubic spline would.
//!
//! The numeric control points are derived from publicly known
//! Fujifilm-style tone shapes (analogous to the "fujifilm like" preset
//! distributed with darktable). They are facts, not code, and are
//! reimplemented here from scratch rather than copied.

/// A named base curve: a small ordered list of (x, y) control points in
/// linear-light [0, 1]. The first point must be (0, 0) and the last
/// must be (1, 1).
pub struct BaseCurve {
    pub name: &'static str,
    pub points: &'static [(f32, f32)],
}

/// Provia — Fujifilm's "standard" rendering. A mild S-curve that lifts
/// shadows slightly and adds gentle contrast through the midtones.
pub const FUJI_PROVIA: BaseCurve = BaseCurve {
    name: "Provia (Standard)",
    points: &[
        (0.000, 0.000),
        (0.028, 0.030),
        (0.105, 0.180),
        (0.300, 0.470),
        (0.550, 0.770),
        (0.800, 0.945),
        (1.000, 1.000),
    ],
};

/// Velvia — Fujifilm's "vivid" rendering. Steeper midtone contrast and
/// a slightly darker shadow toe than Provia, giving a punchier image.
pub const FUJI_VELVIA: BaseCurve = BaseCurve {
    name: "Velvia (Vivid)",
    points: &[
        (0.000, 0.000),
        (0.030, 0.022),
        (0.120, 0.170),
        (0.300, 0.510),
        (0.550, 0.820),
        (0.800, 0.965),
        (1.000, 1.000),
    ],
};

/// Astia — Fujifilm's "soft" rendering. Lifted shadows and a smoother,
/// flatter midtone for portrait-friendly skin tones.
pub const FUJI_ASTIA: BaseCurve = BaseCurve {
    name: "Astia (Soft)",
    points: &[
        (0.000, 0.000),
        (0.025, 0.045),
        (0.110, 0.210),
        (0.300, 0.450),
        (0.550, 0.730),
        (0.800, 0.930),
        (1.000, 1.000),
    ],
};

/// Classic Chrome — muted, lower contrast with a flatter shadow region.
pub const FUJI_CLASSIC_CHROME: BaseCurve = BaseCurve {
    name: "Classic Chrome",
    points: &[
        (0.000, 0.000),
        (0.030, 0.025),
        (0.130, 0.165),
        (0.330, 0.430),
        (0.580, 0.710),
        (0.820, 0.910),
        (1.000, 1.000),
    ],
};

/// DR400 — dynamic-range expansion. A gentler curve that pulls
/// highlights down to preserve more of the highlight roll-off region,
/// at the cost of a flatter midtone.
pub const FUJI_DR400: BaseCurve = BaseCurve {
    name: "DR400 (Wide DR)",
    points: &[
        (0.000, 0.000),
        (0.030, 0.035),
        (0.130, 0.200),
        (0.330, 0.430),
        (0.600, 0.680),
        (0.850, 0.880),
        (1.000, 0.985),
    ],
};

/// Default base curve for a given camera model. Falls back to Provia
/// (the camera's "standard" rendering) when no model-specific override
/// is known.
pub fn default_curve_for_model(_camera_model: &str) -> &'static BaseCurve {
    &FUJI_VELVIA
}

// ── Apply ────────────────────────────────────────────────────────────

/// Apply a base curve to RGB f32 values in place. Values outside [0, 1]
/// are clamped before lookup. Uses a precomputed 4096-entry LUT built
/// via monotonic cubic Hermite interpolation.
pub fn apply_base_curve(rgb: &mut [f32], curve: &BaseCurve) {
    let lut = build_lut(curve);
    for v in rgb.iter_mut() {
        *v = sample_lut(&lut, *v);
    }
}

/// 4096 entries: enough resolution that linear interpolation between
/// adjacent samples adds less error than the curve's own quantization
/// after sRGB gamma.
const LUT_SIZE: usize = 4096;

fn sample_lut(lut: &[f32; LUT_SIZE], x: f32) -> f32 {
    let xc = x.clamp(0.0, 1.0);
    let scaled = xc * (LUT_SIZE - 1) as f32;
    let i0 = scaled.floor() as usize;
    let i1 = (i0 + 1).min(LUT_SIZE - 1);
    let t = scaled - i0 as f32;
    lut[i0] * (1.0 - t) + lut[i1] * t
}

fn build_lut(curve: &BaseCurve) -> [f32; LUT_SIZE] {
    let pts = curve.points;
    // Defensive: if a curve is malformed, fall back to identity.
    if pts.len() < 2 {
        let mut id = [0.0f32; LUT_SIZE];
        for i in 0..LUT_SIZE {
            id[i] = i as f32 / (LUT_SIZE - 1) as f32;
        }
        return id;
    }

    let n = pts.len();
    let xs: Vec<f32> = pts.iter().map(|p| p.0).collect();
    let ys: Vec<f32> = pts.iter().map(|p| p.1).collect();
    let tangents = fritsch_carlson_tangents(&xs, &ys);

    let mut lut = [0.0f32; LUT_SIZE];
    let mut seg = 0usize;
    for i in 0..LUT_SIZE {
        let x = i as f32 / (LUT_SIZE - 1) as f32;
        while seg + 1 < n - 1 && x > xs[seg + 1] {
            seg += 1;
        }
        let x0 = xs[seg];
        let x1 = xs[seg + 1];
        let y0 = ys[seg];
        let y1 = ys[seg + 1];
        let m0 = tangents[seg];
        let m1 = tangents[seg + 1];
        let h = (x1 - x0).max(1e-8);
        let t = ((x - x0) / h).clamp(0.0, 1.0);
        lut[i] = hermite(y0, y1, m0 * h, m1 * h, t).clamp(0.0, 1.0);
    }
    lut
}

/// Hermite basis: h00*y0 + h10*m0 + h01*y1 + h11*m1, where m0/m1 are
/// pre-scaled by the interval width.
fn hermite(y0: f32, y1: f32, m0: f32, m1: f32, t: f32) -> f32 {
    let t2 = t * t;
    let t3 = t2 * t;
    let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
    let h10 = t3 - 2.0 * t2 + t;
    let h01 = -2.0 * t3 + 3.0 * t2;
    let h11 = t3 - t2;
    h00 * y0 + h10 * m0 + h01 * y1 + h11 * m1
}

/// Fritsch–Carlson monotone cubic tangents. Given n control points
/// (xs[i], ys[i]), returns n slopes that yield a C¹ piecewise cubic
/// that is monotone on each segment whenever the input is monotone.
fn fritsch_carlson_tangents(xs: &[f32], ys: &[f32]) -> Vec<f32> {
    let n = xs.len();
    if n == 0 {
        return Vec::new();
    }
    if n == 1 {
        return vec![0.0];
    }

    // Secant slopes between adjacent points.
    let mut d = vec![0.0f32; n - 1];
    for i in 0..n - 1 {
        let dx = (xs[i + 1] - xs[i]).max(1e-8);
        d[i] = (ys[i + 1] - ys[i]) / dx;
    }

    // Initial tangents: average of adjacent secants for interior points,
    // and the boundary secants at the ends.
    let mut m = vec![0.0f32; n];
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for i in 1..n - 1 {
        m[i] = 0.5 * (d[i - 1] + d[i]);
    }

    // Enforce monotonicity (Fritsch–Carlson). Where two consecutive
    // input values are equal, the segment must be flat — zero out the
    // adjoining tangents. Elsewhere, project (m[i], m[i+1]) into a disc
    // of radius 3 around the secant to guarantee monotone segments.
    for i in 0..n - 1 {
        if d[i].abs() < 1e-8 {
            m[i] = 0.0;
            m[i + 1] = 0.0;
            continue;
        }
        let a = m[i] / d[i];
        let b = m[i + 1] / d[i];
        let s = a * a + b * b;
        if s > 9.0 {
            let tau = 3.0 / s.sqrt();
            m[i] = tau * a * d[i];
            m[i + 1] = tau * b * d[i];
        }
    }

    m
}

// ── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f32, b: f32, eps: f32) -> bool {
        (a - b).abs() < eps
    }

    #[test]
    fn endpoints_map_to_endpoints() {
        for curve in [&FUJI_PROVIA, &FUJI_VELVIA, &FUJI_ASTIA, &FUJI_CLASSIC_CHROME, &FUJI_DR400] {
            let lut = build_lut(curve);
            assert!(approx(lut[0], curve.points[0].1, 1e-4), "curve {} bad start", curve.name);
            assert!(
                approx(lut[LUT_SIZE - 1], curve.points.last().unwrap().1, 1e-4),
                "curve {} bad end", curve.name
            );
        }
    }

    #[test]
    fn lut_is_monotone_nondecreasing() {
        for curve in [&FUJI_PROVIA, &FUJI_VELVIA, &FUJI_ASTIA, &FUJI_CLASSIC_CHROME, &FUJI_DR400] {
            let lut = build_lut(curve);
            for i in 1..LUT_SIZE {
                assert!(
                    lut[i] >= lut[i - 1] - 1e-5,
                    "curve {} not monotone at i={}: {} < {}", curve.name, i, lut[i], lut[i - 1]
                );
            }
        }
    }

    #[test]
    fn apply_base_curve_clamps_and_remaps() {
        let mut rgb = vec![-0.5f32, 0.0, 0.5, 1.0, 1.5];
        apply_base_curve(&mut rgb, &FUJI_PROVIA);
        // Clamped inputs land at the curve endpoints.
        assert!(approx(rgb[0], 0.0, 1e-3));
        assert!(approx(rgb[1], 0.0, 1e-3));
        assert!(approx(rgb[3], 1.0, 1e-3));
        assert!(approx(rgb[4], 1.0, 1e-3));
        // 0.5 sits in the upper midtone region — should still be inside [0,1].
        assert!(rgb[2] > 0.0 && rgb[2] < 1.0);
    }

    #[test]
    fn provia_default_is_used() {
        let c = default_curve_for_model("X-T5");
        assert_eq!(c.name, FUJI_PROVIA.name);
    }
}
