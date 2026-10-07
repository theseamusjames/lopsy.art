//! Texel rectangles for scissoring round-dab passes (#1219).
//!
//! The retouch tools (Clone Stamp, Healing Brush, Smudge, Dodge / Burn,
//! Sponge) draw each dab as a full-texture quad whose shader passes every
//! texel farther than `size / 2` from the dab centre through unchanged (or
//! discards it). Limiting the dab pass, its copy-back and the end-of-stroke
//! bake to these rects is therefore pixel-identical to the full-texture
//! passes, at the cost of the dab's area instead of the layer's.

use crate::brush::circle_dab_scissor_rect;
use crate::geometry::Rect;

/// Texel rect (clamped to a `tex_w`×`tex_h` texture) bounding every texel a
/// round dab of diameter `size` centred at (cx, cy) can change, or `None`
/// when the dab misses the texture.
pub fn dab_rect(cx: f32, cy: f32, size: f32, tex_w: u32, tex_h: u32) -> Option<Rect> {
    circle_dab_scissor_rect(cx, cy, size, tex_w, tex_h)
        .map(|[x, y, w, h]| Rect::new(x, y, w as u32, h as u32))
}

/// Bounds of every dab in a flat `[x0, y0, x1, y1, …]` point list. A
/// trailing odd coordinate is ignored, as the dab loops ignore it.
pub fn dab_batch_rect(points: &[f64], size: f32, tex_w: u32, tex_h: u32) -> Option<Rect> {
    points
        .chunks_exact(2)
        .filter_map(|p| dab_rect(p[0] as f32, p[1] as f32, size, tex_w, tex_h))
        .reduce(|a, b| a.union(&b))
}

/// Union of two optional rects; `None` is the empty rect.
pub fn union_rects(a: Option<Rect>, b: Option<Rect>) -> Option<Rect> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.union(&b)),
        (a, None) => a,
        (None, b) => b,
    }
}

/// A growing region of texels touched since it was last taken.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct DirtyRect(Option<Rect>);

impl DirtyRect {
    pub fn add(&mut self, rect: Option<Rect>) {
        self.0 = union_rects(self.0, rect);
    }

    pub fn get(&self) -> Option<Rect> {
        self.0
    }

    pub fn take(&mut self) -> Option<Rect> {
        self.0.take()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dab_rect_matches_circle_scissor_rect() {
        assert_eq!(
            dab_rect(50.0, 40.0, 20.0, 200, 100),
            Some(Rect::new(38, 28, 24, 24))
        );
    }

    #[test]
    fn dab_rect_is_clamped_to_the_texture() {
        assert_eq!(
            dab_rect(2.0, 3.0, 20.0, 200, 100),
            Some(Rect::new(0, 0, 14, 15))
        );
        assert_eq!(
            dab_rect(199.5, 99.5, 20.0, 200, 100),
            Some(Rect::new(187, 87, 13, 13))
        );
    }

    #[test]
    fn dab_rect_is_none_when_the_dab_misses_the_texture() {
        assert_eq!(dab_rect(-40.0, 50.0, 20.0, 200, 100), None);
        assert_eq!(dab_rect(50.0, 50.0, 0.0, 200, 100), None);
        assert_eq!(dab_rect(f32::NAN, 50.0, 20.0, 200, 100), None);
    }

    #[test]
    fn a_100px_dab_on_a_4k_layer_is_a_tiny_fraction_of_the_texture() {
        let r = dab_rect(2000.0, 2000.0, 100.0, 4096, 4096).unwrap();
        assert_eq!((r.width, r.height), (104, 104));
        assert!((r.width as u64 * r.height as u64) * 1000 < 4096 * 4096);
    }

    #[test]
    fn batch_rect_unions_every_dab() {
        let r = dab_batch_rect(&[10.0, 10.0, 100.0, 60.0, 50.0, 90.0], 10.0, 200, 100).unwrap();
        assert_eq!(r, Rect::new(3, 3, 104, 94));
    }

    #[test]
    fn batch_rect_skips_dabs_outside_the_texture_and_odd_tails() {
        assert_eq!(
            dab_batch_rect(&[-50.0, -50.0, 20.0, 20.0, 7.0], 10.0, 200, 100),
            dab_rect(20.0, 20.0, 10.0, 200, 100),
        );
        assert_eq!(dab_batch_rect(&[-50.0, -50.0], 10.0, 200, 100), None);
        assert_eq!(dab_batch_rect(&[], 10.0, 200, 100), None);
    }

    #[test]
    fn union_rects_treats_none_as_empty() {
        let a = Rect::new(0, 0, 10, 10);
        let b = Rect::new(20, 5, 5, 20);
        assert_eq!(union_rects(None, None), None);
        assert_eq!(union_rects(Some(a), None), Some(a));
        assert_eq!(union_rects(None, Some(b)), Some(b));
        assert_eq!(union_rects(Some(a), Some(b)), Some(Rect::new(0, 0, 25, 25)));
    }

    #[test]
    fn dirty_rect_accumulates_until_taken() {
        let mut d = DirtyRect::default();
        assert_eq!(d.get(), None);
        d.add(Some(Rect::new(5, 5, 10, 10)));
        d.add(None);
        d.add(Some(Rect::new(0, 12, 4, 4)));
        assert_eq!(d.get(), Some(Rect::new(0, 5, 15, 11)));
        assert_eq!(d.take(), Some(Rect::new(0, 5, 15, 11)));
        assert_eq!(d.get(), None);
    }

    /// Every texel the dab shaders can change (texel centre within the
    /// radius) lies inside the batch rect.
    #[test]
    fn batch_rect_covers_every_touched_texel() {
        let (tw, th) = (64u32, 48u32);
        let points = [3.2f64, 4.7, 30.5, 20.0, 63.9, 47.9, -2.0, 24.0];
        let size = 9.5f32;
        let r = dab_batch_rect(&points, size, tw, th).unwrap();
        for p in points.chunks_exact(2) {
            for py in 0..th as i32 {
                for px in 0..tw as i32 {
                    let dx = px as f32 + 0.5 - p[0] as f32;
                    let dy = py as f32 + 0.5 - p[1] as f32;
                    if (dx * dx + dy * dy).sqrt() > size * 0.5 {
                        continue;
                    }
                    assert!(r.contains(px, py), "texel ({px},{py}) outside {r:?}");
                }
            }
        }
    }
}
