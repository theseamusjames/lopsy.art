//! Glyph outline rasterization with a true non-zero fill.
//!
//! zeno (swash's rasterizer) accumulates signed area per pixel and clamps
//! the sum, which is only the non-zero coverage when a pixel is crossed by
//! the edge of a single contour. Where two contours of one glyph overlap —
//! the norm in variable fonts, whose outlines are never merged — and both
//! have an edge in the same pixel, their partial areas add: a top edge at 38%
//! coverage comes out at 76% wherever a second contour shares it (#1806).
//!
//! This rasterizer resolves the winding instead. Each pixel row is sampled at
//! [`SUB_ROWS`] evenly spaced scanlines; on each, the edge crossings are
//! sorted and walked with a winding count, so overlapping contours merge into
//! one span (the union) before any coverage is taken. Each span then adds
//! its exact horizontal coverage to the pixels it touches. Horizontal
//! coverage is exact; vertical coverage is a midpoint sum over the
//! scanlines, exact for edges that cross the whole pixel and within
//! `1 / (2 * SUB_ROWS)` for edges that end inside it.

use swash::zeno::{Command, PathData, Placement, Point, Vector};

/// Scanlines sampled per pixel row.
const SUB_ROWS: usize = 64;
/// Largest distance, in pixels, between a curve and the lines it is
/// flattened to.
const FLATTEN_TOLERANCE: f32 = 0.05;
/// Most lines one curve is flattened to.
const MAX_CURVE_SEGMENTS: usize = 256;

/// A non-horizontal line of the outline in raster space (y down, origin at
/// the image's top-left), stored top to bottom.
struct Edge {
    x0: f32,
    y0: f32,
    y1: f32,
    /// x change per unit of y.
    dxdy: f32,
    /// +1 if the outline runs down this line, -1 if it runs up.
    dir: i32,
}

/// Rasterizes `path` (glyph space, y up) shifted by `offset` with the
/// non-zero fill rule. Returns the alpha mask, one byte per pixel with rows
/// from the top, and its placement: `left` is the x of the first column and
/// `top` the y of the top edge, as zeno reports with `Origin::BottomLeft`.
pub fn rasterize_nonzero(path: impl PathData, offset: Vector) -> (Placement, Vec<u8>) {
    let contours = flatten(path, offset);
    let empty = (Placement { left: 0, top: 0, width: 0, height: 0 }, Vec::new());

    let (mut min_x, mut min_y) = (f32::INFINITY, f32::INFINITY);
    let (mut max_x, mut max_y) = (f32::NEG_INFINITY, f32::NEG_INFINITY);
    for p in contours.iter().flatten() {
        min_x = min_x.min(p.x);
        min_y = min_y.min(p.y);
        max_x = max_x.max(p.x);
        max_y = max_y.max(p.y);
    }
    if !(min_x.is_finite() && min_y.is_finite() && max_x.is_finite() && max_y.is_finite()) {
        return empty;
    }
    let left = min_x.floor();
    let top = max_y.ceil();
    let width = (max_x.ceil() - left) as usize;
    let height = (top - min_y.floor()) as usize;
    if width == 0 || height == 0 {
        return empty;
    }

    // Edges in raster space, bucketed by the pixel row they start in.
    let mut starts: Vec<Vec<Edge>> = (0..height).map(|_| Vec::new()).collect();
    for contour in &contours {
        let n = contour.len();
        for i in 0..n {
            let a = contour[i];
            let b = contour[(i + 1) % n];
            let (ax, ay) = (a.x - left, top - a.y);
            let (bx, by) = (b.x - left, top - b.y);
            if ay == by {
                continue;
            }
            let (dir, x0, y0, x1, y1) = if ay < by { (1, ax, ay, bx, by) } else { (-1, bx, by, ax, ay) };
            let row = (y0.floor().max(0.0) as usize).min(height - 1);
            starts[row].push(Edge { x0, y0, y1, dxdy: (x1 - x0) / (y1 - y0), dir });
        }
    }

    let mut data = vec![0u8; width * height];
    let mut active: Vec<Edge> = Vec::new();
    let mut crossings: Vec<(f32, i32)> = Vec::new();
    // Per pixel row: the partial coverage of the cells span ends fall in,
    // and the change in full coverage from one cell to the next.
    let mut area = vec![0f32; width + 1];
    let mut delta = vec![0f32; width + 1];
    let weight = 1.0 / SUB_ROWS as f32;

    for row in 0..height {
        let row_y = row as f32;
        active.retain(|e| e.y1 > row_y);
        active.append(&mut starts[row]);
        if active.is_empty() {
            continue;
        }
        for sub in 0..SUB_ROWS {
            let y = row_y + (sub as f32 + 0.5) * weight;
            crossings.clear();
            for e in &active {
                if e.y0 <= y && y < e.y1 {
                    crossings.push((e.x0 + (y - e.y0) * e.dxdy, e.dir));
                }
            }
            crossings.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
            let mut winding = 0;
            let mut span_start = 0.0;
            for &(x, dir) in &crossings {
                let was_inside = winding != 0;
                winding += dir;
                if !was_inside && winding != 0 {
                    span_start = x;
                } else if was_inside && winding == 0 {
                    add_span(&mut area, &mut delta, width, span_start, x, weight);
                }
            }
        }
        let out = &mut data[row * width..(row + 1) * width];
        let mut full = 0.0;
        for x in 0..width {
            full += delta[x];
            let coverage = (full + area[x]).clamp(0.0, 1.0);
            out[x] = (coverage * 255.0 + 0.5) as u8;
        }
        area.fill(0.0);
        delta.fill(0.0);
    }

    let placement = Placement { left: left as i32, top: top as i32, width: width as u32, height: height as u32 };
    (placement, data)
}

/// Adds the span `[x0, x1)` of one scanline, weighted by `weight`, to a row.
fn add_span(area: &mut [f32], delta: &mut [f32], width: usize, x0: f32, x1: f32, weight: f32) {
    let x0 = x0.clamp(0.0, width as f32);
    let x1 = x1.clamp(0.0, width as f32);
    if x1 <= x0 {
        return;
    }
    let c0 = x0 as usize;
    let c1 = x1 as usize;
    if c0 == c1 {
        area[c0] += (x1 - x0) * weight;
        return;
    }
    area[c0] += (c0 as f32 + 1.0 - x0) * weight;
    delta[c0 + 1] += weight;
    delta[c1] -= weight;
    area[c1] += (x1 - c1 as f32) * weight;
}

/// The outline's contours as closed polygons, shifted by `offset`.
fn flatten(path: impl PathData, offset: Vector) -> Vec<Vec<Point>> {
    let mut contours: Vec<Vec<Point>> = Vec::new();
    let mut current: Vec<Point> = Vec::new();
    let mut last = Point::ZERO;
    let shift = |p: Point| Point::new(p.x + offset.x, p.y + offset.y);
    let finish = |current: &mut Vec<Point>, contours: &mut Vec<Vec<Point>>| {
        if current.len() > 2 {
            contours.push(std::mem::take(current));
        } else {
            current.clear();
        }
    };
    for command in path.commands() {
        match command {
            Command::MoveTo(p) => {
                finish(&mut current, &mut contours);
                last = shift(p);
                current.push(last);
            }
            Command::LineTo(p) => {
                last = shift(p);
                current.push(last);
            }
            Command::QuadTo(c, p) => {
                let (p0, c, p) = (last, shift(c), shift(p));
                let dd = (p0 - c * 2.0 + p).length();
                let n = segments(dd / 4.0);
                for i in 1..=n {
                    let t = i as f32 / n as f32;
                    let u = 1.0 - t;
                    current.push(p0 * (u * u) + c * (2.0 * u * t) + p * (t * t));
                }
                last = p;
            }
            Command::CurveTo(c1, c2, p) => {
                let (p0, c1, c2, p) = (last, shift(c1), shift(c2), shift(p));
                let dd = (p0 - c1 * 2.0 + c2).length().max((c1 - c2 * 2.0 + p).length());
                let n = segments(dd * 0.75);
                for i in 1..=n {
                    let t = i as f32 / n as f32;
                    let u = 1.0 - t;
                    current.push(
                        p0 * (u * u * u) + c1 * (3.0 * u * u * t) + c2 * (3.0 * u * t * t) + p * (t * t * t),
                    );
                }
                last = p;
            }
            Command::Close => {
                finish(&mut current, &mut contours);
            }
        }
    }
    finish(&mut current, &mut contours);
    contours
}

/// Lines needed so a curve whose deviation bound is `deviation / n²` stays
/// within [`FLATTEN_TOLERANCE`].
fn segments(deviation: f32) -> usize {
    let n = (deviation / FLATTEN_TOLERANCE).sqrt().ceil();
    if n.is_finite() { (n as usize).clamp(1, MAX_CURVE_SEGMENTS) } else { 1 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use swash::zeno::{Mask, Origin};

    /// A closed rectangle path. Every rectangle runs the same way round, so
    /// two that overlap have winding 2 where they meet, like the contours
    /// of a variable font glyph.
    fn rect(cmds: &mut Vec<Command>, x0: f32, y0: f32, x1: f32, y1: f32) {
        cmds.push(Command::MoveTo(Point::new(x0, y0)));
        cmds.push(Command::LineTo(Point::new(x0, y1)));
        cmds.push(Command::LineTo(Point::new(x1, y1)));
        cmds.push(Command::LineTo(Point::new(x1, y0)));
        cmds.push(Command::Close);
    }

    fn pixel(placement: &Placement, data: &[u8], x: i32, y_up_row_top: i32) -> u8 {
        // `y_up_row_top` is the y of the top edge of the pixel row.
        let col = x - placement.left;
        let row = placement.top - y_up_row_top;
        data[(row * placement.width as i32 + col) as usize]
    }

    /// #1806: two same-direction contours overlapping, with their top edges
    /// at the same fractional y, give the union's coverage along that edge —
    /// not the sum of both contours' partial coverage.
    #[test]
    fn overlapping_contours_on_a_shared_fractional_edge_match_one_contour_1806() {
        // Top edge at y = 20.38: the top pixel row (y 20..21) is 38% covered.
        let mut overlapping = Vec::new();
        rect(&mut overlapping, 2.0, 2.0, 30.0, 20.38);
        rect(&mut overlapping, 12.0, 2.0, 40.0, 20.38);
        let mut single = Vec::new();
        rect(&mut single, 2.0, 2.0, 40.0, 20.38);

        let (pa, da) = rasterize_nonzero(&overlapping[..], Vector::ZERO);
        let (pb, db) = rasterize_nonzero(&single[..], Vector::ZERO);
        assert_eq!((pa.left, pa.top, pa.width, pa.height), (pb.left, pb.top, pb.width, pb.height));
        let edge: Vec<u8> = (3..39).map(|x| pixel(&pa, &da, x, 21)).collect();
        assert!(
            edge.iter().all(|&c| (c as i32 - 97).abs() <= 2),
            "top edge row should be a flat ~38% (97), got {edge:?}",
        );
        assert_eq!(da, db, "overlapping contours must rasterize like their union");
    }

    /// The same for a shared vertical edge at a fractional x, and for a
    /// sub-pixel offset applied to both.
    #[test]
    fn overlapping_contours_on_a_shared_vertical_edge_match_one_contour_1806() {
        let mut overlapping = Vec::new();
        rect(&mut overlapping, 2.0, 2.0, 30.6, 20.0);
        rect(&mut overlapping, 2.0, 8.0, 30.6, 26.0);
        let mut single = Vec::new();
        rect(&mut single, 2.0, 2.0, 30.6, 26.0);
        let offset = Vector::new(0.25, 0.5);
        let (pa, da) = rasterize_nonzero(&overlapping[..], offset);
        let (pb, db) = rasterize_nonzero(&single[..], offset);
        assert_eq!((pa.left, pa.top, pa.width, pa.height), (pb.left, pb.top, pb.width, pb.height));
        assert_eq!(da, db);
        // x 30.85 → the column x = 30 is 85% covered.
        let c = pixel(&pa, &da, 30, 15);
        assert!((c as i32 - 217).abs() <= 1, "right edge column should be ~85%, got {c}");
    }

    /// Opposite-direction contours (a counter) still cut a hole.
    #[test]
    fn a_reversed_inner_contour_is_a_hole() {
        let mut cmds = Vec::new();
        rect(&mut cmds, 0.0, 0.0, 20.0, 20.0);
        cmds.push(Command::MoveTo(Point::new(5.0, 5.0)));
        cmds.push(Command::LineTo(Point::new(15.0, 5.0)));
        cmds.push(Command::LineTo(Point::new(15.0, 15.0)));
        cmds.push(Command::LineTo(Point::new(5.0, 15.0)));
        cmds.push(Command::Close);
        let (p, d) = rasterize_nonzero(&cmds[..], Vector::ZERO);
        assert_eq!(pixel(&p, &d, 10, 11), 0);
        assert_eq!(pixel(&p, &d, 2, 11), 255);
    }

    /// For an outline without overlaps — diagonals, near-horizontal and
    /// fractional edges — the result matches zeno's exact-area coverage to within the
    /// scanline sampling error, at the same placement.
    #[test]
    fn matches_zeno_on_a_single_contour() {
        // Straight lines only, so both rasterizers see the same geometry
        // (zeno flattens curves more coarsely): a polygonal disc, then a
        // sliver of a triangle with near-horizontal and steep edges.
        let mut cmds = Vec::new();
        for i in 0..48 {
            let a = i as f32 / 48.0 * std::f32::consts::TAU;
            let p = Point::new(17.3 + 14.2 * a.cos(), 16.1 + 13.7 * a.sin());
            cmds.push(if i == 0 { Command::MoveTo(p) } else { Command::LineTo(p) });
        }
        cmds.push(Command::Close);
        cmds.push(Command::MoveTo(Point::new(35.2, 1.4)));
        cmds.push(Command::LineTo(Point::new(70.9, 3.1)));
        cmds.push(Command::LineTo(Point::new(36.1, 29.6)));
        cmds.push(Command::Close);
        let offset = Vector::new(0.375, 0.625);
        let (p, d) = rasterize_nonzero(&cmds[..], offset);
        let mut zeno = vec![0u8; 0];
        let zp = Mask::new(&cmds[..])
            .origin(Origin::BottomLeft)
            .render_offset(offset)
            .inspect(|_, w, h| zeno.resize((w * h) as usize, 0))
            .render_into(&mut zeno[..], None);
        let mut worst = 0;
        for zy in 0..zp.height as i32 {
            for zx in 0..zp.width as i32 {
                let z = zeno[(zy * zp.width as i32 + zx) as usize] as i32;
                let (x, top) = (zp.left + zx, zp.top - zy);
                let col = x - p.left;
                let row = p.top - top;
                let ours = if col >= 0 && row >= 0 && col < p.width as i32 && row < p.height as i32 {
                    d[(row * p.width as i32 + col) as usize] as i32
                } else {
                    0
                };
                worst = worst.max((ours - z).abs());
            }
        }
        assert!(worst <= 3, "differs from zeno by up to {worst} levels");
    }
}
