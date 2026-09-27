//! Projective (homography) maps between the unit square and a quad.

/// 3×3 row-major projective matrix.
pub type Homography = [f64; 9];

/// The projective map taking the unit square (0,0) (1,0) (1,1) (0,1) onto
/// the quad `tl, tr, br, bl` (Heckbert's closed form). Unlike bilinear
/// interpolation of the corners, this foreshortens receding edges (#927).
pub fn square_to_quad(tl: [f64; 2], tr: [f64; 2], br: [f64; 2], bl: [f64; 2]) -> Homography {
    let sx = tl[0] - tr[0] + br[0] - bl[0];
    let sy = tl[1] - tr[1] + br[1] - bl[1];
    if sx.abs() < 1e-9 && sy.abs() < 1e-9 {
        return [
            tr[0] - tl[0], bl[0] - tl[0], tl[0],
            tr[1] - tl[1], bl[1] - tl[1], tl[1],
            0.0, 0.0, 1.0,
        ];
    }
    let dx1 = tr[0] - br[0];
    let dx2 = bl[0] - br[0];
    let dy1 = tr[1] - br[1];
    let dy2 = bl[1] - br[1];
    let den = dx1 * dy2 - dx2 * dy1;
    let (g, h) = if den == 0.0 {
        (0.0, 0.0)
    } else {
        ((sx * dy2 - dx2 * sy) / den, (dx1 * sy - sx * dy1) / den)
    };
    [
        tr[0] - tl[0] + g * tr[0], bl[0] - tl[0] + h * bl[0], tl[0],
        tr[1] - tl[1] + g * tr[1], bl[1] - tl[1] + h * bl[1], tl[1],
        g, h, 1.0,
    ]
}

/// True inverse (adjugate / det). Dividing by the determinant — rather than
/// returning the bare adjugate, which is equal up to scale — keeps w > 0 for
/// points inside a convex quad, so shaders can reject w ≤ 0.
pub fn invert(m: &Homography) -> Option<Homography> {
    let [a, b, c, d, e, f, g, h, i] = *m;
    let ca = e * i - f * h;
    let cb = -(d * i - f * g);
    let cc = d * h - e * g;
    let det = a * ca + b * cb + c * cc;
    if det.abs() < 1e-12 {
        return None;
    }
    let k = 1.0 / det;
    Some([
        ca * k, -(b * i - c * h) * k, (b * f - c * e) * k,
        cb * k, (a * i - c * g) * k, -(a * f - c * d) * k,
        cc * k, -(a * h - b * g) * k, (a * e - b * d) * k,
    ])
}

/// Apply a homography to a point. `None` on or behind the horizon (w ≤ 0).
pub fn apply(m: &Homography, x: f64, y: f64) -> Option<[f64; 2]> {
    let w = m[6] * x + m[7] * y + m[8];
    if w <= 1e-12 {
        return None;
    }
    Some([
        (m[0] * x + m[1] * y + m[2]) / w,
        (m[3] * x + m[4] * y + m[5]) / w,
    ])
}

/// Column-major f32 copy for `uniformMatrix3fv(transpose = false)`.
pub fn to_gl_column_major(m: &Homography) -> [f32; 9] {
    [
        m[0] as f32, m[3] as f32, m[6] as f32,
        m[1] as f32, m[4] as f32, m[7] as f32,
        m[2] as f32, m[5] as f32, m[8] as f32,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    const TL: [f64; 2] = [0.0, 0.0];
    const TR: [f64; 2] = [800.0, 0.0];
    const BR: [f64; 2] = [1200.0, 800.0];
    const BL: [f64; 2] = [-400.0, 800.0];

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn maps_corners() {
        let m = square_to_quad(TL, TR, BR, BL);
        for (u, v, p) in [(0.0, 0.0, TL), (1.0, 0.0, TR), (1.0, 1.0, BR), (0.0, 1.0, BL)] {
            let q = apply(&m, u, v).unwrap();
            assert!(close(q[0], p[0]) && close(q[1], p[1]), "{u},{v} -> {q:?}");
        }
    }

    #[test]
    fn foreshortens_toward_narrow_edge() {
        let m = square_to_quad(TL, TR, BR, BL);
        let mid = apply(&m, 0.5, 0.5).unwrap();
        // 2:1 width ratio → the far (top) half is half the near half's height.
        assert!(close(mid[1], 800.0 / 3.0), "mid y = {}", mid[1]);
    }

    #[test]
    fn inverse_round_trips() {
        let m = square_to_quad([10.0, 20.0], [300.0, 5.0], [350.0, 400.0], [-20.0, 380.0]);
        let inv = invert(&m).unwrap();
        let p = apply(&m, 0.3, 0.7).unwrap();
        let back = apply(&inv, p[0], p[1]).unwrap();
        assert!(close(back[0], 0.3) && close(back[1], 0.7));
    }

    #[test]
    fn gl_matrix_has_positive_w_inside_quad() {
        // Mirrored (clockwise-flipped) quad: det < 0, the case where a bare
        // adjugate would give negative w.
        let inv = invert(&square_to_quad(TR, TL, BL, BR)).unwrap();
        let g = to_gl_column_major(&inv);
        // w = row 3 · (x, y, 1) = g[2]*x + g[5]*y + g[8]
        let (x, y) = (400.0f32, 400.0f32);
        assert!(g[2] * x + g[5] * y + g[8] > 0.0);
    }

    #[test]
    fn degenerate_quad_has_no_inverse() {
        let p = [5.0, 5.0];
        assert!(invert(&square_to_quad(p, p, p, p)).is_none());
    }
}
