//! A RAW frame rendered smaller than its own size, band by band, for a
//! device whose largest texture is smaller than the frame: linear camera
//! RGB (or a format's finished look) reduced by area (`area_resample`), at
//! any scale, without the whole frame ever being held at its own size.
//!
//! The reduced frame is cut into bands of destination rows, or of
//! destination columns when the orientation turns the frame a quarter (a
//! band of plane rows is then a band of columns of the oriented frame).
//! Each band renders the plane rows its destination pixels read, with the
//! format's own band renderer, unchanged, and reduces them. Neighbouring
//! bands share a source row or column at their edge, which each renders;
//! the reduction gives every destination pixel the same weights whatever
//! band it is in, so the result is the whole frame reduced, bit for bit.

use super::{RawBand, RawBandPixels, RawFormat};
use crate::area_resample::{AreaScale, PixelRect};

/// A band of the reduced frame: plane rows to render (`band`), and the
/// destination rows (or columns, `is_columns`) `[d0, d1)` they make.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScaledBand {
    pub band: RawBand,
    pub d0: u32,
    pub d1: u32,
}

/// Bands of the reduced frame are never shorter than this, so the halo
/// rows each renders stay a modest share of its work.
const MIN_BAND_LENGTH: u32 = 64;

/// Where a band of plane rows lands in the oriented frame.
struct Layout {
    /// The bands are columns of the oriented frame (orientations 5 to 8).
    is_columns: bool,
    /// Plane row 0 is the last row (or column) of the oriented frame.
    is_reversed: bool,
    plane_height: u32,
    scale: AreaScale,
}

fn layout<F: RawFormat>(p: &F::Params, dst_width: u32, dst_height: u32) -> Result<Layout, String> {
    let (width, height) = F::oriented_size(p);
    let orientation = F::orientation(p);
    Ok(Layout {
        is_columns: (5..=8).contains(&orientation),
        // As each format's `orient_band` places a band: 3 and 4 from the bottom, 6 and 7 from the right.
        is_reversed: matches!(orientation, 3 | 4 | 6 | 7),
        plane_height: F::plane_height(p),
        scale: AreaScale::new(width, height, dst_width, dst_height)?,
    })
}

impl Layout {
    /// The destination's length along the bands' axis.
    fn length(&self) -> u32 {
        let (w, h) = self.scale.dst_size();
        if self.is_columns { w } else { h }
    }

    /// The plane rows destination rows (or columns) `[d0, d1)` read.
    fn plane_rows(&self, d0: u32, d1: u32) -> (u32, u32) {
        let (s0, s1) = if self.is_columns { self.scale.source_columns(d0, d1) } else { self.scale.source_rows(d0, d1) };
        if self.is_reversed { (self.plane_height - s1, self.plane_height - s0) } else { (s0, s1) }
    }

    fn destination(&self, d0: u32, d1: u32) -> PixelRect {
        let (w, h) = self.scale.dst_size();
        if self.is_columns { PixelRect::new(d0, 0, d1 - d0, h) } else { PixelRect::new(0, d0, w, d1 - d0) }
    }
}

/// At most `max_bands` bands of near-equal length that together make the
/// frame reduced to `dst_width`×`dst_height`.
pub fn plan<F: RawFormat>(p: &F::Params, dst_width: u32, dst_height: u32, max_bands: u32) -> Result<Vec<ScaledBand>, String> {
    let layout = layout::<F>(p, dst_width, dst_height)?;
    let length = layout.length();
    let count = max_bands.clamp(1, (length / MIN_BAND_LENGTH).max(1));
    Ok((0..count)
        .map(|i| {
            let d0 = length * i / count;
            let d1 = length * (i + 1) / count;
            let (y0, y1) = layout.plane_rows(d0, d1);
            ScaledBand { band: F::band_for_rows(p, y0, y1), d0, d1 }
        })
        .collect())
}

/// One band of the reduced frame: `src` holds plane rows
/// `[band.src_y0, band.src_y1)`, rendered as linear camera RGB
/// (`render_linear_band`), or with `linear` false as the format's finished
/// look (`render_finished_band`, for a format that has one); the result is
/// placed in the reduced frame.
pub fn render<F: RawFormat>(src: &[f32], p: &F::Params, scaled: ScaledBand, dst_width: u32, dst_height: u32, linear: bool) -> Result<RawBandPixels, String> {
    let layout = layout::<F>(p, dst_width, dst_height)?;
    if scaled.d0 >= scaled.d1 || scaled.d1 > layout.length() {
        return Err(format!("destination band {}..{} is outside the reduced frame", scaled.d0, scaled.d1));
    }
    let rendered = if linear {
        F::render_linear_band(src, p, scaled.band)?
    } else {
        F::render_finished_band(src, p, scaled.band).ok_or_else(|| format!("{} has no finished bands", F::ID.as_str().to_uppercase()))??
    };
    let source = PixelRect::new(rendered.x, rendered.y, rendered.width, rendered.height);
    let dst = layout.destination(scaled.d0, scaled.d1);
    let pixels = layout.scale.reduce(&rendered.pixels, source, dst)?;
    Ok(RawBandPixels { x: dst.x, y: dst.y, width: dst.width, height: dst.height, pixels })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dng::linear::{DngKind, PlaneLayout, PlaneParams};
    use crate::raf::RafBandPixels;
    use crate::raw::{OpeningLook, RawDescription, RawFormatId, RawPlane, RawWhite};
    use serde::{Deserialize, Serialize};

    /// A plane of this size and orientation: a Bayer mosaic, or linear RGB.
    #[derive(Clone, Copy, Serialize, Deserialize)]
    struct TestPlane {
        width: u32,
        height: u32,
        orientation: u16,
        is_bayer: bool,
    }

    impl PlaneParams for TestPlane {
        fn layout(&self) -> PlaneLayout {
            let (kind, samples_per_pixel) = if self.is_bayer { (DngKind::Bayer, 1) } else { (DngKind::Linear, 3) };
            PlaneLayout { width: self.width, height: self.height, kind, samples_per_pixel, cfa: [0, 1, 1, 2], orientation: self.orientation }
        }
    }

    /// A format over a synthetic plane whose renders are the DNG decode's own
    /// (`dng::linear`), to test the planning in every orientation without a file.
    struct Plane;

    impl RawFormat for Plane {
        const ID: RawFormatId = RawFormatId::Dng;
        type Params = TestPlane;

        fn prepare(_: &[u8], _: &OpeningLook) -> Result<RawPlane<TestPlane>, String> {
            Err("not a file format".into())
        }
        fn describe(_: &[u8], _: &RawPlane<TestPlane>, _: &OpeningLook) -> Result<RawDescription, String> {
            Err("not a file format".into())
        }
        fn plane_height(p: &TestPlane) -> u32 {
            p.height
        }
        fn orientation(p: &TestPlane) -> u16 {
            p.orientation
        }
        fn oriented_size(p: &TestPlane) -> (u32, u32) {
            p.layout().oriented_size()
        }
        fn render_linear_band(src: &[f32], p: &TestPlane, band: RawBand) -> Result<RafBandPixels, String> {
            crate::dng::linear::render_linear_band(src, p, band)
        }
        fn render_binned_linear(_: &[f32], _: &TestPlane, _: u32) -> Result<(u32, u32, Vec<f32>), String> {
            Err("not used".into())
        }
        fn white_for_recipe(_: &TestPlane, temperature: f32, tint: f32) -> Result<RawWhite, String> {
            Ok(crate::raw::white_balance::fixed_white(temperature, tint))
        }
        fn temperature_for_kelvin(_: &TestPlane, _: f32, _: f32) -> Result<f32, String> {
            Err("not used".into())
        }
    }

    fn plane(p: &TestPlane) -> Vec<f32> {
        (0..p.width * p.height * p.layout().samples_per_pixel).map(|i| (i.wrapping_mul(2_654_435_761) >> 8) as f32 / 16_777_216.0 + (i % 7) as f32 * 0.25).collect()
    }

    /// The frame reduced through the bands, put together.
    fn through_bands(plane: &[f32], p: &TestPlane, dst: (u32, u32), max_bands: u32) -> Vec<f32> {
        let row = (p.width * p.layout().samples_per_pixel) as usize;
        let mut out = vec![f32::NAN; (dst.0 * dst.1 * 4) as usize];
        let bands = plan::<Plane>(p, dst.0, dst.1, max_bands).unwrap();
        assert!(bands.len() > 1, "{bands:?}");
        for b in bands {
            let src = &plane[b.band.src_y0 as usize * row..b.band.src_y1 as usize * row];
            let px = render::<Plane>(src, p, b, dst.0, dst.1, true).unwrap();
            for y in 0..px.height {
                let at = ((px.y + y) * dst.0 + px.x) as usize * 4;
                out[at..at + px.width as usize * 4].copy_from_slice(&px.pixels[(y * px.width) as usize * 4..][..px.width as usize * 4]);
            }
        }
        out
    }

    /// The whole frame rendered at its own size, then reduced whole.
    fn whole(plane: &[f32], p: &TestPlane, dst: (u32, u32)) -> Vec<f32> {
        let all = crate::dng::linear::render_linear_band(plane, p, RawBand { y0: 0, y1: p.height, src_y0: 0, src_y1: p.height }).unwrap();
        let scale = AreaScale::new(all.width, all.height, dst.0, dst.1).unwrap();
        scale.reduce(&all.pixels, PixelRect::new(0, 0, all.width, all.height), PixelRect::new(0, 0, dst.0, dst.1)).unwrap()
    }

    #[test]
    fn bands_of_the_reduced_frame_are_the_whole_frame_reduced_in_every_orientation() {
        for is_bayer in [false, true] {
            for orientation in 1..=8 {
                let p = TestPlane { width: 302, height: 518, orientation, is_bayer };
                let data = plane(&p);
                let (ow, oh) = p.layout().oriented_size();
                let dst = (ow * 5 / 7, oh * 5 / 7);
                let bands = through_bands(&data, &p, dst, 6);
                let reference = whole(&data, &p, dst);
                assert!(bands.iter().zip(&reference).all(|(a, b)| a.to_bits() == b.to_bits()), "Bayer {is_bayer}, orientation {orientation}");
            }
        }
    }

    #[test]
    fn the_bands_cover_the_reduced_frame_once_and_start_on_the_mosaic_period() {
        let p = TestPlane { width: 8368, height: 5584, orientation: 1, is_bayer: true };
        let bands = plan::<Plane>(&p, 8192, 5467, 16).unwrap();
        assert_eq!(bands.len(), 16);
        assert_eq!(bands.first().map(|b| b.d0), Some(0));
        assert_eq!(bands.last().map(|b| b.d1), Some(5467));
        for pair in bands.windows(2) {
            assert_eq!(pair[0].d1, pair[1].d0);
        }
        for b in &bands {
            assert_eq!(b.band.src_y0 % 6, 0, "{b:?}");
            assert!(b.band.src_y1 <= 5584);
        }
    }
}
