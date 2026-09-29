//! Growth policy for a live float's buffer.
//!
//! A scale-up or rotate drag grows the float a little on almost every
//! pointer-move. Growing to exactly the requested rect reallocated three
//! full-size textures per move, and every one of those sizes was new, so the
//! released textures piled up in the pool (#1019). Once an axis has to grow,
//! it grows by at least a quarter of its current extent, which turns a drag
//! into O(log n) reallocations.

use crate::geometry::Rect;

/// Once an axis grows, its new extent is at least `len + len / MIN_GROWTH_DIVISOR`.
pub const MIN_GROWTH_DIVISOR: i64 = 4;

/// Grow the span `[start, start + len)` so it also covers
/// `[req_start, req_start + req_len)`. Returns the span unchanged when it
/// already covers the request. Otherwise the new length is at least
/// `len * 5/4` (capped at `max_len` unless the request alone needs more),
/// and the slack goes to the side(s) that had to grow.
pub fn grow_span(start: i32, len: u32, req_start: i32, req_len: u32, max_len: u32) -> (i32, u32) {
    let start = i64::from(start);
    let end = start + i64::from(len);
    let req_start = i64::from(req_start);
    let req_end = req_start + i64::from(req_len);
    let need_start = start.min(req_start);
    let need_end = end.max(req_end);
    if need_start == start && need_end == end {
        return (start as i32, len);
    }

    let need_len = need_end - need_start;
    let geometric = i64::from(len) + i64::from(len) / MIN_GROWTH_DIVISOR;
    let target = geometric.min(i64::from(max_len)).max(need_len);
    let slack = target - need_len;
    let grows_start = need_start < start;
    let grows_end = need_end > end;
    let before = match (grows_start, grows_end) {
        (true, true) => slack / 2,
        (true, false) => slack,
        _ => 0,
    };
    ((need_start - before) as i32, target as u32)
}

/// Grow `current` so it covers `requested` as well, per axis with
/// [`grow_span`]. Returns `None` when `current` already covers `requested`.
pub fn grow_rect_to_cover(current: Rect, requested: Rect, max_len: u32) -> Option<Rect> {
    let (x, width) = grow_span(current.x, current.width, requested.x, requested.width, max_len);
    let (y, height) = grow_span(current.y, current.height, requested.y, requested.height, max_len);
    let grown = Rect { x, y, width, height };
    if grown == current { None } else { Some(grown) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect { x, y, width, height }
    }

    #[test]
    fn covered_request_does_not_grow() {
        assert_eq!(grow_rect_to_cover(rect(0, 0, 400, 300), rect(10, 10, 100, 100), 16384), None);
        assert_eq!(grow_rect_to_cover(rect(0, 0, 400, 300), rect(0, 0, 400, 300), 16384), None);
    }

    #[test]
    fn growing_one_side_puts_the_slack_on_that_side() {
        // Needs 0..410; the quarter-extent minimum makes it 0..500.
        assert_eq!(grow_span(0, 400, 0, 410, 16384), (0, 500));
        // Needs -10..400; the slack goes left.
        assert_eq!(grow_span(0, 400, -10, 410, 16384), (-100, 500));
    }

    #[test]
    fn growing_both_sides_splits_the_slack() {
        // Needs -10..410 (420); target 500 → 40 slack each side.
        assert_eq!(grow_span(0, 400, -10, 420, 16384), (-50, 500));
    }

    #[test]
    fn a_request_bigger_than_the_minimum_is_met_exactly() {
        assert_eq!(grow_span(0, 400, 0, 1000, 16384), (0, 1000));
    }

    #[test]
    fn the_minimum_is_capped_at_the_texture_limit() {
        assert_eq!(grow_span(0, 4000, 0, 4010, 4096), (0, 4096));
        // A request past the limit is still returned as-is; the texture
        // pool rejects it, as before.
        assert_eq!(grow_span(0, 4000, 0, 5000, 4096), (0, 5000));
    }

    #[test]
    fn an_unchanged_axis_keeps_its_extent() {
        let grown = grow_rect_to_cover(rect(0, 0, 400, 300), rect(0, 0, 410, 300), 16384).unwrap();
        assert_eq!(grown, rect(0, 0, 500, 300));
    }

    #[test]
    fn the_result_always_covers_both_rects() {
        let current = rect(-37, 12, 999, 777);
        for &req in &[rect(-500, -500, 10, 10), rect(900, 700, 300, 300), rect(-40, 10, 1100, 780)] {
            let g = grow_rect_to_cover(current, req, 16384).unwrap();
            for r in [current, req] {
                assert!(g.x <= r.x && g.y <= r.y);
                assert!(g.x + g.width as i32 >= r.x + r.width as i32);
                assert!(g.y + g.height as i32 >= r.y + r.height as i32);
            }
        }
    }

    /// A 30-step drag that pushes the content 1px further every step (the
    /// worst case for exact growth: 30 reallocations) grows only a handful
    /// of times.
    #[test]
    fn a_steady_outward_drag_grows_logarithmically() {
        let mut current = rect(0, 0, 2048, 2048);
        let mut growths = 0;
        for step in 1..=30u32 {
            let req = rect(0, 0, 2048 + step * 40, 2048 + step * 40);
            if let Some(g) = grow_rect_to_cover(current, req, 16384) {
                current = g;
                growths += 1;
            }
        }
        // 2048 → 3248 needs 2048·1.25^n ≥ 3248 → n = 3.
        assert_eq!(growths, 3);
        assert!(current.width >= 3248 && current.height >= 3248);
    }
}
