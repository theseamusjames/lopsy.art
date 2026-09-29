use crate::geometry::Rect;

/// Create a rectangular selection mask
pub fn create_rect_selection(
    width: u32, height: u32,
    sel_x: i32, sel_y: i32, sel_w: u32, sel_h: u32,
) -> Vec<u8> {
    let mut mask = vec![0u8; (width * height) as usize];
    let x1 = sel_x.max(0) as u32;
    let y1 = sel_y.max(0) as u32;
    let x2 = ((sel_x + sel_w as i32) as u32).min(width);
    let y2 = ((sel_y + sel_h as i32) as u32).min(height);

    for y in y1..y2 {
        for x in x1..x2 {
            mask[(y * width + x) as usize] = 255;
        }
    }
    mask
}

/// Vertical sub-scanlines per pixel row when rasterizing anti-aliased
/// selection shapes. Horizontal coverage is computed exactly per span, so
/// this only bounds the precision of near-horizontal edges (1/16 px).
const AA_SUBSCANLINES: usize = 16;

/// Accumulates fractional span coverage for one mask row. Full-pixel runs go
/// through a difference array so a span costs O(1) regardless of its length.
struct RowCoverage {
    area: Vec<f32>,
    cover: Vec<f32>,
    lo: usize,
    hi: usize,
}

impl RowCoverage {
    fn new(width: u32) -> Self {
        let w = width as usize;
        Self { area: vec![0.0; w], cover: vec![0.0; w + 1], lo: w, hi: 0 }
    }

    fn add_span(&mut self, xa: f64, xb: f64, weight: f32) {
        let w = self.area.len() as f64;
        let xa = xa.clamp(0.0, w);
        let xb = xb.clamp(0.0, w);
        if xb <= xa {
            return;
        }
        let ia = xa.floor() as usize;
        let ib = xb.floor() as usize;
        self.lo = self.lo.min(ia);
        self.hi = self.hi.max((ib + 1).min(self.area.len()));
        if ia == ib {
            self.area[ia] += (xb - xa) as f32 * weight;
            return;
        }
        self.area[ia] += (ia as f64 + 1.0 - xa) as f32 * weight;
        self.cover[ia + 1] += weight;
        self.cover[ib] -= weight;
        if ib < self.area.len() {
            self.area[ib] += (xb - ib as f64) as f32 * weight;
        }
    }

    /// Write the accumulated coverage into `row` and reset for the next row.
    fn flush(&mut self, row: &mut [u8]) {
        let mut running = 0.0f32;
        for x in self.lo..self.hi {
            running += self.cover[x];
            let v = (running + self.area[x]).clamp(0.0, 1.0);
            row[x] = (v * 255.0).round() as u8;
            self.area[x] = 0.0;
            self.cover[x] = 0.0;
        }
        if self.hi < self.cover.len() {
            self.cover[self.hi] = 0.0;
        }
        self.lo = self.area.len();
        self.hi = 0;
    }
}

/// Create an anti-aliased elliptical selection mask. Edge pixels hold their
/// fractional coverage so fills through the selection come out smooth.
pub fn create_ellipse_selection(
    width: u32, height: u32,
    sel_x: i32, sel_y: i32, sel_w: u32, sel_h: u32,
) -> Vec<u8> {
    let mut mask = vec![0u8; (width * height) as usize];
    let cx = sel_x as f64 + sel_w as f64 / 2.0;
    let cy = sel_y as f64 + sel_h as f64 / 2.0;
    let rx = sel_w as f64 / 2.0;
    let ry = sel_h as f64 / 2.0;

    if rx < 0.5 || ry < 0.5 || width == 0 {
        return mask;
    }

    let y1 = (cy - ry).floor().max(0.0) as u32;
    let y2 = ((cy + ry).ceil().max(0.0) as u32).min(height);
    let weight = 1.0 / AA_SUBSCANLINES as f32;
    let mut acc = RowCoverage::new(width);

    for y in y1..y2 {
        for k in 0..AA_SUBSCANLINES {
            let sy = y as f64 + (k as f64 + 0.5) / AA_SUBSCANLINES as f64;
            let t = (sy - cy) / ry;
            if t.abs() >= 1.0 {
                continue;
            }
            let half = rx * (1.0 - t * t).sqrt();
            acc.add_span(cx - half, cx + half, weight);
        }
        let start = (y * width) as usize;
        acc.flush(&mut mask[start..start + width as usize]);
    }
    mask
}

/// Invert a selection mask
pub fn invert_selection(mask: &[u8]) -> Vec<u8> {
    mask.iter().map(|&v| 255 - v).collect()
}

/// Combine two selection masks
/// mode: 0=replace, 1=add(union), 2=subtract, 3=intersect
pub fn combine_selections(a: &[u8], b: &[u8], mode: u32) -> Vec<u8> {
    assert_eq!(a.len(), b.len());
    a.iter().zip(b.iter()).map(|(&av, &bv)| {
        match mode {
            0 => bv,
            1 => av.max(bv),
            2 => av.saturating_sub(bv),
            3 => av.min(bv),
            _ => av,
        }
    }).collect()
}

/// Find bounding box of non-zero pixels in a mask
pub fn selection_bounds(mask: &[u8], width: u32, height: u32) -> Option<Rect> {
    let mut min_x = width as i32;
    let mut min_y = height as i32;
    let mut max_x = -1i32;
    let mut max_y = -1i32;

    for y in 0..height {
        for x in 0..width {
            if mask[(y * width + x) as usize] > 0 {
                min_x = min_x.min(x as i32);
                min_y = min_y.min(y as i32);
                max_x = max_x.max(x as i32);
                max_y = max_y.max(y as i32);
            }
        }
    }

    if max_x < 0 {
        None
    } else {
        Some(Rect::new(min_x, min_y, (max_x - min_x + 1) as u32, (max_y - min_y + 1) as u32))
    }
}

/// Check if a mask is entirely zero
pub fn is_empty_selection(mask: &[u8]) -> bool {
    mask.iter().all(|&v| v == 0)
}

/// Trace selection contours — returns pairs of (x1,y1,x2,y2) line segments
pub fn trace_selection_contours(mask: &[u8], width: u32, height: u32) -> Vec<f64> {
    let mut segments = Vec::new();
    let w = width as i32;
    let h = height as i32;

    for y in 0..=h {
        for x in 0..=w {
            let inside = if x < w && y < h { mask[(y as u32 * width + x as u32) as usize] > 127 } else { false };

            // Horizontal edge: check above
            if y > 0 && x < w {
                let above = mask[((y - 1) as u32 * width + x as u32) as usize] > 127;
                if inside != above {
                    segments.extend_from_slice(&[x as f64, y as f64, (x + 1) as f64, y as f64]);
                }
            } else if y == 0 && x < w && inside {
                segments.extend_from_slice(&[x as f64, 0.0, (x + 1) as f64, 0.0]);
            }

            // Vertical edge: check left
            if x > 0 {
                let left = if y < h { mask[(y as u32 * width + (x - 1) as u32) as usize] > 127 } else { false };
                if y < h && inside != left {
                    segments.extend_from_slice(&[x as f64, y as f64, x as f64, (y + 1) as f64]);
                }
            } else if y < h && inside {
                segments.extend_from_slice(&[0.0, y as f64, 0.0, (y + 1) as f64]);
            }
        }
    }
    segments
}

/// Get selection edge segments — horizontal edges then vertical edges
pub fn get_selection_edges(mask: &[u8], width: u32, height: u32) -> Vec<f64> {
    trace_selection_contours(mask, width, height)
}

struct PolyEdge {
    y_min: f64,
    y_max: f64,
    x_at_y_min: f64,
    dx_dy: f64,
}

/// Create an anti-aliased polygon mask from a flat point array
/// [x0,y0,x1,y1,...] using the even-odd rule. Edge pixels hold their
/// fractional coverage; axis-aligned edges on whole-pixel coordinates stay
/// crisp.
pub fn create_polygon_mask(points: &[f64], width: u32, height: u32) -> Vec<u8> {
    let mut mask = vec![0u8; (width * height) as usize];
    let n = points.len() / 2;
    if n < 3 || width == 0 {
        return mask;
    }

    let mut edges: Vec<PolyEdge> = Vec::with_capacity(n);
    for i in 0..n {
        let j = (i + 1) % n;
        let (x0, y0) = (points[i * 2], points[i * 2 + 1]);
        let (x1, y1) = (points[j * 2], points[j * 2 + 1]);
        if y0 == y1 || !(x0.is_finite() && y0.is_finite() && x1.is_finite() && y1.is_finite()) {
            continue;
        }
        let (top_x, top_y, bot_x, bot_y) = if y0 < y1 { (x0, y0, x1, y1) } else { (x1, y1, x0, y0) };
        edges.push(PolyEdge {
            y_min: top_y,
            y_max: bot_y,
            x_at_y_min: top_x,
            dx_dy: (bot_x - top_x) / (bot_y - top_y),
        });
    }
    if edges.is_empty() {
        return mask;
    }
    edges.sort_by(|a, b| a.y_min.total_cmp(&b.y_min));

    let min_y = edges[0].y_min;
    let max_y = edges.iter().fold(f64::NEG_INFINITY, |m, e| m.max(e.y_max));
    let row_start = min_y.floor().max(0.0) as u32;
    let row_end = (max_y.ceil().max(0.0) as u32).min(height);

    let weight = 1.0 / AA_SUBSCANLINES as f32;
    let mut acc = RowCoverage::new(width);
    let mut active: Vec<usize> = Vec::new();
    let mut xs: Vec<f64> = Vec::new();
    let mut next_edge = 0usize;

    for y in row_start..row_end {
        for k in 0..AA_SUBSCANLINES {
            let sy = y as f64 + (k as f64 + 0.5) / AA_SUBSCANLINES as f64;
            while next_edge < edges.len() && edges[next_edge].y_min <= sy {
                active.push(next_edge);
                next_edge += 1;
            }
            active.retain(|&e| edges[e].y_max > sy);

            xs.clear();
            for &e in &active {
                let edge = &edges[e];
                if edge.y_min <= sy {
                    xs.push(edge.x_at_y_min + (sy - edge.y_min) * edge.dx_dy);
                }
            }
            xs.sort_by(|a, b| a.total_cmp(b));
            for pair in xs.chunks_exact(2) {
                acc.add_span(pair[0], pair[1], weight);
            }
        }
        let start = (y * width) as usize;
        acc.flush(&mut mask[start..start + width as usize]);
    }
    mask
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rect_selection() {
        let mask = create_rect_selection(10, 10, 2, 3, 4, 5);
        assert_eq!(mask[3 * 10 + 2], 255);
        assert_eq!(mask[7 * 10 + 5], 255);
        assert_eq!(mask[0], 0);
        assert_eq!(mask[3 * 10 + 6], 0);
    }

    #[test]
    fn test_ellipse_selection() {
        let mask = create_ellipse_selection(20, 20, 5, 5, 10, 10);
        // Center should be selected
        assert_eq!(mask[10 * 20 + 10], 255);
        // Corner should not
        assert_eq!(mask[0], 0);
    }

    #[test]
    fn test_invert() {
        let mask = vec![0, 128, 255];
        let inv = invert_selection(&mask);
        assert_eq!(inv, vec![255, 127, 0]);
    }

    #[test]
    fn test_combine_add() {
        let a = vec![100, 0, 200];
        let b = vec![50, 150, 100];
        let c = combine_selections(&a, &b, 1);
        assert_eq!(c, vec![100, 150, 200]);
    }

    #[test]
    fn test_combine_subtract() {
        let a = vec![200, 50, 100];
        let b = vec![100, 100, 50];
        let c = combine_selections(&a, &b, 2);
        assert_eq!(c, vec![100, 0, 50]);
    }

    #[test]
    fn test_selection_bounds() {
        let mut mask = vec![0u8; 100];
        mask[35] = 255; // (5, 3)
        mask[67] = 255; // (7, 6)
        let b = selection_bounds(&mask, 10, 10).unwrap();
        assert_eq!(b.x, 5);
        assert_eq!(b.y, 3);
        assert_eq!(b.width, 3);
        assert_eq!(b.height, 4);
    }

    #[test]
    fn test_empty_selection() {
        assert!(is_empty_selection(&[0, 0, 0]));
        assert!(!is_empty_selection(&[0, 1, 0]));
    }

    #[test]
    fn test_polygon_mask() {
        // Triangle covering most of 10x10
        let points = vec![5.0, 0.0, 10.0, 10.0, 0.0, 10.0];
        let mask = create_polygon_mask(&points, 10, 10);
        // Bottom middle should be filled
        assert_eq!(mask[9 * 10 + 5], 255);
        // Top corners should be empty
        assert_eq!(mask[0], 0);
    }

    fn partial_count(mask: &[u8]) -> usize {
        mask.iter().filter(|&&v| v > 0 && v < 255).count()
    }

    fn coverage_sum(mask: &[u8]) -> f64 {
        mask.iter().map(|&v| v as f64 / 255.0).sum()
    }

    #[test]
    fn test_ellipse_selection_is_antialiased() {
        let mask = create_ellipse_selection(200, 200, 50, 50, 100, 100);
        // Every edge pixel of a 100 px circle crosses the boundary; a 1-bit
        // mask would have none with partial coverage.
        assert!(partial_count(&mask) > 200, "partial = {}", partial_count(&mask));
        assert_eq!(mask[100 * 200 + 100], 255);
        assert_eq!(mask[50 * 200 + 50], 0);
        let area = std::f64::consts::PI * 50.0 * 50.0;
        assert!((coverage_sum(&mask) - area).abs() < area * 0.002);
        // Leftmost point of the circle at (50, 100): pixel 50 is ~half covered
        // by the arc around y = 100, pixel 49 is empty.
        assert_eq!(mask[100 * 200 + 49], 0);
        let edge = mask[100 * 200 + 50];
        assert!(edge > 0 && edge < 255, "edge = {edge}");
    }

    #[test]
    fn test_ellipse_selection_clipped_to_canvas() {
        let mask = create_ellipse_selection(20, 20, -10, -10, 20, 20);
        assert_eq!(mask[0], 255);
        assert_eq!(mask[19 * 20 + 19], 0);
    }

    #[test]
    fn test_polygon_mask_is_antialiased() {
        let points = vec![250.0, 50.0, 350.0, 90.0, 260.0, 150.0];
        let mask = create_polygon_mask(&points, 400, 300);
        assert!(partial_count(&mask) > 100, "partial = {}", partial_count(&mask));
        // Shoelace area of the triangle.
        let area = ((350.0 - 250.0) * (150.0 - 50.0) - (260.0 - 250.0) * (90.0 - 50.0)) / 2.0;
        assert!((coverage_sum(&mask) - area).abs() < area * 0.005);
        assert_eq!(mask[90 * 400 + 290], 255);
    }

    #[test]
    fn test_polygon_mask_axis_aligned_stays_crisp() {
        let points = vec![2.0, 3.0, 8.0, 3.0, 8.0, 7.0, 2.0, 7.0];
        let mask = create_polygon_mask(&points, 10, 10);
        assert_eq!(partial_count(&mask), 0);
        assert_eq!(mask.iter().filter(|&&v| v == 255).count(), 24);
        assert_eq!(mask[3 * 10 + 2], 255);
        assert_eq!(mask[3 * 10 + 8], 0);
    }

    #[test]
    fn test_polygon_mask_half_pixel_edge() {
        let points = vec![2.5, 0.0, 6.0, 0.0, 6.0, 4.0, 2.5, 4.0];
        let mask = create_polygon_mask(&points, 10, 4);
        assert_eq!(mask[2], 128);
        assert_eq!(mask[3], 255);
        assert_eq!(mask[6], 0);
    }

    #[test]
    fn test_polygon_mask_self_intersecting_even_odd() {
        // Two overlapping squares traced as one path: the overlap is a hole.
        let points = vec![
            0.0, 0.0, 6.0, 0.0, 6.0, 6.0, 0.0, 6.0, 0.0, 0.0,
            3.0, 3.0, 9.0, 3.0, 9.0, 9.0, 3.0, 9.0, 3.0, 3.0,
        ];
        let mask = create_polygon_mask(&points, 10, 10);
        assert_eq!(mask[1 * 10 + 1], 255);
        assert_eq!(mask[4 * 10 + 4], 0);
        assert_eq!(mask[8 * 10 + 8], 255);
    }

    #[test]
    fn test_contours_simple_rect() {
        let mask = create_rect_selection(4, 4, 1, 1, 2, 2);
        let contours = trace_selection_contours(&mask, 4, 4);
        assert!(!contours.is_empty());
        assert_eq!(contours.len() % 4, 0); // each segment is 4 floats
    }
}
