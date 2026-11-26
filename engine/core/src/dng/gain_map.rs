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
//! Applying it is the linear RAW path's business (to come); this reads it.

/// The most gain values a map may hold: 4 Mi (16 MB as f32), five times
/// the 48 × 64 × 257 ProRAW tables.
pub const MAX_TABLE_VALUES: u64 = 1 << 22;

const HEADER_BYTES: usize = 64;

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
}
