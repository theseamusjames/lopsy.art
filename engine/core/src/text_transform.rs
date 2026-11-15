//! Placement math for transformed text layers.
//!
//! A transformed text layer maps its layout space (the text anchor at the
//! origin) into the document with a linear map plus the anchor:
//! `doc = M · p + anchor`, where `M = [a c; b d]` follows the canvas
//! `setTransform(a, b, c, d, e, f)` convention. The glyphs are rasterized
//! upright at `scale` × their size (so the resample never magnifies), which
//! puts layout point `p` at raster pixel `q = scale · p - offset`.

/// Largest raster or output edge the transformed text path will allocate.
pub const MAX_TEXT_RASTER_EDGE: u32 = 8192;

/// Linear part of a text transform, canvas convention: `x' = a·x + c·y`,
/// `y' = b·x + d·y`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TextMatrix {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
}

impl TextMatrix {
    pub fn determinant(&self) -> f64 {
        self.a * self.d - self.b * self.c
    }

    pub fn apply(&self, x: f64, y: f64) -> (f64, f64) {
        (self.a * x + self.c * y, self.b * x + self.d * y)
    }

    pub fn inverse(&self) -> Option<TextMatrix> {
        let det = self.determinant();
        if det.abs() < 1e-9 {
            return None;
        }
        Some(TextMatrix {
            a: self.d / det,
            b: -self.b / det,
            c: -self.c / det,
            d: self.a / det,
        })
    }
}

/// Integer document rect the transformed raster covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DocRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Document-space rect covering a `raster_w × raster_h` upright raster whose
/// top-left sits at layout point `(offset_x, offset_y) / scale`, once placed
/// through `m` at `anchor`. `None` when the result is empty or too large.
pub fn transformed_raster_rect(
    m: &TextMatrix,
    anchor: (f64, f64),
    scale: f64,
    raster_w: u32,
    raster_h: u32,
    offset_x: f64,
    offset_y: f64,
) -> Option<DocRect> {
    if scale <= 0.0 || raster_w == 0 || raster_h == 0 {
        return None;
    }
    let corners = [
        (0.0, 0.0),
        (raster_w as f64, 0.0),
        (raster_w as f64, raster_h as f64),
        (0.0, raster_h as f64),
    ];
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for (qx, qy) in corners {
        let (dx, dy) = m.apply((qx + offset_x) / scale, (qy + offset_y) / scale);
        let (x, y) = (dx + anchor.0, dy + anchor.1);
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
    }
    let x0 = min_x.floor();
    let y0 = min_y.floor();
    let w = (max_x.ceil() - x0).max(1.0);
    let h = (max_y.ceil() - y0).max(1.0);
    if !w.is_finite() || !h.is_finite() {
        return None;
    }
    if w > MAX_TEXT_RASTER_EDGE as f64 || h > MAX_TEXT_RASTER_EDGE as f64 {
        return None;
    }
    Some(DocRect { x: x0 as i32, y: y0 as i32, width: w as u32, height: h as u32 })
}

/// Linear map from a document offset (relative to the anchor) to a raster
/// offset: `q + offset = scale · M⁻¹ · (doc - anchor)`.
pub fn doc_to_raster_linear(m: &TextMatrix, scale: f64) -> Option<TextMatrix> {
    let inv = m.inverse()?;
    Some(TextMatrix { a: inv.a * scale, b: inv.b * scale, c: inv.c * scale, d: inv.d * scale })
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDENTITY: TextMatrix = TextMatrix { a: 1.0, b: 0.0, c: 0.0, d: 1.0 };

    #[test]
    fn identity_rect_is_anchor_plus_offset() {
        let r = transformed_raster_rect(&IDENTITY, (100.0, 50.0), 1.0, 40, 20, -4.0, -4.0).unwrap();
        assert_eq!(r, DocRect { x: 96, y: 46, width: 40, height: 20 });
    }

    #[test]
    fn supersampled_raster_maps_back_to_layout_size() {
        let r = transformed_raster_rect(&IDENTITY, (0.0, 0.0), 2.0, 80, 40, -8.0, -8.0).unwrap();
        assert_eq!(r, DocRect { x: -4, y: -4, width: 40, height: 20 });
    }

    #[test]
    fn quarter_turn_swaps_extent() {
        // 90° clockwise in y-down space: (x, y) → (-y, x).
        let m = TextMatrix { a: 0.0, b: 1.0, c: -1.0, d: 0.0 };
        let r = transformed_raster_rect(&m, (100.0, 100.0), 1.0, 40, 20, 0.0, 0.0).unwrap();
        assert_eq!(r, DocRect { x: 80, y: 100, width: 20, height: 40 });
    }

    #[test]
    fn degenerate_matrix_has_no_inverse() {
        let m = TextMatrix { a: 1.0, b: 2.0, c: 2.0, d: 4.0 };
        assert!(doc_to_raster_linear(&m, 1.0).is_none());
    }

    #[test]
    fn doc_to_raster_round_trips_a_point() {
        let m = TextMatrix { a: 0.8, b: 0.6, c: -0.6, d: 0.8 };
        let inv = doc_to_raster_linear(&m, 2.0).unwrap();
        let (dx, dy) = m.apply(10.0, 5.0);
        let (qx, qy) = inv.apply(dx, dy);
        assert!((qx - 20.0).abs() < 1e-9 && (qy - 10.0).abs() < 1e-9);
    }

    #[test]
    fn oversized_output_is_rejected() {
        let m = TextMatrix { a: 1000.0, b: 0.0, c: 0.0, d: 1000.0 };
        assert!(transformed_raster_rect(&m, (0.0, 0.0), 1.0, 100, 100, 0.0, 0.0).is_none());
    }
}
