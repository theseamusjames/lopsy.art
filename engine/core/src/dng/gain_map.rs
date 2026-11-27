//! `ProfileGainTableMap` (DNG 1.6, tag 52525): a spatially varying gain,
//! read and applied as the specification's section on the tag says. Apple's
//! ProRAW carries one; it is the camera's local tone map, part of how the
//! picture is meant to look (it holds the lights back and lifts shadows by
//! region).
//!
//! **What the tag holds** (all of it in one UNDEFINED value): `MapPointsV`
//! and `MapPointsH` (LONG), `MapSpacingV`, `MapSpacingH`, `MapOriginV`,
//! `MapOriginH` (DOUBLE), `MapPointsN` (LONG), `MapInputWeights` (five
//! FLOAT), then `MapPointsV × MapPointsH` tables of `MapPointsN` FLOAT
//! gains, row by row; 64 + 4 · V · H · N bytes. The specification gives no
//! byte order for it: [`parse`] takes whichever order (the file's first)
//! makes the header agree with the byte count, and refuses a tag neither
//! does. The ProRAW samples are big-endian files, so both readings agree
//! there.
//!
//! **Where it applies.** The specification: in RIMM (linear ProPhoto RGB,
//! D50), reached by mapping camera RGB to XYZ D50 by the camera's
//! calibration (chapter 6) and then to RIMM, after the BaselineExposure
//! adjustment, and before `ProfileToneCurve` while the data is linear. At
//! each pixel the four nearest tables are interpolated bilinearly (edges
//! replicated outside the map); the table input is
//! `clamp((R, G, B, min, max) · MapInputWeights, 0, 1)` of the pixel's RIMM
//! value, times `MapPointsN` as the table index, linearly interpolated;
//! and the resulting gain multiplies the pixel. Positions are pixel centres
//! relative to the `ActiveArea`: pixel `(x, y)` of a `W × H` active area is
//! at `((x + 0.5) / W, (y + 0.5) / H)`.
//!
//! **How that maps onto this engine.** The gain is one number a pixel, so
//! multiplying the camera RGB the develop chain receives by it is the same
//! as multiplying the RIMM values: the matrix is linear. Only the table
//! input needs RIMM, and it is computed from the prepared plane (camera
//! RGB at the as-shot white balance, the unit the band renders take) by
//! [`camera_to_rimm`], the file's own matrix for the as-shot white, scaled
//! by `2^BaselineExposure`. So the map is applied once to the prepared
//! plane, before it is cut into bands or binned: every band and the binned
//! view see the same gained values, and the GPU's RAW step (white balance,
//! matrix, exposure) follows as before. What this fixes that the
//! specification leaves to the reader: the table input is taken at the
//! as-shot white balance and the BaselineExposure, the file's own state,
//! not recomputed when the user changes white balance or exposure (the
//! tag is "a starting point for user adjustments"); and the opening
//! exposure stays the file's BaselineExposure unless `dng::preview` says
//! otherwise.
//!
//! **What is not done.** A Bayer DNG with the tag keeps it unapplied (the
//! input needs a whole RGB pixel, which a mosaic has only after the
//! demosaic, in the band render; no such file has been seen). The DNG 1.7
//! form, `ProfileGainTableMap2`, is not read (neither sample carries it).
//! The baked decode (`dng::read_dng`) is untouched by this module.

use super::camera_color::DngCalibration;
use crate::colorimetry::{self, Mat3};

/// The most gain values a map may hold: 4 Mi (16 MB as f32), five times
/// the 48 × 64 × 257 ProRAW tables.
pub const MAX_TABLE_VALUES: u64 = 1 << 22;

const HEADER_BYTES: usize = 64;

/// The ROMM / RIMM RGB primaries (ISO 22028-2, ProPhoto RGB), red, green,
/// blue; the white is D50.
const ROMM_PRIMARIES_XY: [(f64, f64); 3] = [(0.7347, 0.2653), (0.1596, 0.8404), (0.0366, 0.0001)];

/// A parsed `ProfileGainTableMap`.
#[derive(Clone, Debug, PartialEq)]
pub struct GainTableMap {
    pub points_v: u32,
    pub points_h: u32,
    pub spacing_v: f64,
    pub spacing_h: f64,
    pub origin_v: f64,
    pub origin_h: f64,
    pub points_n: u32,
    /// R, G, B, min(R, G, B), max(R, G, B).
    pub weights: [f32; 5],
    /// `points_v × points_h` tables of `points_n` gains, row by row.
    pub gains: Vec<f32>,
    /// The byte order the tag was read in.
    pub big_endian: bool,
}

struct Header {
    v: u32,
    h: u32,
    n: u32,
}

fn header(raw: &[u8], big_endian: bool) -> Header {
    let u = |o: usize| {
        let b = [raw[o], raw[o + 1], raw[o + 2], raw[o + 3]];
        if big_endian { u32::from_be_bytes(b) } else { u32::from_le_bytes(b) }
    };
    Header { v: u(0), h: u(4), n: u(40) }
}

/// The number of gains a header names, when it agrees with `len` bytes.
fn agrees(h: &Header, len: usize) -> Option<u64> {
    let count = u64::from(h.v).checked_mul(u64::from(h.h))?.checked_mul(u64::from(h.n))?;
    let bytes = count.checked_mul(4)?.checked_add(HEADER_BYTES as u64)?;
    (count > 0 && bytes == len as u64).then_some(count)
}

/// Read a `ProfileGainTableMap` value (`raw`, the tag's bytes as stored) of
/// a file whose byte order is `file_big_endian`. An error is a sentence
/// saying why the map cannot be used; nothing here panics on any input, and
/// nothing is allocated beyond [`MAX_TABLE_VALUES`] gains.
pub fn parse(raw: &[u8], file_big_endian: bool) -> Result<GainTableMap, String> {
    if raw.len() < HEADER_BYTES {
        return Err(format!("the map is {} bytes, shorter than its {HEADER_BYTES}-byte header", raw.len()));
    }
    let first = header(raw, file_big_endian);
    let (big_endian, h, count) = match agrees(&first, raw.len()) {
        Some(c) => (file_big_endian, first, c),
        None => {
            let other = header(raw, !file_big_endian);
            match agrees(&other, raw.len()) {
                Some(c) => (!file_big_endian, other, c),
                None => {
                    return Err(format!(
                        "the map holds {} bytes, not the 64 + 4 × {} × {} × {} its header gives",
                        raw.len(),
                        first.v,
                        first.h,
                        first.n
                    ))
                }
            }
        }
    };
    if count > MAX_TABLE_VALUES {
        return Err(format!("a {} × {} map of {}-point tables is larger than the {MAX_TABLE_VALUES} gains this decode accepts", h.v, h.h, h.n));
    }
    let bytes8 = |o: usize| -> [u8; 8] { std::array::from_fn(|i| raw[o + i]) };
    let bytes4 = |o: usize| -> [u8; 4] { std::array::from_fn(|i| raw[o + i]) };
    let f64_at = |o: usize| if big_endian { f64::from_be_bytes(bytes8(o)) } else { f64::from_le_bytes(bytes8(o)) };
    let f32_at = |o: usize| if big_endian { f32::from_be_bytes(bytes4(o)) } else { f32::from_le_bytes(bytes4(o)) };
    let (spacing_v, spacing_h, origin_v, origin_h) = (f64_at(8), f64_at(16), f64_at(24), f64_at(32));
    let weights: [f32; 5] = std::array::from_fn(|i| f32_at(44 + 4 * i));
    // One point in a direction needs no spacing; more need a positive one.
    let spacing_ok = |points: u32, s: f64| points == 1 || (s.is_finite() && s > 0.0);
    if !(spacing_ok(h.v, spacing_v) && spacing_ok(h.h, spacing_h)) {
        return Err(format!("the map's spacing {spacing_v} × {spacing_h} is not a positive number"));
    }
    if !(origin_v.is_finite() && origin_h.is_finite()) {
        return Err("the map's origin is not a number".into());
    }
    if !weights.iter().all(|w| w.is_finite()) {
        return Err("the map's input weights are not numbers".into());
    }
    let n = count as usize;
    let mut gains: Vec<f32> = Vec::new();
    gains.try_reserve_exact(n).map_err(|_| "not enough memory for the gain table map".to_string())?;
    for o in (HEADER_BYTES..raw.len()).step_by(4) {
        let g = f32_at(o);
        if !(g.is_finite() && g >= 0.0) {
            return Err(format!("the map holds a gain of {g}; gains must be non-negative numbers"));
        }
        gains.push(g);
    }
    Ok(GainTableMap { points_v: h.v, points_h: h.h, spacing_v, spacing_h, origin_v, origin_h, points_n: h.n, weights, gains, big_endian })
}

/// A prepared plane's place in the area the map is relative to: the
/// `ActiveArea`'s size, and where the plane's top-left falls in it (rows,
/// columns; non-zero when a `DefaultCrop` was kept inside it).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MapPlacement {
    pub active_width: usize,
    pub active_height: usize,
    pub from_active: (usize, usize),
}

/// The camera-RGB-at-the-as-shot-white to RIMM matrix the table input is
/// computed with, row-major: the file's `CameraToXYZ_D50` for the as-shot
/// white (`camera_color`), undoing the as-shot gain the plane carries
/// (`× diag(neutral)`), then XYZ D50 to RIMM, all times
/// `2^exposure_ev` (the BaselineExposure). A plane value of (1, 1, 1), the
/// as-shot neutral at the green channel's white, maps to RIMM
/// `2^exposure_ev × (1, 1, 1)`. `None` when the calibration cannot make
/// the matrix.
pub fn camera_to_rimm(cal: &DngCalibration, exposure_ev: f64) -> Option<[f32; 9]> {
    let (xy, neutral) = cal.as_shot()?;
    let camera_to_xyz = cal.camera_to_xyz_d50(xy, neutral)?;
    let xyz_to_rimm = colorimetry::mat_inverse(&colorimetry::rgb_to_xyz_matrix(&ROMM_PRIMARIES_XY, &colorimetry::PCS_D50));
    let diag: Mat3 = [[neutral[0], 0.0, 0.0], [0.0, neutral[1], 0.0], [0.0, 0.0, neutral[2]]];
    let m = colorimetry::mat_mul(&xyz_to_rimm, &colorimetry::mat_mul(&camera_to_xyz, &diag));
    let k = exposure_ev.exp2();
    let flat: [f32; 9] = std::array::from_fn(|i| (m[i / 3][i % 3] * k) as f32);
    flat.iter().all(|v| v.is_finite()).then_some(flat)
}

/// Where a position falls between the map's points in one direction:
/// the two points and the weight of the second. Positions outside the map
/// take its edge (the specification's replication).
fn axis(position: f64, origin: f64, spacing: f64, points: u32) -> (usize, usize, f32) {
    if points <= 1 {
        return (0, 0, 0.0);
    }
    let last = (points - 1) as f64;
    let g = ((position - origin) / spacing).clamp(0.0, last);
    let i0 = (g.floor() as usize).min(points as usize - 1);
    let i1 = (i0 + 1).min(points as usize - 1);
    (i0, i1, (g - i0 as f64) as f32)
}

impl GainTableMap {
    fn table(&self, row: usize, col: usize) -> &[f32] {
        let n = self.points_n as usize;
        let at = (row * self.points_h as usize + col) * n;
        &self.gains[at..at + n]
    }

    /// The table input of a RIMM value.
    #[inline]
    fn input(&self, rimm: [f32; 3]) -> f32 {
        let w = &self.weights;
        let lo = rimm[0].min(rimm[1]).min(rimm[2]);
        let hi = rimm[0].max(rimm[1]).max(rimm[2]);
        (w[0] * rimm[0] + w[1] * rimm[1] + w[2] * rimm[2] + w[3] * lo + w[4] * hi).clamp(0.0, 1.0)
    }

    /// The table index of an input: the input times `MapPointsN`, as the
    /// specification says, between two entries; the last entry beyond.
    #[inline]
    fn index(&self, input: f32) -> (usize, usize, f32) {
        let last = self.points_n as usize - 1;
        let fi = input * self.points_n as f32;
        let k0 = (fi as usize).min(last);
        let k1 = (k0 + 1).min(last);
        (k0, k1, (fi - k0 as f32).clamp(0.0, 1.0))
    }

    /// The smallest gain any table gives for an input up to `input_max`:
    /// what a value can at least be multiplied by.
    fn smallest_gain_up_to(&self, input_max: f32) -> f32 {
        let (_, k1, _) = self.index(input_max.clamp(0.0, 1.0));
        let n = self.points_n as usize;
        self.gains.chunks_exact(n).flat_map(|t| t[..=k1].iter().copied()).fold(f32::INFINITY, f32::min)
    }

    /// Each channel's clip level in a plane the map was applied to, from
    /// its clip level before (`clip`, the as-shot gain), with `to_rimm` the
    /// matrix the map was applied with: a lower bound on what a clipped
    /// channel can have become, so the white balance picker, which skips a
    /// pixel with a channel near its level, still skips every clipped one
    /// (and some bright unclipped ones with them). A single level cannot
    /// say more: after the map the clip point differs from pixel to pixel.
    ///
    /// `None` when that bound is 0 (or not a number): a map may hold gains
    /// of 0 (the specification asks only that gains be non-negative), and
    /// then a clipped channel can have become anything down to black, so
    /// no level says where clipping is; without levels, the picker measures
    /// every pixel, as it does for a file that records none.
    pub fn clip_levels_after(&self, clip: [f32; 3], to_rimm: &[f32; 9]) -> Option<[f32; 3]> {
        // The largest input a pixel inside its clip levels can have: each
        // RIMM channel at most the sum of its positive terms, and the
        // input at most the weights' positive terms of those (any negative
        // weight, and the bound is the whole table).
        let rimm_max: [f32; 3] = std::array::from_fn(|r| (0..3).map(|c| (to_rimm[r * 3 + c] * clip[c]).max(0.0)).sum());
        let peak = rimm_max[0].max(rimm_max[1]).max(rimm_max[2]);
        let w = &self.weights;
        let input_max = if w.iter().all(|&x| x >= 0.0) { w[0] * rimm_max[0] + w[1] * rimm_max[1] + w[2] * rimm_max[2] + (w[3] + w[4]) * peak } else { 1.0 };
        let g = self.smallest_gain_up_to(input_max);
        let levels = clip.map(|c| c * g);
        levels.iter().all(|&l| l.is_finite() && l > 0.0).then_some(levels)
    }

    /// Multiply each pixel of an interleaved RGB plane (`width × height`,
    /// three values a pixel) by the map's gain at its position, its table
    /// input taken from `to_rimm` × the pixel ([`camera_to_rimm`]). In
    /// place: the only allocation is a row of column weights.
    pub fn apply(&self, plane: &mut [f32], width: usize, height: usize, at: MapPlacement, to_rimm: &[f32; 9]) -> Result<(), String> {
        if plane.len() != width * height * 3 {
            return Err(format!("the plane has {} values, not {width} × {height} × 3", plane.len()));
        }
        let (aw, ah) = (at.active_width as f64, at.active_height as f64);
        let (dy, dx) = at.from_active;
        if at.active_width < dx + width || at.active_height < dy + height || width == 0 {
            return Err("the plane is not inside the active area the map is relative to".into());
        }
        let mut cols: Vec<(usize, usize, f32)> = Vec::new();
        cols.try_reserve_exact(width).map_err(|_| "not enough memory to apply the gain table map".to_string())?;
        cols.extend((0..width).map(|x| axis(((x + dx) as f64 + 0.5) / aw, self.origin_h, self.spacing_h, self.points_h)));
        let m = to_rimm;
        for (y, line) in plane.chunks_exact_mut(width * 3).enumerate() {
            let (r0, r1, fy) = axis(((y + dy) as f64 + 0.5) / ah, self.origin_v, self.spacing_v, self.points_v);
            for (px, &(c0, c1, fx)) in line.chunks_exact_mut(3).zip(&cols) {
                let rgb = [px[0], px[1], px[2]];
                let rimm: [f32; 3] = std::array::from_fn(|r| m[r * 3] * rgb[0] + m[r * 3 + 1] * rgb[1] + m[r * 3 + 2] * rgb[2]);
                let (k0, k1, fk) = self.index(self.input(rimm));
                let look = |row: usize, col: usize| {
                    let t = self.table(row, col);
                    t[k0] + (t[k1] - t[k0]) * fk
                };
                let top = look(r0, c0) + (look(r0, c1) - look(r0, c0)) * fx;
                let bottom = look(r1, c0) + (look(r1, c1) - look(r1, c0)) * fx;
                let gain = top + (bottom - top) * fy;
                px[0] = rgb[0] * gain;
                px[1] = rgb[1] * gain;
                px[2] = rgb[2] * gain;
            }
        }
        Ok(())
    }
}

/// A tag's bytes for a map (a made-up table, not a camera's), for tests.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn tag_bytes(v: u32, h: u32, n: u32, spacing: [f64; 2], origin: [f64; 2], weights: [f32; 5], gains: &[f32], big: bool) -> Vec<u8> {
    let mut out = Vec::new();
    let u = |x: u32| if big { x.to_be_bytes() } else { x.to_le_bytes() };
    let d = |x: f64| if big { x.to_be_bytes() } else { x.to_le_bytes() };
    let f = |x: f32| if big { x.to_be_bytes() } else { x.to_le_bytes() };
    out.extend(u(v));
    out.extend(u(h));
    out.extend(d(spacing[0]));
    out.extend(d(spacing[1]));
    out.extend(d(origin[0]));
    out.extend(d(origin[1]));
    out.extend(u(n));
    for w in weights {
        out.extend(f(w));
    }
    for &g in gains {
        out.extend(f(g));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    use super::tag_bytes as bytes;

    fn identity() -> [f32; 9] {
        [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
    }

    #[test]
    fn reads_either_byte_order_by_the_size_the_header_gives() {
        let gains: Vec<f32> = (0..2 * 3 * 4).map(|i| i as f32 / 10.0).collect();
        for big in [true, false] {
            let raw = bytes(2, 3, 4, [0.5, 0.25], [0.1, -0.2], [0.25, 0.5, 0.25, 0.0, 0.0], &gains, big);
            for file_big in [true, false] {
                let m = parse(&raw, file_big).unwrap();
                assert_eq!((m.points_v, m.points_h, m.points_n, m.big_endian), (2, 3, 4, big));
                assert_eq!((m.spacing_v, m.spacing_h, m.origin_v, m.origin_h), (0.5, 0.25, 0.1, -0.2));
                assert_eq!(m.weights, [0.25, 0.5, 0.25, 0.0, 0.0]);
                assert_eq!(m.gains, gains);
            }
        }
    }

    #[test]
    fn a_malformed_or_oversized_map_is_refused_with_a_sentence() {
        let ok = bytes(1, 1, 2, [1.0, 1.0], [0.0, 0.0], [1.0, 0.0, 0.0, 0.0, 0.0], &[1.0, 2.0], true);
        assert!(parse(&ok, true).is_ok());
        assert!(parse(&ok[..63], true).unwrap_err().contains("header"));
        assert!(parse(&ok[..ok.len() - 1], true).unwrap_err().contains("bytes"));
        // A header that names more gains than the cap, with bytes to match
        // its claim never allocated: refused by the size first.
        let huge = bytes(4096, 4096, 257, [0.1, 0.1], [0.0, 0.0], [1.0; 5], &[], true);
        assert!(parse(&huge, true).is_err());
        let mut too_many = bytes(2048, 2048, 2, [0.1, 0.1], [0.0, 0.0], [1.0; 5], &[], true);
        too_many.resize(64 + 4 * 2048 * 2048 * 2, 0);
        assert!(parse(&too_many, true).unwrap_err().contains("larger than"));
        let zero = bytes(0, 1, 2, [1.0, 1.0], [0.0, 0.0], [1.0; 5], &[], true);
        assert!(parse(&zero, true).is_err());
        let bad_spacing = bytes(2, 1, 1, [0.0, 1.0], [0.0, 0.0], [1.0; 5], &[1.0, 1.0], true);
        assert!(parse(&bad_spacing, true).unwrap_err().contains("spacing"));
        let negative = bytes(1, 1, 2, [1.0, 1.0], [0.0, 0.0], [1.0; 5], &[1.0, -0.5], true);
        assert!(parse(&negative, true).unwrap_err().contains("non-negative"));
        let nan = bytes(1, 1, 2, [1.0, 1.0], [f64::NAN, 0.0], [1.0; 5], &[1.0, 1.0], true);
        assert!(parse(&nan, true).is_err());
        // Every truncation of a good map is refused, never a panic.
        let good = bytes(3, 2, 5, [0.5, 1.0], [0.0, 0.0], [0.2; 5], &[1.0; 30], false);
        for cut in 0..good.len() {
            assert!(parse(&good[..cut], false).is_err(), "cut at {cut}");
        }
    }

    #[test]
    fn the_table_is_indexed_by_the_input_times_its_point_count() {
        // One table, four points: input 0.5 is index 2 exactly; 0.6 is
        // 2.4; 1.0 is past the last entry and takes it.
        let raw = bytes(1, 1, 4, [1.0, 1.0], [0.0, 0.0], [1.0, 0.0, 0.0, 0.0, 0.0], &[4.0, 3.0, 2.0, 1.0], true);
        let m = parse(&raw, true).unwrap();
        let at = MapPlacement { active_width: 3, active_height: 1, from_active: (0, 0) };
        let mut plane = vec![0.5, 0.0, 0.0, 0.6, 0.0, 0.0, 1.0, 0.0, 0.0];
        m.apply(&mut plane, 3, 1, at, &identity()).unwrap();
        assert_eq!(plane[0], 0.5 * 2.0);
        assert!((plane[3] - 0.6 * 1.6).abs() < 1e-6, "{}", plane[3]);
        assert_eq!(plane[6], 1.0);
        // Inputs are clamped: a negative pixel takes the first entry.
        let mut dark = vec![-0.1, 0.0, 0.0];
        m.apply(&mut dark, 1, 1, MapPlacement { active_width: 1, active_height: 1, from_active: (0, 0) }, &identity()).unwrap();
        assert!((dark[0] - -0.4).abs() < 1e-6);
    }

    /// A 2 × 2 map of constant tables, one gain each, spaced so that its
    /// points sit at the centres of the corner pixels of a 5 × 3 active area.
    fn corners() -> GainTableMap {
        let g = [1.0f32, 2.0, 3.0, 4.0];
        let gains: Vec<f32> = g.iter().flat_map(|&x| [x, x]).collect();
        let raw = bytes(2, 2, 2, [2.0 / 3.0, 4.0 / 5.0], [0.5 / 3.0, 0.5 / 5.0], [0.0; 5], &gains, true);
        parse(&raw, true).unwrap()
    }

    #[test]
    fn positions_are_pixel_centres_of_the_active_area_and_edges_replicate() {
        let m = corners();
        let at = MapPlacement { active_width: 5, active_height: 3, from_active: (0, 0) };
        let mut plane = vec![1.0f32; 5 * 3 * 3];
        m.apply(&mut plane, 5, 3, at, &identity()).unwrap();
        let gain = |x: usize, y: usize| plane[(y * 5 + x) * 3];
        let close = |a: f32, b: f32| (a - b).abs() < 1e-5;
        assert!(close(gain(0, 0), 1.0) && close(gain(4, 0), 2.0) && close(gain(0, 2), 3.0) && close(gain(4, 2), 4.0));
        assert!(close(gain(2, 1), 2.5), "the centre is the mean of the four: {}", gain(2, 1));
        assert!(close(gain(2, 0), 1.5));
        // A crop inside the active area keeps each pixel's own gain.
        let mut cropped = vec![1.0f32; 3 * 2 * 3];
        m.apply(&mut cropped, 3, 2, MapPlacement { active_width: 5, active_height: 3, from_active: (1, 2) }, &identity()).unwrap();
        for y in 0..2 {
            for x in 0..3 {
                assert_eq!(cropped[(y * 3 + x) * 3].to_bits(), gain(x + 2, y + 1).to_bits(), "{x},{y}");
            }
        }
        // Outside the map's points, the edge values.
        let wide = parse(&bytes(2, 2, 2, [0.1, 0.1], [0.4, 0.4], [0.0; 5], &[1.0, 1.0, 2.0, 2.0, 3.0, 3.0, 4.0, 4.0], true), true).unwrap();
        let mut px = vec![1.0f32; 5 * 3 * 3];
        wide.apply(&mut px, 5, 3, at, &identity()).unwrap();
        assert!(close(px[0], 1.0) && close(px[(2 * 5 + 4) * 3], 4.0));
    }

    #[test]
    fn the_input_uses_the_weights_on_rimm_including_min_and_max() {
        // Gains 1 at input 0 rising to 3 at 1 (two points: index = input × 2).
        let raw = bytes(1, 1, 2, [1.0, 1.0], [0.0, 0.0], [0.0, 0.0, 0.0, 0.25, 0.25], &[1.0, 2.0], true);
        let m = parse(&raw, true).unwrap();
        // Input = (min + max) / 4 = (0.2 + 0.6) / 4 = 0.2: index 0.4.
        let mut px = vec![0.6, 0.2, 0.4];
        m.apply(&mut px, 1, 1, MapPlacement { active_width: 1, active_height: 1, from_active: (0, 0) }, &identity()).unwrap();
        assert!((px[0] / 0.6 - 1.4).abs() < 1e-6, "{px:?}");
        // The matrix feeds the input, not the output: doubling it moves the
        // gain only.
        let mut px2 = vec![0.6, 0.2, 0.4];
        let twice = identity().map(|v| v * 2.0);
        m.apply(&mut px2, 1, 1, MapPlacement { active_width: 1, active_height: 1, from_active: (0, 0) }, &twice).unwrap();
        assert!((px2[0] / 0.6 - 1.8).abs() < 1e-6, "{px2:?}");
    }

    #[test]
    fn clip_levels_after_bound_every_clipped_channel() {
        let raw = bytes(1, 2, 4, [1.0, 1.0], [0.0, 0.0], [0.1, 0.1, 0.1, 0.0, 0.0], &[3.0, 2.0, 1.0, 0.5, 2.5, 1.5, 0.8, 0.4], true);
        let m = parse(&raw, true).unwrap();
        // Clip 1: the input is at most 0.3, index 1.2, so entries 0..=2.
        let levels = m.clip_levels_after([1.0; 3], &identity());
        assert_eq!(levels, Some([0.8; 3]));
        // A gain of 0 within reach: no level, not a level of 0.
        let zero = parse(&bytes(1, 1, 4, [1.0, 1.0], [0.0, 0.0], [0.1, 0.1, 0.1, 0.0, 0.0], &[3.0, 0.0, 1.0, 0.5], true), true).unwrap();
        assert_eq!(zero.clip_levels_after([1.0; 3], &identity()), None);
    }

    #[test]
    fn a_plane_outside_the_active_area_is_refused() {
        let m = corners();
        let mut plane = vec![1.0f32; 6 * 3 * 3];
        assert!(m.apply(&mut plane, 6, 3, MapPlacement { active_width: 5, active_height: 3, from_active: (0, 0) }, &identity()).is_err());
        assert!(m.apply(&mut plane[..3], 6, 3, MapPlacement { active_width: 6, active_height: 3, from_active: (0, 0) }, &identity()).is_err());
    }
}
