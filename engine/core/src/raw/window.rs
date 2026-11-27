//! A window of a RAW frame at its own size, band by band: the bands of plane
//! rows that render only the part of the oriented frame a window needs, for
//! a picture larger than the GPU's textures rendered one tile at a time.
//!
//! A band of plane rows is a band of rows of the oriented frame, or of
//! columns when the orientation turns the frame a quarter (5 to 8), as in
//! `scaled`. The window's extent along that axis, mapped back to plane rows,
//! is cut into bands of near-equal length, each widened to what the format's
//! renders need (`band_for_rows`). Each band is rendered by the format's own
//! band renderer, unchanged, so its pixels are the same rows of the whole
//! frame bit for bit; the rows (or columns) a band renders past the window
//! are left out where it is uploaded.

use super::scaled::MIN_BAND_LENGTH;
use super::{RawBand, RawFormat};

/// At most `max_bands` bands of plane rows that together render every pixel
/// of `window` (x, y, width, height in the oriented frame), and as few
/// others as the format's renders allow.
pub fn plan<F: RawFormat>(p: &F::Params, window: (u32, u32, u32, u32), max_bands: u32) -> Result<Vec<RawBand>, String> {
    let (x, y, width, height) = window;
    let (frame_width, frame_height) = F::oriented_size(p);
    let inside = |at: u32, side: u32, whole: u32| side > 0 && u64::from(at) + u64::from(side) <= u64::from(whole);
    if !inside(x, width, frame_width) || !inside(y, height, frame_height) {
        return Err(format!("A {width}×{height} window at ({x}, {y}) leaves the {frame_width}×{frame_height} frame"));
    }
    let orientation = F::orientation(p);
    let is_columns = (5..=8).contains(&orientation);
    // As each format's `orient_band` places a band: 3 and 4 from the bottom, 6 and 7 from the right.
    let is_reversed = matches!(orientation, 3 | 4 | 6 | 7);
    let plane_height = F::plane_height(p);
    let (a0, a1) = if is_columns { (x, x + width) } else { (y, y + height) };
    if a1 > plane_height {
        return Err(format!("The window reaches row {a1} of a plane {plane_height} rows high"));
    }
    let (s0, s1) = if is_reversed { (plane_height - a1, plane_height - a0) } else { (a0, a1) };
    let length = s1 - s0;
    let count = max_bands.clamp(1, (length / MIN_BAND_LENGTH).max(1));
    Ok((0..count)
        .map(|i| {
            let r0 = s0 + length * i / count;
            let r1 = s0 + length * (i + 1) / count;
            F::band_for_rows(p, r0, r1)
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dng::linear::PlaneParams;
    use crate::raw::scaled::tests::{plane, Plane, TestPlane};
    use crate::raw::RawBand;

    /// `window` of the frame put together from the planned bands, each band
    /// clipped to it as the window upload clips it.
    fn through_bands(data: &[f32], p: &TestPlane, window: (u32, u32, u32, u32), max_bands: u32) -> (Vec<f32>, usize) {
        let (wx, wy, ww, wh) = window;
        let row = (p.width * p.layout().samples_per_pixel) as usize;
        let mut out = vec![f32::NAN; (ww * wh * 4) as usize];
        let bands = plan::<Plane>(p, window, max_bands).unwrap();
        for b in &bands {
            let src = &data[b.src_y0 as usize * row..b.src_y1 as usize * row];
            let px = Plane::render_linear_band(src, p, *b).unwrap();
            for y in px.y.max(wy)..(px.y + px.height).min(wy + wh) {
                for x in px.x.max(wx)..(px.x + px.width).min(wx + ww) {
                    let from = (((y - px.y) * px.width + x - px.x) * 4) as usize;
                    let at = (((y - wy) * ww + x - wx) * 4) as usize;
                    out[at..at + 4].copy_from_slice(&px.pixels[from..from + 4]);
                }
            }
        }
        (out, bands.len())
    }

    /// The same window cut from the whole frame rendered at once.
    fn whole(data: &[f32], p: &TestPlane, window: (u32, u32, u32, u32)) -> Vec<f32> {
        let (wx, wy, ww, wh) = window;
        let all = Plane::render_linear_band(data, p, RawBand { y0: 0, y1: p.height, src_y0: 0, src_y1: p.height }).unwrap();
        let mut out = Vec::with_capacity((ww * wh * 4) as usize);
        for y in wy..wy + wh {
            let at = ((y * all.width + wx) * 4) as usize;
            out.extend_from_slice(&all.pixels[at..at + (ww * 4) as usize]);
        }
        out
    }

    #[test]
    fn a_window_through_its_bands_is_that_window_of_the_whole_frame_in_every_orientation() {
        for is_bayer in [false, true] {
            for orientation in 1..=8 {
                let p = TestPlane { width: 302, height: 518, orientation, is_bayer };
                let data = plane(&p);
                let (ow, oh) = p.layout().oriented_size();
                for window in [(0, 0, ow, oh), (37, 101, ow / 3, oh / 4), (ow - 70, oh - 90, 70, 90), (5, oh / 2, ow - 9, 1)] {
                    let (got, count) = through_bands(&data, &p, window, 4);
                    let reference = whole(&data, &p, window);
                    assert!(count >= 1);
                    assert!(
                        got.iter().zip(&reference).all(|(a, b)| a.to_bits() == b.to_bits()),
                        "Bayer {is_bayer}, orientation {orientation}, window {window:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn a_window_renders_little_more_of_the_plane_than_it_needs() {
        // Bands of a third of the frame's rows render that third and their halos, not the frame.
        let p = TestPlane { width: 8368, height: 5584, orientation: 1, is_bayer: true };
        let bands = plan::<Plane>(&p, (0, 2000, 8368, 1800), 8).unwrap();
        assert_eq!(bands.len(), 8);
        let rendered: u32 = bands.iter().map(|b| b.src_y1 - b.src_y0).sum();
        assert!(rendered < 1800 + 8 * 64, "{rendered} rows for 1800");
        assert!(bands.iter().all(|b| b.src_y0 >= 1900 && b.src_y1 <= 3900), "{bands:?}");
        // Turned a quarter, a window's columns are the plane's rows, counted from the right for 6.
        let turned = TestPlane { orientation: 6, ..p };
        let bands = plan::<Plane>(&turned, (0, 0, 1000, 8368), 2).unwrap();
        assert!(bands.iter().all(|b| b.y0 >= 5584 - 1000 - 6 && b.y1 <= 5584), "{bands:?}");
    }

    #[test]
    fn a_window_outside_the_frame_is_refused() {
        let p = TestPlane { width: 302, height: 518, orientation: 1, is_bayer: true };
        assert!(plan::<Plane>(&p, (300, 0, 3, 10), 2).is_err());
        assert!(plan::<Plane>(&p, (0, 0, 0, 10), 2).is_err());
    }
}
