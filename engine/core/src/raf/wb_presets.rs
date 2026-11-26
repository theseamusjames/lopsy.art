//! A Fujifilm RAF's white-balance presets and Kelvin scale, read from the
//! file itself.
//!
//! ## What the file holds
//!
//! Every number here comes from the RAF being opened; nothing is tabulated
//! per body. Two records carry the camera's own whites, each written as
//! the levels the as-shot record (CFA sub-IFD tag 0xF00D) uses: green, red,
//! blue, with green the same level as the as-shot green (302 on the bodies
//! sampled), so a white's multipliers are `[R/G, 1, B/G]`.
//!
//! - **The preset table**, in the CFA header's record 0xC000 (a block of
//!   little-endian values): 47 consecutive (G, R, B) triples of `u16`. The
//!   first ten are preset slots, the last 37 a ladder whose red rises and
//!   blue falls at every step, from a light far warmer than tungsten to one
//!   far bluer than daylight: the camera's own locus of colour
//!   temperatures. The slots were identified on our sample files, without
//!   any other software's tables, from evidence alone:
//!   - all ten but the last are the same in every frame of a body (four
//!     X100VI, seven X-E5 frames); slot 9 changes from frame to frame and
//!     is not offered; slots 6–8 repeat slot 0 on every body sampled and
//!     cannot be told apart, so they are not offered either;
//!   - slot 5 is exactly the camera's white for EXIF light source 17,
//!     standard illuminant A, a tungsten lamp (the calibration record
//!     below), on every body: **Tungsten**;
//!   - slots 0 and 1 lie on the ladder (no more green or magenta than the
//!     camera's locus where they cross it): natural light. Slot 0 is the
//!     warmer, about 5000 K on the scale below, and is the one slots 6–8
//!     copy: **Daylight**. Slot 1 is at about the colour temperature of the
//!     camera's own D65 white (6150–6400 K): **Cloudy**, the D65 white, as
//!     for a DNG (`raw::white_balance::ILLUMINANT_PRESETS`);
//!   - slots 2, 3 and 4 are far greener than the ladder where they cross
//!     it, the mark of a fluorescent lamp's mercury line, and order by
//!     colour temperature into the EXIF fluorescent classes (EXIF
//!     LightSource 12, 13 and 14; `dng::camera_color::illuminant_kelvin`
//!     has their ranges): slot 2, the bluest, 7600–8200 K, **Fluorescent
//!     (daylight)**; slot 3, 5000–5200 K, **Fluorescent (day white)**;
//!     slot 4, 3900–4100 K, **Fluorescent (cool white)**.
//! - **The calibration whites**, CFA sub-IFD tag 0xF00C: two groups of (G,
//!   R, B, EXIF LightSource code), codes 17 (illuminant A) and 21 (D65) on
//!   every body sampled. A is the warmest of the camera's named whites and
//!   equals its Tungsten slot; D65 is a little bluer than its Daylight.
//!
//! [`read_camera_white_balance`] checks the table's shape (the ladder's
//! order, the slots' order along it, the fluorescents' green, Tungsten
//! against illuminant A) before it trusts it: a body laid out differently
//! gets no presets rather than wrong ones.
//!
//! ## In the Photonamous recipe's units
//!
//! The menu offers each preset as the recipe's Temperature and Tint
//! relative to as shot ([`recipe_presets`]). Kelvin is a readout, a line in
//! mireds against the recipe's Temperature through the calibration whites,
//! each at its standard illuminant's colour temperature ([`kelvin_scale`]).
//! A file without the table offers no camera presets
//! (`raw::PresetSource::None`); without the calibration whites it has no
//! Kelvin (`raw::KelvinModel::None`).

use crate::dng::camera_color::{illuminant_kelvin, standard_illuminant_xy};
use crate::dng::tiff::TiffReader;

/// A white balance the camera recorded in the file.
#[derive(Clone, Debug, PartialEq)]
pub struct CameraPreset {
    /// The menu's name for it.
    pub name: &'static str,
    /// `[R, G, B]` multipliers with green 1, as the as-shot ones.
    pub multipliers: [f32; 3],
}

/// What a RAF records about white balance beyond its as-shot levels.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CameraWhiteBalance {
    /// The camera's presets, in menu order; empty when the file has no
    /// table this reader recognises.
    pub presets: Vec<CameraPreset>,
    /// The camera's whites for standard light sources: (EXIF LightSource
    /// code, `[R, G, B]` multipliers with green 1).
    pub calibration: Vec<(u16, [f32; 3])>,
}

/// The number of (G, R, B) triples in the preset table: the slots, then
/// the ladder.
const SLOTS: usize = 10;
const LADDER: usize = 37;
const TABLE: usize = SLOTS + LADDER;

/// The slots offered, in menu order: (slot, name).
const OFFERED: [(usize, &str); 6] = [
    (0, "Daylight"),
    (1, "Cloudy"),
    (5, "Tungsten"),
    (2, "Fluorescent (daylight)"),
    (3, "Fluorescent (day white)"),
    (4, "Fluorescent (cool white)"),
];

/// EXIF LightSource 17, standard illuminant A.
const ILLUMINANT_A: u16 = 17;

/// How far (log2 of the red and blue multipliers' geometric mean) a white
/// may sit off the ladder and still count as on it, and how far greener a
/// fluorescent slot must be. On the bodies sampled the natural lights are
/// within 0.03 of it and the fluorescents 0.085 or more above it.
const ON_LADDER: f32 = 0.05;
const FLUORESCENT_GREEN: f32 = 0.06;

/// The presets and calibration whites of a RAF. A file without them, or
/// whose header cannot be read, gets an empty [`CameraWhiteBalance`]: the
/// decode does not depend on them.
pub fn read_camera_white_balance(data: &[u8]) -> CameraWhiteBalance {
    let Some(sub) = cfa_sub_ifd(data) else {
        return CameraWhiteBalance::default();
    };
    let levels = |tag: u16| sub.iter().find(|e| e.tag == tag).and_then(|e| e.as_u32_vec());
    let calibration: Vec<(u16, [f32; 3])> = levels(0xF00C)
        .map(|v| {
            v.chunks_exact(4)
                .filter_map(|c| Some((u16::try_from(c[3]).ok()?, multipliers(c[0], c[1], c[2])?)))
                .collect()
        })
        .unwrap_or_default();
    let presets = levels(0xF00D)
        .and_then(|as_shot| {
            let green = u16::try_from(*as_shot.first()?).ok()?;
            let table = find_table(cfa_header_record(data, 0xC000)?, green)?;
            let tungsten = calibration.iter().find(|(code, _)| *code == ILLUMINANT_A).map(|(_, m)| *m);
            plausible(&table, tungsten).then(|| {
                OFFERED.iter().map(|&(slot, name)| CameraPreset { name, multipliers: table[slot] }).collect()
            })
        })
        .unwrap_or_default();
    CameraWhiteBalance { presets, calibration }
}

/// `[R/G, 1, B/G]` of a (G, R, B) triple of levels; `None` for a zero level.
fn multipliers(g: u32, r: u32, b: u32) -> Option<[f32; 3]> {
    (g > 0 && r > 0 && b > 0).then(|| [r as f32 / g as f32, 1.0, b as f32 / g as f32])
}

/// The Fujifilm sub-IFD (tag 0xF000) of the CFA data TIFF, as `raf::read_wb_info` finds it.
fn cfa_sub_ifd(data: &[u8]) -> Option<Vec<crate::dng::tiff::IfdEntry>> {
    let (offset, length) = (be_u32(data, 100)? as usize, be_u32(data, 104)? as usize);
    let section = data.get(offset..offset.checked_add(length)?)?;
    let reader = TiffReader::new(section).ok()?;
    let at = reader.read_ifd(0).ok()?.iter().find(|e| e.tag == 0xF000)?.as_u32()?;
    reader.read_ifd_at(at).ok()
}

/// The value of record `tag` in the CFA header (a big-endian count, then
/// tag, length, value records), as `raf::parse_cfa_header` walks it.
fn cfa_header_record(data: &[u8], tag: u16) -> Option<&[u8]> {
    let (offset, length) = (be_u32(data, 92)? as usize, be_u32(data, 96)? as usize);
    let header = data.get(offset..offset.checked_add(length)?)?;
    let count = be_u32(header, 0)?;
    let mut pos = 4usize;
    for _ in 0..count {
        let (t, len) = (be_u16(header, pos)?, be_u16(header, pos + 2)? as usize);
        let value = header.get(pos + 4..pos + 4 + len)?;
        if t == tag {
            return Some(value);
        }
        pos += 4 + len;
    }
    None
}

fn be_u32(d: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_be_bytes(d.get(o..o + 4)?.try_into().ok()?))
}

fn be_u16(d: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_be_bytes(d.get(o..o + 2)?.try_into().ok()?))
}

/// The first run of [`TABLE`] little-endian (G, R, B) triples whose green
/// is `green`, as multipliers.
fn find_table(record: &[u8], green: u16) -> Option<Vec<[f32; 3]>> {
    let le = |o: usize| u16::from_le_bytes([record[o], record[o + 1]]);
    let span = TABLE * 6;
    (0..record.len().checked_sub(span)? + 1).step_by(2).find_map(|start| {
        (0..TABLE).all(|k| le(start + 6 * k) == green).then(|| {
            (0..TABLE)
                .map(|k| multipliers(green.into(), le(start + 6 * k + 2).into(), le(start + 6 * k + 4).into()))
                .collect::<Option<Vec<_>>>()
        })?
    })
}

/// A white's place along the ladder, `log2(R/B)`, and its green level,
/// `log2 √(R·B)`: a greener light needs more red and blue gain.
fn coords(m: [f32; 3]) -> (f32, f32) {
    ((m[0] / m[2]).log2(), 0.5 * (m[0] * m[2]).log2())
}

/// How much greener than the ladder `m` is where it crosses it (`None`
/// outside the ladder).
fn green_off_ladder(ladder: &[[f32; 3]], m: [f32; 3]) -> Option<f32> {
    let (x, level) = coords(m);
    ladder.windows(2).find_map(|w| {
        let ((x0, l0), (x1, l1)) = (coords(w[0]), coords(w[1]));
        (x0 <= x && x <= x1).then(|| level - (l0 + (l1 - l0) * (x - x0) / (x1 - x0)))
    })
}

/// Whether a table has the shape the slots were identified on: the ladder
/// rises in red and falls in blue at every step; the offered slots order
/// along it as their lights do (Tungsten, cool white, Daylight, Cloudy,
/// daylight fluorescent, with day white between cool white and daylight
/// fluorescent); the natural lights sit on it and the fluorescents well
/// above it; and Tungsten is the file's illuminant A white when it has one.
fn plausible(table: &[[f32; 3]], illuminant_a: Option<[f32; 3]>) -> bool {
    let ladder = &table[SLOTS..];
    if !ladder.windows(2).all(|w| w[1][0] > w[0][0] && w[1][2] < w[0][2]) {
        return false;
    }
    let x = |slot: usize| coords(table[slot]).0;
    let ordered = x(5) < x(4) && x(4) < x(0) && x(0) < x(1) && x(1) < x(2) && x(4) < x(3) && x(3) < x(2);
    let off = |slot: usize| green_off_ladder(ladder, table[slot]);
    let natural = [0, 1, 5].iter().all(|&s| off(s).is_some_and(|g| g.abs() <= ON_LADDER));
    let fluorescent = [2, 3, 4].iter().all(|&s| off(s).is_some_and(|g| g >= FLUORESCENT_GREEN));
    let tungsten = illuminant_a.is_none_or(|a| a == table[5]);
    ordered && natural && fluorescent && tungsten
}

// ── Presets in the Photonamous recipe's units ────────────────────────

/// A preset as the Edit view's White balance menu offers it: the recipe's
/// temperature and tint (−200..200, relative to the as-shot balance, in the
/// RAW model of `develop_stats::RAW_TEMPERATURE_STOPS`), for one body.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct RecipeWbPreset {
    pub name: String,
    pub temperature: f32,
    pub tint: f32,
}

/// The recipe's (temperature, tint) whose white balance turns the as-shot
/// multipliers into `preset`'s, unclamped. Inverts the app's `wbRatioFor`.
pub fn recipe_temperature_tint(preset: [f32; 3], as_shot: [f32; 3]) -> (f32, f32) {
    use crate::develop_stats::{RAW_TEMPERATURE_STOPS, RAW_TINT_STOPS};
    let (r, g, b) = (preset[0] / as_shot[0], preset[1] / as_shot[1], preset[2] / as_shot[2]);
    let t = (r / b).log2() / (2.0 * RAW_TEMPERATURE_STOPS) * 100.0;
    let m = -(g / (r * b).sqrt()).log2() / RAW_TINT_STOPS * 100.0;
    (t, m)
}

/// The menu of the camera's presets for a frame shot at `as_shot`
/// multipliers, in menu order, clamped to Temperature and Tint's −200..200
/// and rounded.
pub fn recipe_presets(camera: &CameraWhiteBalance, as_shot: [f32; 3]) -> Vec<RecipeWbPreset> {
    let end = crate::scene_tone::WB_SLIDER_END;
    let slider = |v: f32| v.clamp(-end, end).round() + 0.0;
    camera
        .presets
        .iter()
        .map(|p| {
            let (t, m) = recipe_temperature_tint(p.multipliers, as_shot);
            RecipeWbPreset { name: p.name.to_string(), temperature: slider(t), tint: slider(m) }
        })
        .collect()
}

/// How the recipe's temperature maps to a colour temperature for display:
/// `kelvin = 1e6 / (mired_at_zero + mired_per_unit · temperature)`, and
/// back, `temperature = (1e6 / kelvin − mired_at_zero) / mired_per_unit`.
/// `as_shot_kelvin` is the value at temperature 0.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KelvinScale {
    pub mired_at_zero: f32,
    pub mired_per_unit: f32,
    pub as_shot_kelvin: f32,
}

/// The Kelvin scale for a frame shot at `as_shot`: a least-squares line of
/// mireds against the recipe temperature through the camera's calibration
/// whites, each at its CIE standard illuminant's colour temperature (A
/// 2856 K, D65 6504 K, by `dng::camera_color::illuminant_kelvin`). Raising
/// the temperature slider renders warmer, as for a cooler light, so Kelvin
/// rises with it, as in other raw editors. `None` with fewer than two
/// standard illuminants.
pub fn kelvin_scale(camera: &CameraWhiteBalance, as_shot: [f32; 3]) -> Option<KelvinScale> {
    let points: Vec<(f32, f32)> = camera
        .calibration
        .iter()
        .filter(|(code, _)| standard_illuminant_xy(*code).is_some())
        .filter_map(|&(code, m)| Some((recipe_temperature_tint(m, as_shot).0, (1e6 / illuminant_kelvin(code)?) as f32)))
        .collect();
    if points.len() < 2 {
        return None;
    }
    let n = points.len() as f32;
    let (mx, my) = (points.iter().map(|p| p.0).sum::<f32>() / n, points.iter().map(|p| p.1).sum::<f32>() / n);
    let sxx: f32 = points.iter().map(|p| (p.0 - mx) * (p.0 - mx)).sum();
    if sxx < 1e-6 {
        return None;
    }
    let slope = points.iter().map(|p| (p.0 - mx) * (p.1 - my)).sum::<f32>() / sxx;
    let at_zero = my - slope * mx;
    if at_zero <= 0.0 || slope >= 0.0 {
        return None;
    }
    Some(KelvinScale { mired_at_zero: at_zero, mired_per_unit: slope, as_shot_kelvin: 1e6 / at_zero })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The multipliers at `log2(R/B)` = `x` and green level `level`.
    fn white(x: f32, level: f32) -> [f32; 3] {
        [(level + x / 2.0).exp2(), 1.0, (level - x / 2.0).exp2()]
    }

    /// A table of the shape the reader expects, made from a formula (not
    /// any camera's numbers): a ladder from `log2(R/B)` −2 to +2 at green
    /// level 0.8, natural lights on it and fluorescents 0.15 above it.
    fn shaped_table() -> Vec<[f32; 3]> {
        let mut t = vec![
            white(0.0, 0.8),   // 0 Daylight
            white(0.3, 0.8),   // 1 Cloudy
            white(0.6, 0.95),  // 2 daylight fluorescent
            white(0.1, 0.95),  // 3 day white
            white(-0.4, 0.95), // 4 cool white
            white(-1.2, 0.8),  // 5 Tungsten
        ];
        t.extend([white(0.0, 0.8); 4]);
        t.extend((0..LADDER).map(|k| white(-2.0 + 4.0 * k as f32 / (LADDER - 1) as f32, 0.8)));
        t
    }

    #[test]
    fn a_table_of_the_expected_shape_is_trusted() {
        let t = shaped_table();
        assert!(plausible(&t, None));
        assert!(plausible(&t, Some(t[5])));
    }

    #[test]
    fn a_table_of_another_shape_is_not() {
        // Tungsten that is not the file's illuminant A white.
        let t = shaped_table();
        assert!(!plausible(&t, Some(t[0])));
        // A ladder that turns back.
        let mut bent = shaped_table();
        bent.swap(SLOTS + 3, SLOTS + 4);
        assert!(!plausible(&bent, None));
        // Slots in another order: Daylight and Tungsten swapped.
        let mut swapped = shaped_table();
        swapped.swap(0, 5);
        assert!(!plausible(&swapped, None));
        // A fluorescent slot on the ladder.
        let mut plain = shaped_table();
        plain[3] = white(0.1, 0.8);
        assert!(!plausible(&plain, None));
    }

    #[test]
    fn the_table_is_found_by_its_green_level() {
        let t = shaped_table();
        let green = 300u16;
        let mut record = vec![0u8; 10];
        for m in &t {
            for v in [green, (m[0] * green as f32).round() as u16, (m[2] * green as f32).round() as u16] {
                record.extend(v.to_le_bytes());
            }
        }
        record.extend([0u8; 6]);
        let found = find_table(&record, green).expect("found");
        assert_eq!(found.len(), TABLE);
        assert!((found[5][0] - t[5][0]).abs() < 0.01 && (found[5][2] - t[5][2]).abs() < 0.01);
        assert!(find_table(&record, green + 1).is_none());
        assert!(find_table(&record[..100], green).is_none());
    }

    #[test]
    fn a_file_that_is_not_a_raf_has_no_camera_white_balance() {
        assert_eq!(read_camera_white_balance(&[]), CameraWhiteBalance::default());
        assert_eq!(read_camera_white_balance(&[0u8; 200]), CameraWhiteBalance::default());
    }

    fn camera(presets: &[(&'static str, [f32; 3])]) -> CameraWhiteBalance {
        CameraWhiteBalance {
            presets: presets.iter().map(|&(name, multipliers)| CameraPreset { name, multipliers }).collect(),
            calibration: Vec::new(),
        }
    }

    #[test]
    fn a_preset_shot_at_is_zero_and_a_warmer_light_is_cooler() {
        let day = [1.8, 1.0, 1.8];
        let cam = camera(&[("Daylight", day), ("Tungsten", [1.2, 1.0, 2.8])]);
        let presets = recipe_presets(&cam, day);
        assert_eq!((presets[0].temperature, presets[0].tint), (0.0, 0.0));
        assert!(presets[1].temperature < -30.0, "{presets:?}");
        assert!(recipe_presets(&CameraWhiteBalance::default(), day).is_empty());
    }

    /// A preset past the old ±100 is offered at its own value up to ±200,
    /// and one past that stops at 200.
    #[test]
    fn presets_are_clamped_to_200_not_100() {
        let day = [1.8, 1.0, 1.8];
        let cam = camera(&[("Daylight", day)]);
        // Shot under a very warm light: Daylight is far warmer than as shot.
        let t = recipe_presets(&cam, [day[0] * 0.55, 1.0, day[2] * 1.8])[0].temperature;
        assert!(t > 100.0 && t < 200.0, "{t}");
        let far = recipe_presets(&cam, [day[0] * 0.2, 1.0, day[2] * 4.0])[0].temperature;
        assert_eq!(far, 200.0);
    }

    #[test]
    fn kelvin_is_fitted_through_the_standard_illuminants() {
        let (a, d65) = ([1.2, 1.0, 2.8], [2.0, 1.0, 1.6]);
        let cam = CameraWhiteBalance { presets: Vec::new(), calibration: vec![(17, a), (21, d65)] };
        let k = kelvin_scale(&cam, d65).unwrap();
        // Each white reads as its illuminant's colour temperature (by the
        // locus approximation of `cct`: within 10 K of A's 2856 K and D65's 6504 K).
        let (k_a, k_d65) = (illuminant_kelvin(17).unwrap() as f32, illuminant_kelvin(21).unwrap() as f32);
        assert!((k_a - 2856.0).abs() < 10.0 && (k_d65 - 6504.0).abs() < 10.0, "{k_a} {k_d65}");
        assert!((k.as_shot_kelvin - k_d65).abs() < 1.0, "{k:?}");
        assert!(k.mired_per_unit < 0.0, "warmer slider, higher Kelvin");
        let t_a = recipe_temperature_tint(a, d65).0;
        let kelvin = |t: f32| 1e6 / (k.mired_at_zero + k.mired_per_unit * t);
        assert!((kelvin(t_a) - k_a).abs() < 1.0, "{}", kelvin(t_a));
        let t_back = (1e6 / kelvin(30.0) - k.mired_at_zero) / k.mired_per_unit;
        assert!((t_back - 30.0).abs() < 1e-2);
        // One illuminant, or codes without a standard illuminant: no scale.
        assert!(kelvin_scale(&CameraWhiteBalance { presets: Vec::new(), calibration: vec![(17, a)] }, d65).is_none());
        assert!(kelvin_scale(&CameraWhiteBalance { presets: Vec::new(), calibration: vec![(2, a), (12, d65)] }, d65).is_none());
    }

    #[test]
    fn recipe_temperature_inverts_the_apps_white_balance() {
        // wbRatioFor(T = 40, tint = −20) up to scale.
        let (t, m) = (0.4f32, -0.2f32);
        let ratio = [(0.6 * t).exp2(), (-0.4 * m).exp2(), (-0.6 * t).exp2()];
        let as_shot = [1.8, 1.0, 1.6];
        let preset = [as_shot[0] * ratio[0], ratio[1], as_shot[2] * ratio[2]];
        let (rt, rm) = recipe_temperature_tint(preset, as_shot);
        assert!((rt - 40.0).abs() < 1e-3 && (rm + 20.0).abs() < 1e-3, "{rt} {rm}");
    }
}
