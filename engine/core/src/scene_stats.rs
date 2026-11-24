//! Auto tone from scene statistics, for the develop chain with the working
//! space. The engine reads the scene image (scene linear Rec. 2020, after
//! the RAW or input step and the photo's exposure, before the tone pass) at
//! a small size (`commands::develop::read_scene_statistics`), and
//! [`scene_statistics`] measures its luminance in stops from middle grey;
//! [`auto_tone_scene`] chooses the tone sliders from that.
//!
//! This replaces `develop_stats::auto_tone`, which works from the 8-bit
//! histogram of the displayed picture; that one stays until the app has
//! moved (`autoTone` in the wasm API), and this is `autoToneScene`.
//!
//! The choices, on the luminance percentiles `p` (stops from 0.18):
//! 1. **Exposure** brings the median to [`AUTO_MID_STOPS`], at most
//!    [`AUTO_MAX_EV`] either way, and never brightens so far that the 99th
//!    percentile goes more than [`AUTO_HIGHLIGHT_ROOM`] stops above white.
//!    Within ±0.05 EV it is left alone. It is the current exposure plus the
//!    correction: the statistics include the current exposure, so pressing
//!    Auto again converges.
//! 2. **Whites** lifts the white end so the 99th percentile (after the new
//!    exposure) reaches white when it falls short, up to +60; it is 0 when
//!    the 99th percentile is at or above white.
//! 3. **Highlights** pulls down what lies above white, in proportion to
//!    how far the 99th percentile is above it (three stops is −100), at
//!    most −60.
//! 4. **Blacks** brings the 1st percentile toward [`AUTO_BLACK_STOPS`]:
//!    deeper when the darkest tones sit above it, lifted when far below it,
//!    within −50..+30, half the way.
//! 5. **Shadows** lifts deep shadows in a wide scene: when the 5th to
//!    95th percentile spread is wider than [`AUTO_WIDE_STOPS`], by the
//!    5th percentile's depth below [`AUTO_SHADOW_STOPS`], at most +40.
//!
//! Contrast is left as it is. Whites, Highlights, Blacks and Shadows are
//! absolute: they depend on the scene before the tone pass, not on their
//! current values. Values are rounded to whole slider steps (exposure to
//! 0.05 EV).

use crate::develop_stats::ToneSettings;
use crate::scene_tone::{KNOT_STOPS, MIDDLE_GREY, SHADOWS, WHITES, WHITE_STOPS};
use crate::working_space::{luma, Gamut};

/// Floats `readSceneStatistics` returns: the share of pixels counted
/// (alpha above 0), then the 1st, 5th, 25th, 50th, 75th, 95th and 99th
/// luminance percentiles in stops from middle grey.
pub const SCENE_STATS_LEN: usize = 8;
/// The percentiles, in that order.
pub const PERCENTILES: [f32; 7] = [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99];
/// The long edge the scene image is read at.
pub const SCENE_STATS_EDGE: u32 = 256;
/// Luminance below which a pixel counts as this, in stops: 2^-20 of white.
pub const FLOOR_STOPS: f32 = -17.5;

/// Where Exposure puts the median, in stops from middle grey.
pub const AUTO_MID_STOPS: f32 = 0.0;
/// Most exposure one Auto changes, EV.
pub const AUTO_MAX_EV: f32 = 2.0;
/// How far above white Exposure may push the 99th percentile, in stops
/// (Highlights can bring back three).
pub const AUTO_HIGHLIGHT_ROOM: f32 = 2.0;
/// Where Blacks aims the 1st percentile, in stops from middle grey.
pub const AUTO_BLACK_STOPS: f32 = -5.0;
/// How far above white Highlights −100 reaches: the top knot, three stops
/// above white.
const HIGHLIGHTS_REACH: f32 = KNOT_STOPS[5] - WHITE_STOPS;
/// The 5th to 95th percentile spread above which a scene is wide.
pub const AUTO_WIDE_STOPS: f32 = 7.0;
/// Shadows lifts a wide scene's 5th percentile toward this, in stops.
pub const AUTO_SHADOW_STOPS: f32 = -3.5;

/// The statistics of straight-alpha RGBA f32 scene pixels.
pub fn scene_statistics(rgba: &[f32]) -> [f32; SCENE_STATS_LEN] {
    let w = luma(Gamut::Rec2020);
    let total = rgba.len() / 4;
    let mut stops: Vec<f32> = rgba
        .chunks_exact(4)
        .filter(|p| p[3] > 0.0)
        .map(|p| {
            let l = w[0] * p[0] + w[1] * p[1] + w[2] * p[2];
            if l > 0.0 { (l / MIDDLE_GREY).log2().max(FLOOR_STOPS) } else { FLOOR_STOPS }
        })
        .filter(|v| v.is_finite())
        .collect();
    let mut out = [0.0f32; SCENE_STATS_LEN];
    if stops.is_empty() {
        return out;
    }
    stops.sort_by(f32::total_cmp);
    out[0] = stops.len() as f32 / total.max(1) as f32;
    let last = (stops.len() - 1) as f32;
    for (k, q) in PERCENTILES.iter().enumerate() {
        let at = q * last;
        let lo = at.floor() as usize;
        let hi = (lo + 1).min(stops.len() - 1);
        let f = at - lo as f32;
        out[k + 1] = stops[lo] * (1.0 - f) + stops[hi] * f;
    }
    out
}

fn round_to(v: f32, step: f32) -> f32 {
    (v / step).round() * step
}

/// Auto tone from `stats` ([`scene_statistics`] of the scene with
/// `current`'s exposure applied). Returns new absolute settings; with no
/// pixels counted, `current` unchanged.
pub fn auto_tone_scene(stats: &[f32], current: &ToneSettings) -> ToneSettings {
    if stats.len() < SCENE_STATS_LEN || stats[0] <= 0.0 || !stats.iter().all(|v| v.is_finite()) {
        return *current;
    }
    let [p01, p05, _p25, p50, _p75, p95, p99] = [stats[1], stats[2], stats[3], stats[4], stats[5], stats[6], stats[7]];

    let mut ev = (AUTO_MID_STOPS - p50).clamp(-AUTO_MAX_EV, AUTO_MAX_EV);
    if ev > 0.0 {
        ev = ev.min((WHITE_STOPS + AUTO_HIGHLIGHT_ROOM - p99).max(0.0));
    }
    if ev.abs() < 0.05 {
        ev = 0.0;
    }
    let (p01, p05, p95, p99) = (p01 + ev, p05 + ev, p95 + ev, p99 + ev);

    // Each slider's stops at ±100 on its knot, from the tone map's own rows.
    let whites_per_100 = WHITES.pos[4];
    let shadows_per_100 = SHADOWS.pos[1];

    let whites = if p99 < WHITE_STOPS { ((WHITE_STOPS - p99) / whites_per_100 * 100.0).min(60.0) } else { 0.0 };
    let highlights = if p99 > WHITE_STOPS { -((p99 - WHITE_STOPS) / HIGHLIGHTS_REACH * 100.0).min(60.0) } else { 0.0 };
    let blacks = (0.5 * (AUTO_BLACK_STOPS - p01) / 2.0 * 100.0).clamp(-50.0, 30.0);
    let shadows = if p95 - p05 > AUTO_WIDE_STOPS && p05 < AUTO_SHADOW_STOPS {
        ((AUTO_SHADOW_STOPS - p05) / shadows_per_100 * 100.0 * 0.5).min(40.0)
    } else {
        0.0
    };
    ToneSettings {
        exposure: round_to(current.exposure + ev, 0.05),
        contrast: current.contrast,
        highlights: highlights.round(),
        shadows: shadows.round(),
        whites: whites.round(),
        blacks: blacks.round(),
    }
}

/// [`auto_tone_scene`] with the current settings as JSON (the keys of
/// `develop_stats::ToneSettings`), answering the same JSON.
pub fn auto_tone_scene_json(stats: &[f32], current_json: &str) -> Result<String, String> {
    let current: ToneSettings = if current_json.trim().is_empty() {
        ToneSettings::default()
    } else {
        serde_json::from_str(current_json).map_err(|e| format!("Tone settings: {e}"))?
    };
    serde_json::to_string(&auto_tone_scene(stats, &current)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A grey scene whose luminance runs evenly over `lo`..`hi` stops.
    fn scene(lo: f32, hi: f32) -> Vec<f32> {
        (0..1000).flat_map(|i| {
            let v = MIDDLE_GREY * (lo + (hi - lo) * i as f32 / 999.0).exp2();
            [v, v, v, 1.0]
        }).collect()
    }

    #[test]
    fn statistics_are_percentiles_in_stops() {
        let s = scene(-4.0, 4.0);
        let st = scene_statistics(&s);
        assert_eq!(st[0], 1.0);
        assert!((st[4] - 0.0).abs() < 0.02, "{st:?}");
        assert!((st[1] - -3.92).abs() < 0.02 && (st[7] - 3.92).abs() < 0.02, "{st:?}");
        let mut clear = s.clone();
        for p in clear.chunks_mut(4).take(500) {
            p[3] = 0.0;
        }
        assert!((scene_statistics(&clear)[0] - 0.5).abs() < 1e-6);
        assert_eq!(scene_statistics(&[0.0; 8]), [0.0; SCENE_STATS_LEN]);
    }

    #[test]
    fn a_dark_scene_is_brightened_toward_grey_and_converges() {
        let current = ToneSettings::default();
        // Far too dark: at most two stops at once.
        let a = auto_tone_scene(&scene_statistics(&scene(-6.0, 0.0)), &current);
        assert!((a.exposure - 2.0).abs() < 1e-6, "{a:?}");
        // A stop dark: one stop; applied, the scene is a stop brighter and
        // the next Auto keeps the exposure.
        let b = auto_tone_scene(&scene_statistics(&scene(-3.0, 1.0)), &current);
        assert!((b.exposure - 1.0).abs() < 0.051, "{b:?}");
        let c = auto_tone_scene(&scene_statistics(&scene(-2.0, 2.0)), &b);
        assert!((c.exposure - b.exposure).abs() < 1e-6, "{c:?}");
        assert_eq!((c.whites, c.blacks), (b.whites, b.blacks));
    }

    #[test]
    fn a_wide_bright_scene_gets_highlights_down_and_shadows_up() {
        let st = scene_statistics(&scene(-7.5, 5.5));
        let a = auto_tone_scene(&st, &ToneSettings::default());
        assert!(a.highlights < -30.0 && a.highlights >= -60.0, "{a:?}");
        assert!(a.shadows > 0.0 && a.shadows <= 40.0, "{a:?}");
        assert_eq!(a.whites, 0.0);
    }

    #[test]
    fn a_flat_scene_gets_whites_and_blacks_to_the_ends() {
        let st = scene_statistics(&scene(-2.0, 1.5));
        let a = auto_tone_scene(&st, &ToneSettings::default());
        assert!(a.whites > 0.0 && a.blacks < 0.0 && a.highlights == 0.0, "{a:?}");
        assert!(a.exposure.abs() < 0.3, "{a:?}");
    }

    #[test]
    fn nothing_counted_changes_nothing() {
        let current = ToneSettings { exposure: 0.5, contrast: 10.0, ..Default::default() };
        assert_eq!(auto_tone_scene(&[0.0; SCENE_STATS_LEN], &current), current);
        let json = auto_tone_scene_json(&[0.0; SCENE_STATS_LEN], r#"{"exposure":0.5}"#).unwrap();
        assert!(json.contains("\"exposure\":0.5"), "{json}");
    }
}
