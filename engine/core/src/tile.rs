//! Tiles: a document that is one rectangle of a larger picture, rendered so
//! that the rectangles assemble into what one render of the whole gives.
//!
//! A [`Region`] says where the document lies in the whole picture. The
//! stages that depend on where a pixel is (the area masks, Finish's
//! vignette and grain, the output step's dither) evaluate at the pixel plus
//! the region's origin, in a picture of the whole's size. The blurs that go
//! through a smaller image (`detail::blur_reach`) build it on the whole
//! picture's grid: low texel `k` averages whole pixels `[k·F, (k+1)·F)` with
//! `F = W / lw` and `lw = pyramid_size(W, f)` of the whole, so a tile's low
//! texels are the whole's own wherever their pixels are in the tile.
//!
//! Every stage clamps at its texture's edge, which is right at an edge of
//! the picture and wrong at a tile's edge inside it. So a tile is rendered
//! with an apron of real pixels around the part that is kept, as wide as
//! the reaches of the neighbourhood stages that run added up; where a tile
//! touches the picture's edge it ends there.

use crate::geometry::Rect;

/// The largest picture side a region may name: every coordinate is passed
/// to the shaders as an f32, which holds whole numbers exactly up to 2^24.
pub const MAX_WHOLE_SIDE: u32 = 1 << 24;

/// Where a document lies in the whole picture it is a rectangle of: its
/// top-left pixel (`x`, `y`) and the whole picture's size, all in
/// whole-document pixels (after the crop).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub whole_width: u32,
    pub whole_height: u32,
}

impl Region {
    /// The region of a `width`×`height` document at (`x`, `y`) in a
    /// `whole_width`×`whole_height` picture. Fails when the document leaves
    /// the picture or a size is 0 or over `MAX_WHOLE_SIDE`.
    pub fn new(x: u32, y: u32, whole_width: u32, whole_height: u32, width: u32, height: u32) -> Result<Self, String> {
        if whole_width == 0 || whole_height == 0 || whole_width > MAX_WHOLE_SIDE || whole_height > MAX_WHOLE_SIDE {
            return Err(format!("A whole picture of {whole_width}×{whole_height} cannot hold a region"));
        }
        let fits = |at: u32, side: u32, whole: u32| side > 0 && u64::from(at) + u64::from(side) <= u64::from(whole);
        if !fits(x, width, whole_width) || !fits(y, height, whole_height) {
            return Err(format!(
                "A {width}×{height} document at ({x}, {y}) leaves the {whole_width}×{whole_height} picture"
            ));
        }
        Ok(Region { x, y, whole_width, whole_height })
    }

    /// The shaders' `u_region`: (x, y, whole width, whole height). The
    /// shaders read a whole width above 0 as "a region is set"; all zeros,
    /// [`NO_REGION`], is none.
    pub fn uniform(&self) -> [f32; 4] {
        [self.x as f32, self.y as f32, self.whole_width as f32, self.whole_height as f32]
    }
}

/// The pixel of the whole picture that a document's pixel (`x`, `y`) is,
/// as the point at its centre: what the position-dependent stages and
/// their CPU references evaluate at. Without a region, the pixel itself.
pub fn whole_point(region: Option<Region>, x: usize, y: usize) -> (f32, f32) {
    let (ox, oy) = region.map_or((0, 0), |r| (r.x as usize, r.y as usize));
    ((x + ox) as f32 + 0.5, (y + oy) as f32 + 0.5)
}

/// `u_region` with no region: the shaders do today's arithmetic.
pub const NO_REGION: [f32; 4] = [0.0; 4];

/// The `u_region` of `region`, or [`NO_REGION`].
pub fn region_uniform(region: Option<Region>) -> [f32; 4] {
    region.map_or(NO_REGION, |r| r.uniform())
}

/// On one axis, the low texels of a whole picture's blur image (`low`
/// texels for `whole` pixels, `pyramid_size(whole, f)`) that a tile of
/// `extent` pixels from `start` builds: every texel whose footprint
/// `[k·W/lw, (k+1)·W/lw)` meets the tile, and one more either side, within
/// `0..low`. Inclusive. Texels whose footprint is wholly inside the tile
/// (or reaches the picture's edge with it) are the whole's own; the ones at
/// the ends may not be, and lie within the apron.
pub fn low_range(start: u32, extent: u32, whole: u32, low: u32) -> (u32, u32) {
    let (start, end, whole, low) = (u64::from(start), u64::from(start) + u64::from(extent), u64::from(whole), u64::from(low));
    // floor(start / F) and ceil(end / F), with F = whole / low, in integers.
    let first = (start * low / whole).saturating_sub(1);
    let last = (end * low).div_ceil(whole) + 1;
    (first as u32, last.min(low - 1) as u32)
}

/// [`low_range`] on both axes: the rectangle of a `low_width`×`low_height`
/// blur image that a `width`×`height` tile at `region` builds and blurs.
pub fn low_rect(region: &Region, width: u32, height: u32, low_width: u32, low_height: u32) -> Rect {
    let (x0, x1) = low_range(region.x, width, region.whole_width, low_width);
    let (y0, y1) = low_range(region.y, height, region.whole_height, low_height);
    Rect::new(x0 as i32, y0 as i32, x1 - x0 + 1, y1 - y0 + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::detail::{blur_reach, blur_taps, pyramid_factor, pyramid_size, PYRAMID_SIGMA};

    #[test]
    fn a_region_must_hold_the_document() {
        assert!(Region::new(0, 0, 100, 80, 100, 80).is_ok());
        assert!(Region::new(40, 30, 100, 80, 60, 50).is_ok());
        assert!(Region::new(41, 0, 100, 80, 60, 50).is_err(), "past the right edge");
        assert!(Region::new(0, 31, 100, 80, 60, 50).is_err(), "past the bottom");
        assert!(Region::new(0, 0, 0, 80, 1, 1).is_err());
        assert!(Region::new(0, 0, 10, 10, 0, 1).is_err());
        assert!(Region::new(u32::MAX, 0, 10, 10, 1, 1).is_err(), "no overflow");
        assert!(Region::new(0, 0, MAX_WHOLE_SIDE + 1, 10, 1, 1).is_err());
        assert_eq!(Region::new(40, 30, 100, 80, 60, 50).unwrap().uniform(), [40.0, 30.0, 100.0, 80.0]);
        assert_eq!(region_uniform(None), NO_REGION);
    }

    #[test]
    fn the_low_range_covers_every_texel_the_tile_meets_and_one_more() {
        // 100 pixels, factor 3: 34 texels of 100/34 = 2.94 pixels (not whole).
        let (whole, low) = (100, pyramid_size(100, 3));
        assert_eq!(low, 34);
        // The whole picture is every texel.
        assert_eq!(low_range(0, 100, whole, low), (0, 33));
        // At the left edge: nothing before texel 0.
        assert_eq!(low_range(0, 10, whole, low), (0, 5));
        // At the right edge: nothing after the last.
        assert_eq!(low_range(90, 10, whole, low), (29, 33));
        // Inside: texel 10 covers [29.4, 32.4), texel 13 [38.2, 41.2).
        assert_eq!(low_range(30, 10, whole, low), (9, 15));
        let footprint = whole as f64 / low as f64;
        for start in 0..100u32 {
            for extent in 1..=(100 - start) {
                let (a, b) = low_range(start, extent, whole, low);
                for k in 0..low {
                    let (lo, hi) = (k as f64 * footprint, (k + 1) as f64 * footprint);
                    let meets = lo < f64::from(start + extent) && hi > f64::from(start);
                    if meets {
                        assert!(a <= k && k <= b, "texel {k} of a tile at {start}+{extent}");
                    }
                }
                assert!(a == 0 || (a + 1) as f64 * footprint <= f64::from(start), "{start}+{extent} starts at {a}");
            }
        }
    }

    #[test]
    fn a_low_rect_is_the_two_ranges() {
        let region = Region::new(30, 0, 100, 40, 10, 40).unwrap();
        let rect = low_rect(&region, 10, 40, 34, 14);
        assert_eq!(rect, Rect::new(9, 0, 7, 14));
    }

    #[test]
    fn the_blur_reach_is_its_taps_up_to_the_pyramid_and_its_texels_above() {
        assert_eq!(blur_reach(0.1), 1);
        assert_eq!(blur_reach(1.0), 3);
        assert_eq!(blur_reach(1.5), 5);
        assert_eq!(blur_reach(PYRAMID_SIGMA), 12);
        // σ 6: factor 3, σ 2 below, 6 taps.
        assert_eq!(blur_reach(6.0), 8 * 3 + 2);
        // σ 50: factor 25, σ 2 below.
        assert_eq!(blur_reach(50.0), 8 * 25 + 2);
        // σ 25 (half size): factor 13, σ 1.92, 6 taps.
        assert_eq!(blur_reach(25.0), 8 * 13 + 2);
    }

    /// `(x, y, w, h)` of a `width`-wide RGBA f32 image.
    fn crop(img: &[f32], width: usize, x: usize, y: usize, w: usize, h: usize) -> Vec<f32> {
        (y..y + h).flat_map(|row| img[(row * width + x) * 4..(row * width + x + w) * 4].to_vec()).collect()
    }

    fn assert_same_bits(what: &str, a: &[f32], b: &[f32]) {
        assert_eq!(a.len(), b.len());
        for (i, (x, y)) in a.iter().zip(b).enumerate() {
            assert_eq!(x.to_bits(), y.to_bits(), "{what}: value {i}, {x} against {y}");
        }
    }

    #[test]
    fn every_position_dependent_reference_on_a_region_is_the_crop_of_the_whole() {
        use crate::{areas, finish, look, output, scene_tone};
        let (w, h) = (61usize, 47usize);
        let picture: Vec<f32> = (0..w * h)
            .flat_map(|i| {
                let (x, y) = ((i % w) as u32, (i / w) as u32);
                [crate::finish::hash(x, y, 1), crate::finish::hash(x, y, 2) * 0.8, 0.2 + 0.5 * crate::finish::hash(x, y, 3), 1.0]
            })
            .collect();
        // A rotated radial area, inverted, and a linear one.
        let (area_list, _) = areas::parse_areas(&[
            1.0, 1.0, 0.8, 30.0, 20.0, 18.0, 9.0, 0.6, 0.4, 1.0, 20.0, -30.0, 40.0, 30.0, -20.0, 25.0, //
            0.0, 0.0, 1.0, 5.0, 40.0, 50.0, 3.0, 0.0, 0.0, -0.5, 10.0, 0.0, -20.0, 0.0, 15.0, -10.0,
        ])
        .unwrap();
        let fin = finish::FinishSettings::from_values(&[-40.0, 30.0, -20.0, 50.0, 60.0, 40.0, 30.0, 7.0, 1.0]).unwrap();
        let sliders = scene_tone::ToneSliders::parse(&[0.3, 10.0, -5.0, 20.0, -30.0, 25.0, 10.0, -10.0]).unwrap();
        let out = output::OutputSettings::sdr(output::OutputTarget::Srgb, crate::working_space::Gamut::Rec2020, true);
        let look_inputs = look::LookInputs {
            settings: look::LookSettings { saturation: 20.0, vibrance: -10.0, ..Default::default() },
            curves: &[None, None, None, None],
            areas: &area_list,
            area_vibrance: &[15.0, -5.0],
        };
        let whole = (
            areas::areas_reference(&picture, w, h, &area_list),
            areas::area_layer_reference(&picture, &picture.iter().map(|v| v * 0.5).collect::<Vec<_>>(), w, h, &area_list[0]),
            finish::finish_reference(&picture, w, h, &fin),
            output::output_reference(&picture, w as u32, &out),
            look::look_reference(&picture, w, h, &look_inputs),
            scene_tone::scene_tone_reference(&picture, w, h, &sliders, &area_list, &[]),
        );
        for &(x, y, tw, th) in &[(0usize, 0usize, 20usize, 15usize), (13, 9, 30, 21), (41, 32, 20, 15), (0, 0, w, h)] {
            let region = Some(Region::new(x as u32, y as u32, w as u32, h as u32, tw as u32, th as u32).unwrap());
            let tile = crop(&picture, w, x, y, tw, th);
            let half: Vec<f32> = tile.iter().map(|v| v * 0.5).collect();
            let at = |img: &[f32]| crop(img, w, x, y, tw, th);
            assert_same_bits("areas", &areas::areas_reference_at(&tile, tw, th, &area_list, region), &at(&whole.0));
            assert_same_bits("area layer", &areas::area_layer_reference_at(&tile, &half, tw, th, &area_list[0], region), &at(&whole.1));
            assert_same_bits("finish", &finish::finish_reference_at(&tile, tw, th, &fin, region), &at(&whole.2));
            assert_same_bits("output", &output::output_reference_at(&tile, tw as u32, &out, region), &at(&whole.3));
            assert_same_bits("look", &look::look_reference_at(&tile, tw, th, &look_inputs, region), &at(&whole.4));
            assert_same_bits(
                "tone",
                &scene_tone::scene_tone_reference_at(&tile, tw, th, &sliders, &area_list, &[], region),
                &at(&whole.5),
            );
        }
    }

    // ---------------------------------------------------------------
    // The engine's blur on one axis, for a whole picture and for a tile of
    // it with the whole's grid: `thumbnail_box.wgsl` with the region's
    // fetches, `blur_axis.wgsl`, and the combining shaders' bilinear read
    // at `uv = (x + 0.5) / W`. Each axis of the 2-D blur is this.
    // ---------------------------------------------------------------

    fn bilinear(img: &[f32], q: f32) -> f32 {
        let n = img.len() as i32;
        let at = |i: i32| img[i.clamp(0, n - 1) as usize];
        let x0 = q.floor();
        let f = q - x0;
        let x0 = x0 as i32;
        at(x0) + f * (at(x0 + 1) - at(x0))
    }

    fn gaussian(img: &[f32], sigma: f32, range: (usize, usize)) -> Vec<f32> {
        let sigma = sigma.max(0.3);
        let r = blur_taps(sigma);
        let n = img.len() as i32;
        let mut out = vec![0.0; img.len()];
        for (x, v) in out.iter_mut().enumerate().take(range.1 + 1).skip(range.0) {
            let (mut acc, mut total) = (0.0f32, 0.0f32);
            for i in -r..=r {
                let w = (-((i * i) as f32) / (2.0 * sigma * sigma)).exp();
                acc += w * img[(x as i32 + i).clamp(0, n - 1) as usize];
                total += w;
            }
            *v = acc / total;
        }
        out
    }

    /// The blur of `tile`, which is whole pixels `start..start + tile.len()`
    /// of a picture `whole` wide, at each of the tile's pixels; with
    /// `start` 0 and the whole picture as the tile, the whole's own blur.
    fn engine_blur(tile: &[f32], start: u32, whole: u32, sigma: f32) -> Vec<f32> {
        let n = tile.len();
        if sigma <= PYRAMID_SIGMA {
            return gaussian(tile, sigma, (0, n - 1));
        }
        let factor = pyramid_factor(sigma);
        let low_w = pyramid_size(whole, factor);
        let footprint = whole as f32 / low_w as f32;
        let taps = ((footprint * 0.5).ceil() as i32).clamp(1, 64);
        let step = footprint / taps as f32;
        let fetch = |p: i32| tile[(p.clamp(0, whole as i32 - 1) - start as i32).clamp(0, n as i32 - 1) as usize];
        let (a, b) = low_range(start, n as u32, whole, low_w);
        let mut low = vec![0.0f32; low_w as usize];
        for k in a..=b {
            let lo = k as f32 * footprint;
            let mut sum = 0.0;
            for i in 0..taps {
                let q = lo + (i as f32 + 0.5) * step - 0.5;
                let q0 = q.floor();
                let f = q - q0;
                let p0 = q0 as i32;
                sum += fetch(p0) + f * (fetch(p0 + 1) - fetch(p0));
            }
            low[k as usize] = sum / taps as f32;
        }
        let low = gaussian(&low, sigma / factor as f32, (a as usize, b as usize));
        (0..n)
            .map(|i| {
                let uv = (i as f32 + start as f32 + 0.5) / whole as f32;
                bilinear(&low, uv * low_w as f32 - 0.5)
            })
            .collect()
    }

    fn signal(n: u32) -> Vec<f32> {
        (0..n).map(|x| crate::finish::hash(x, 7, 3) + 0.3 * ((x / 9) % 2) as f32).collect()
    }

    #[test]
    fn a_tile_with_the_reach_as_its_apron_blurs_as_the_whole_does() {
        // Widths whose footprints are not whole numbers, at the sigmas the
        // stages use at full size and at a working scale.
        for &whole in &[401u32, 437, 512] {
            let picture = signal(whole);
            for &sigma in &[1.0f32, 3.0, 4.0, 6.0, 12.5, 25.0, 50.0] {
                let reach = blur_reach(sigma);
                let expected = engine_blur(&picture, 0, whole, sigma);
                for start in (0..whole).step_by(23) {
                    for &extent in &[2 * reach + 1, 2 * reach + 37, whole - start] {
                        let extent = extent.min(whole - start);
                        let end = start + extent;
                        let got = engine_blur(&picture[start as usize..end as usize], start, whole, sigma);
                        let from = if start == 0 { 0 } else { start + reach };
                        let to = if end == whole { whole } else { end.saturating_sub(reach) };
                        for x in from..to {
                            assert_eq!(
                                got[(x - start) as usize].to_bits(),
                                expected[x as usize].to_bits(),
                                "σ {sigma}, {whole} wide, tile {start}+{extent}, pixel {x}"
                            );
                        }
                    }
                }
            }
        }
    }

    /// The furthest any output pixel moves from a change of one pixel: what
    /// the reach must cover, measured.
    fn measured_reach(whole: u32, sigma: f32) -> u32 {
        let base = vec![0.25f32; whole as usize];
        let before = engine_blur(&base, 0, whole, sigma);
        let mut furthest = 0;
        for at in (whole / 4)..(3 * whole / 4) {
            let mut changed = base.clone();
            changed[at as usize] = 1.0;
            let after = engine_blur(&changed, 0, whole, sigma);
            for x in 0..whole {
                if after[x as usize] != before[x as usize] {
                    furthest = furthest.max(x.abs_diff(at));
                }
            }
        }
        furthest
    }

    #[test]
    fn the_reach_is_never_short_and_not_much_more_than_measured() {
        for &(whole, sigma) in &[(301u32, 1.0f32), (301, 3.0), (301, 4.0), (301, 6.0), (437, 6.0), (1200, 25.0), (1601, 50.0)] {
            let measured = measured_reach(whole, sigma);
            let reach = blur_reach(sigma);
            let slack = if sigma <= PYRAMID_SIGMA { 0 } else { pyramid_factor(sigma) + 2 };
            assert!(measured <= reach, "σ {sigma}: measured {measured}, reach {reach}");
            assert!(reach - measured <= slack, "σ {sigma}: reach {reach} is {} past the measured {measured}", reach - measured);
        }
    }
}
