//! Magnetic lasso: edge-snapping freehand selection.
//!
//! Given an RGBA pixel buffer, `compute_edge_field` produces a doc-sized
//! Sobel gradient-magnitude field (u8 per pixel). `snap_segment` walks a
//! candidate segment and, at each sample, searches perpendicular to the
//! travel direction for the strongest edge within a radius, returning the
//! snapped polyline.
//!
//! Only geometry flows out of this module — no pixel data leaves once
//! `compute_edge_field` has produced the reduced edge field.

/// Luma weights for Rec. 601. Matches `find_edges.glsl` so the tool snaps
/// to the same edges the Find Edges filter highlights.
const LUMA_R: f32 = 0.299;
const LUMA_G: f32 = 0.587;
const LUMA_B: f32 = 0.114;

/// Compute a per-pixel Sobel gradient magnitude, returned as u8 (0..255).
/// `rgba` must be `width * height * 4` bytes.
pub fn compute_edge_field(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    let mut edges = vec![0u8; w * h];
    if w < 3 || h < 3 {
        return edges;
    }

    #[inline(always)]
    fn luma_at(rgba: &[u8], w: usize, x: usize, y: usize) -> f32 {
        let i = (y * w + x) * 4;
        let r = rgba[i] as f32;
        let g = rgba[i + 1] as f32;
        let b = rgba[i + 2] as f32;
        r * LUMA_R + g * LUMA_G + b * LUMA_B
    }

    for y in 1..h - 1 {
        for x in 1..w - 1 {
            let tl = luma_at(rgba, w, x - 1, y - 1);
            let tc = luma_at(rgba, w, x, y - 1);
            let tr = luma_at(rgba, w, x + 1, y - 1);
            let ml = luma_at(rgba, w, x - 1, y);
            let mr = luma_at(rgba, w, x + 1, y);
            let bl = luma_at(rgba, w, x - 1, y + 1);
            let bc = luma_at(rgba, w, x, y + 1);
            let br = luma_at(rgba, w, x + 1, y + 1);

            let gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
            let gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
            // Normalise: Sobel on 0..255 inputs peaks at 4*255 = 1020.
            let mag = (gx * gx + gy * gy).sqrt() / 4.0;
            let clamped = mag.clamp(0.0, 255.0) as u8;
            edges[y * w + x] = clamped;
        }
    }
    edges
}

#[inline(always)]
fn sample_edge(edges: &[u8], w: i32, h: i32, x: i32, y: i32) -> u8 {
    if x < 0 || y < 0 || x >= w || y >= h {
        0
    } else {
        edges[(y as usize) * (w as usize) + (x as usize)]
    }
}

/// Snap a straight segment from `from` → `to` onto the strongest nearby edges.
///
/// At each unit-length sample along the segment, we search perpendicular to
/// the travel direction within ±`radius` pixels and snap to the position with
/// the largest edge magnitude that exceeds `threshold` (0..255). Samples with
/// no qualifying edge fall back to the straight-line position.
///
/// Returns a list of snapped points interleaved as `[x0, y0, x1, y1, ...]`.
/// The endpoints are always included.
pub fn snap_segment(
    edges: &[u8],
    width: u32,
    height: u32,
    from_x: f32,
    from_y: f32,
    to_x: f32,
    to_y: f32,
    radius: u32,
    threshold: u8,
) -> Vec<f32> {
    let w = width as i32;
    let h = height as i32;
    let dx = to_x - from_x;
    let dy = to_y - from_y;
    let len = (dx * dx + dy * dy).sqrt();

    if len < 1.0 || w < 3 || h < 3 {
        return vec![from_x, from_y, to_x, to_y];
    }

    // Unit tangent and perpendicular (normal)
    let tx = dx / len;
    let ty = dy / len;
    let nx = -ty;
    let ny = tx;

    // One sample per pixel along the segment, capped so we don't blow up.
    let sample_count = (len.ceil() as usize).min(4096).max(2);
    let radius = radius as i32;

    let mut out: Vec<f32> = Vec::with_capacity((sample_count + 1) * 2);
    out.push(from_x);
    out.push(from_y);

    // Skip the endpoints in the loop — first/last are anchored.
    for s in 1..sample_count {
        let t = s as f32 / sample_count as f32;
        let cx = from_x + dx * t;
        let cy = from_y + dy * t;

        // Search perpendicular ±radius for the strongest edge.
        let mut best_mag: i32 = threshold as i32 - 1;
        let mut best_off: f32 = 0.0;
        for r in -radius..=radius {
            let sx = (cx + nx * r as f32).round() as i32;
            let sy = (cy + ny * r as f32).round() as i32;
            let m = sample_edge(edges, w, h, sx, sy) as i32;
            // Prefer closer-to-centre on ties so weak fields don't drag the
            // anchor all the way to the search radius.
            if m > best_mag || (m == best_mag && r.abs() < (best_off.abs() as i32)) {
                best_mag = m;
                best_off = r as f32;
            }
        }

        if best_mag >= threshold as i32 {
            let px = cx + nx * best_off;
            let py = cy + ny * best_off;
            out.push(px.clamp(0.0, (w - 1) as f32));
            out.push(py.clamp(0.0, (h - 1) as f32));
        } else {
            out.push(cx);
            out.push(cy);
        }
    }

    out.push(to_x);
    out.push(to_y);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_rgba(w: u32, h: u32, mut fill: impl FnMut(u32, u32) -> [u8; 4]) -> Vec<u8> {
        let mut v = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let i = ((y * w + x) * 4) as usize;
                let c = fill(x, y);
                v[i..i + 4].copy_from_slice(&c);
            }
        }
        v
    }

    #[test]
    fn edge_field_is_zero_on_flat_image() {
        let rgba = make_rgba(10, 10, |_, _| [128, 128, 128, 255]);
        let edges = compute_edge_field(&rgba, 10, 10);
        assert!(edges.iter().all(|&e| e == 0));
    }

    #[test]
    fn edge_field_peaks_on_vertical_step() {
        // Left half black, right half white → strong vertical edge at x=5.
        let rgba = make_rgba(10, 10, |x, _| {
            if x < 5 { [0, 0, 0, 255] } else { [255, 255, 255, 255] }
        });
        let edges = compute_edge_field(&rgba, 10, 10);
        // Column x=4 or x=5 should fire strongly, interior row.
        let mid_row = 5usize;
        let max_col4 = edges[mid_row * 10 + 4];
        let max_col5 = edges[mid_row * 10 + 5];
        assert!(max_col4 > 200 || max_col5 > 200, "edge col4={max_col4} col5={max_col5}");
        // Far-left and far-right interior pixels should be flat.
        assert_eq!(edges[mid_row * 10 + 1], 0);
        assert_eq!(edges[mid_row * 10 + 8], 0);
    }

    #[test]
    fn snap_falls_back_on_no_edges() {
        let edges = vec![0u8; 20 * 20];
        let pts = snap_segment(&edges, 20, 20, 1.0, 10.0, 18.0, 10.0, 4, 50);
        assert_eq!(pts[0], 1.0);
        assert_eq!(pts[1], 10.0);
        let n = pts.len();
        assert_eq!(pts[n - 2], 18.0);
        assert_eq!(pts[n - 1], 10.0);
        // Interior samples should lie on the original line.
        for s in (2..n - 2).step_by(2) {
            assert_eq!(pts[s + 1], 10.0);
        }
    }

    #[test]
    fn snap_pulls_onto_nearby_edge() {
        // Build an edge field with a strong horizontal edge at y=12.
        let w = 40u32;
        let h = 40u32;
        let mut edges = vec![0u8; (w * h) as usize];
        for x in 0..w {
            edges[(12 * w + x) as usize] = 255;
        }
        // Candidate line runs at y=10 — 2 px above the edge.
        let pts = snap_segment(&edges, w, h, 2.0, 10.0, 37.0, 10.0, 5, 50);
        // Midpoint should have snapped to y≈12, not 10.
        let mid = (pts.len() / 2) & !1;
        let snapped_y = pts[mid + 1];
        assert!((snapped_y - 12.0).abs() < 0.5, "snapped y = {snapped_y}");
    }

    #[test]
    fn snap_ignores_edges_outside_threshold() {
        // Weak edge at magnitude 20, threshold 100 — should not snap.
        let w = 20u32;
        let h = 20u32;
        let mut edges = vec![0u8; (w * h) as usize];
        for x in 0..w {
            edges[(12 * w + x) as usize] = 20;
        }
        let pts = snap_segment(&edges, w, h, 2.0, 10.0, 17.0, 10.0, 5, 100);
        for s in (2..pts.len() - 2).step_by(2) {
            assert!((pts[s + 1] - 10.0).abs() < 0.01);
        }
    }

    #[test]
    fn snap_handles_zero_length_segment() {
        let edges = vec![0u8; 10 * 10];
        let pts = snap_segment(&edges, 10, 10, 5.0, 5.0, 5.0, 5.0, 3, 50);
        assert_eq!(pts, vec![5.0, 5.0, 5.0, 5.0]);
    }
}
