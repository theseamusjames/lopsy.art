//! Statistics for the Photos develop view: the histogram of the displayed
//! result, Auto tone from it, and an auto white balance for RAW.
//!
//! The histogram is 4 × 256 `u32` bins in this order: red 0..=255, green,
//! blue, then luminance (Rec. 709 weights on the gamma-encoded 8-bit
//! values, rounded). The engine fills it from a box-downscaled copy of the
//! composite (`commands::develop::read_develop_histogram`).
//!
//! Auto tone is a heuristic, deterministic and pure; see [`auto_tone`].
//! Auto white balance is grey world in linear camera RGB; see
//! [`auto_white_balance`].

use serde::{Deserialize, Serialize};

/// Bins per channel.
pub const BINS: usize = 256;
/// Total length of a histogram: R, G, B, luminance.
pub const HISTOGRAM_LEN: usize = 4 * BINS;

/// Bin straight-alpha RGBA8 pixels. Fully transparent pixels are skipped.
pub fn histogram_from_rgba8(pixels: &[u8]) -> Vec<u32> {
    let mut h = vec![0u32; HISTOGRAM_LEN];
    for px in pixels.chunks_exact(4) {
        if px[3] == 0 {
            continue;
        }
        let (r, g, b) = (px[0], px[1], px[2]);
        h[r as usize] += 1;
        h[BINS + g as usize] += 1;
        h[2 * BINS + b as usize] += 1;
        let l = 0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32;
        h[3 * BINS + (l.round() as usize).min(255)] += 1;
    }
    h
}

/// The six tone controls of a Photos recipe, in its units: `exposure` in
/// EV, the rest −100..100. The field names are the JSON keys.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ToneSettings {
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
}

/// sRGB-encoded 0..1 → linear.
fn to_linear(v: f32) -> f32 {
    if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
}

/// Linear → sRGB-encoded 0..1.
fn to_encoded(v: f32) -> f32 {
    let v = v.max(0.0);
    if v <= 0.003_130_8 { v * 12.92 } else { 1.055 * v.powf(1.0 / 2.4) - 0.055 }
}

/// The encoded value (0..1) below which `q` of the luminance lies, with
/// linear interpolation inside the bin.
fn percentile(lum: &[u32], total: u64, q: f32) -> f32 {
    let target = q as f64 * total as f64;
    let mut acc = 0.0f64;
    for (i, &n) in lum.iter().enumerate() {
        let next = acc + n as f64;
        if next >= target && n > 0 {
            let frac = ((target - acc) / n as f64).clamp(0.0, 1.0);
            return ((i as f64 + frac) / 255.0).min(1.0) as f32;
        }
        acc = next;
    }
    1.0
}

/// Linear mid-grey the median is moved toward (about 124 of 255 encoded).
const MID_GREY: f32 = 0.2;
/// The share of the way to mid-grey one Auto moves the median.
const EXPOSURE_DAMPING: f32 = 0.5;
/// Encoded level the 99th percentile may be brightened to, no further.
const HIGHLIGHT_CEILING: f32 = 0.97;
/// Most exposure one Auto changes, EV.
const MAX_EXPOSURE_STEP: f32 = 1.0;
/// The 10th–90th percentile spread contrast keeps the image inside.
const SPREAD_MIN: f32 = 0.5;
const SPREAD_MAX: f32 = 0.85;

/// Most of the image cannot be judged from nothing: an empty histogram
/// changes nothing.
const MIN_PIXELS: u64 = 16;

/// Auto tone from the histogram of the render **with `current` applied**
/// (pass all-zero settings with a render at neutral tone, the usual case).
/// Returns new absolute settings: each is `current` plus a correction, so
/// pressing Auto again on the result converges instead of compounding.
///
/// Heuristics, all on the luminance histogram unless noted:
/// 1. **Exposure** moves the median half way to mid-grey:
///    `0.5 · log2(0.2 / median)` in linear light (0.2 is about 124/255
///    encoded). It never brightens past the point where the 99th
///    percentile would reach 0.97, moves at most ±1 EV per call, and is
///    ignored within ±0.1 EV. (Moving all the way, uncapped, set +2 EV on
///    sunny, well-exposed photos whose shadows hold the median low.)
/// 2. The rest are judged on the percentiles moved by that exposure change
///    (in linear light, then re-encoded).
/// 3. **Contrast** brings the 10th–90th percentile spread into 0.5..0.85
///    of the range: the adjustment scales around 0.5 by `1 + contrast/100`,
///    so the correction is `(target / spread − 1) · 100`, clamped to
///    −25..+25, ignored under 3.
/// 4. **Whites**: if more than 0.5 % of any channel sits in the top bin, pull
///    down by 150 per unit fraction over that (to −30); else if the 99.5th
///    percentile is below 0.92, push up toward it (to +30).
/// 5. **Blacks**: if more than 2 % of any channel sits in the bottom bin,
///    lift by 200 per unit fraction over that (to +15); else if the 0.5th
///    percentile is above 0.03, deepen (to −25).
/// 6. **Highlights**: if more than 10 % of the image is above 0.9 after the
///    exposure change (or clipped in any channel now), recover by 150 per
///    unit fraction over that (to −30).
/// 7. **Shadows**: likewise below 0.08 (or at 0 in any channel), more than
///    15 %, open by 150 per unit fraction over that (to +25).
///
/// Results are clamped to the recipe's ranges and rounded (exposure to
/// 0.01 EV, the others to whole numbers).
pub fn auto_tone(histogram: &[u32], current: &ToneSettings) -> ToneSettings {
    if histogram.len() != HISTOGRAM_LEN {
        return *current;
    }
    let lum = &histogram[3 * BINS..];
    let total: u64 = lum.iter().map(|&n| n as u64).sum();
    if total < MIN_PIXELS {
        return *current;
    }

    // 1. Exposure.
    let median = percentile(lum, total, 0.5).max(1.0 / 255.0);
    // Half way to mid-grey: a well-exposed scene's median depends on what is
    // in it (a sunny scene with deep shadows sits low), so the full distance
    // overcorrects.
    let mut delta_ev = EXPOSURE_DAMPING * (MID_GREY / to_linear(median)).log2();
    // Never brighten past the point where the 99th percentile clips.
    if delta_ev > 0.0 {
        let p99 = percentile(lum, total, 0.99);
        let room = (to_linear(HIGHLIGHT_CEILING) / to_linear(p99).max(1e-4)).log2().max(0.0);
        delta_ev = delta_ev.min(room);
    }
    delta_ev = delta_ev.clamp(-MAX_EXPOSURE_STEP, MAX_EXPOSURE_STEP);
    if delta_ev.abs() < 0.1 {
        delta_ev = 0.0;
    }
    let gain = delta_ev.exp2();
    let moved = |v: f32| to_encoded(to_linear(v) * gain).min(1.0);
    let fraction = |from: usize, to: usize| -> f32 {
        // Fraction of pixels whose moved luminance lies in [from, to) bins.
        let mut n = 0u64;
        for (i, &c) in lum.iter().enumerate() {
            let m = (moved(i as f32 / 255.0) * 255.0).round() as usize;
            if m >= from && m < to {
                n += c as u64;
            }
        }
        n as f32 / total as f32
    };

    // 3. Contrast.
    let p10 = moved(percentile(lum, total, 0.10));
    let p90 = moved(percentile(lum, total, 0.90));
    let spread = (p90 - p10).max(0.05);
    let target = spread.clamp(SPREAD_MIN, SPREAD_MAX);
    let mut contrast = ((target / spread - 1.0) * 100.0).clamp(-25.0, 25.0);
    if contrast.abs() < 3.0 {
        contrast = 0.0;
    }

    // 4. Whites. Clipping is per channel, as the render shows it now.
    let channel_top = (0..3).map(|c| histogram[c * BINS + 255] as f32 / total as f32).fold(0.0f32, f32::max);
    let p995 = moved(percentile(lum, total, 0.995));
    let whites = if channel_top > 0.005 {
        -((channel_top - 0.005) * 150.0).min(30.0)
    } else if p995 < 0.92 {
        ((0.92 - p995) / 0.3 * 100.0).min(30.0)
    } else {
        0.0
    };

    // 5. Blacks.
    let channel_bottom = (0..3).map(|c| histogram[c * BINS] as f32 / total as f32).fold(0.0f32, f32::max);
    let p005 = moved(percentile(lum, total, 0.005));
    // Deep shadows at 0 in one channel are normal in a contrasty scene: only
    // a lot of them lifts the blacks, and only a little.
    let blacks = if channel_bottom > 0.02 {
        ((channel_bottom - 0.02) * 200.0).min(15.0)
    } else if p005 > 0.03 {
        -((p005 - 0.03) / 0.15 * 100.0).min(25.0)
    } else {
        0.0
    };

    // 6. Highlights, 7. Shadows.
    // Clipped pixels stay bright whatever the exposure does.
    let bright = fraction(230, 256).max(channel_top);
    let highlights = if bright > 0.1 { -((bright - 0.1) * 150.0).min(30.0) } else { 0.0 };
    let dark = fraction(0, 21).max(channel_bottom);
    let shadows = if dark > 0.15 { ((dark - 0.15) * 150.0).min(25.0) } else { 0.0 };

    let slider = |base: f32, delta: f32| (base + delta).clamp(-100.0, 100.0).round();
    ToneSettings {
        exposure: ((current.exposure + delta_ev).clamp(-5.0, 5.0) * 100.0).round() / 100.0,
        contrast: slider(current.contrast, contrast),
        highlights: slider(current.highlights, highlights),
        shadows: slider(current.shadows, shadows),
        whites: slider(current.whites, whites),
        blacks: slider(current.blacks, blacks),
    }
}

/// `auto_tone` over JSON: `current` is `{exposure, contrast, highlights,
/// shadows, whites, blacks}` (missing keys are 0); returns the same shape.
pub fn auto_tone_json(histogram: &[u32], current_json: &str) -> Result<String, String> {
    let current: ToneSettings = if current_json.trim().is_empty() {
        ToneSettings::default()
    } else {
        serde_json::from_str(current_json).map_err(|e| format!("Tone settings: {e}"))?
    };
    serde_json::to_string(&auto_tone(histogram, &current)).map_err(|e| e.to_string())
}

/// Auto white balance of a linear camera-RGB image at its as-shot balance
/// (`rafRenderBinnedLinear` or `rafRenderLinearBand` pixels, RGBA f32):
/// `wbRatio` multipliers relative to as shot, green = 1.
///
/// Grey-world over the whole frame is fooled by any scene that is not grey
/// on average (a blue sky set Temperature +85 on a sunny photo), so this
/// averages only the **near-neutral** pixels: those whose brightest channel
/// is within `NEUTRAL_SPREAD` of their darkest once the current estimate is
/// applied, iterated three times from the as-shot balance. Pixels within
/// 5 % of the peak (clipped, or nearly) or below 1 % of it (noise) never
/// count. When fewer than 1 % of the usable pixels are near-neutral (a
/// strong cast everywhere), it falls back to grey world over all of them.
/// Each ratio is clamped to 0.25..4; with nothing usable it returns
/// `[1, 1, 1]`.
///
/// Mapping these to the Photos temperature / tint sliders is the app's
/// side of the white balance model.
pub fn auto_white_balance(linear_rgba: &[f32]) -> [f32; 3] {
    let peak = linear_rgba
        .chunks_exact(4)
        .map(|p| p[0].max(p[1]).max(p[2]))
        .filter(|v| v.is_finite())
        .fold(0.0f32, f32::max);
    if peak <= 0.0 {
        return [1.0, 1.0, 1.0];
    }
    let (hi, lo) = (0.95 * peak, 0.01 * peak);
    // A statistic over a few hundred thousand pixels is as good as over all
    // of them, and the binned preview of a 40 MP frame has 4.4 million.
    let stride = (linear_rgba.len() / 4 / AWB_SAMPLE_PIXELS).max(1);
    let usable: Vec<[f32; 3]> = linear_rgba
        .chunks_exact(4)
        .step_by(stride)
        .filter(|p| p[3] > 0.0)
        .map(|p| [p[0], p[1], p[2]])
        .filter(|c| {
            let max = c[0].max(c[1]).max(c[2]);
            let min = c[0].min(c[1]).min(c[2]);
            max.is_finite() && max < hi && min > lo
        })
        .collect();
    if usable.is_empty() {
        return [1.0, 1.0, 1.0];
    }
    let mean_ratio = |pixels: &mut dyn Iterator<Item = &[f32; 3]>| -> Option<[f32; 3]> {
        let mut sum = [0.0f64; 3];
        let mut n = 0usize;
        for c in pixels {
            for k in 0..3 {
                sum[k] += c[k] as f64;
            }
            n += 1;
        }
        (n > 0 && sum[0] > 0.0 && sum[2] > 0.0).then(|| [(sum[1] / sum[0]) as f32, 1.0, (sum[1] / sum[2]) as f32])
    };
    let mut gains = [1.0f32, 1.0, 1.0];
    let mut found = false;
    for _ in 0..3 {
        let is_neutral = |c: &&[f32; 3]| {
            let g = [c[0] * gains[0], c[1], c[2] * gains[2]];
            g[0].max(g[1]).max(g[2]) <= NEUTRAL_SPREAD * g[0].min(g[1]).min(g[2])
        };
        let count = usable.iter().filter(is_neutral).count();
        if count * 100 < usable.len() {
            break;
        }
        match mean_ratio(&mut usable.iter().filter(is_neutral)) {
            Some(r) => {
                gains = r;
                found = true;
            }
            None => break,
        }
    }
    if !found {
        gains = mean_ratio(&mut usable.iter()).unwrap_or([1.0, 1.0, 1.0]);
    }
    gains.map(|g| g.clamp(0.25, 4.0))
}

/// Pixels auto white balance looks at, at most (an even stride over the image).
pub const AWB_SAMPLE_PIXELS: usize = 500_000;

/// How far apart a near-neutral pixel's channels may be (max / min).
pub const NEUTRAL_SPREAD: f32 = 1.2;

/// The Photos app's white balance for RAW photos (`raw-develop.ts`): red
/// and blue gain 2^(±0.6·T/100), green 2^(−0.4·tint/100), in camera space.
pub const RAW_TEMPERATURE_STOPS: f32 = 0.6;
pub const RAW_TINT_STOPS: f32 = 0.4;
/// Its white balance for other photos (`recipe-to-adjustments.ts`): the same
/// shape on encoded values, through the Photo Filter, with these stops.
pub const ENCODED_TEMPERATURE_STOPS: f32 = 0.5;
pub const ENCODED_TINT_STOPS: f32 = 0.35;

/// The `[temperature, tint]` (−100..100) whose gains make the mean of
/// `rgba16` (straight RGBA u16, transparent pixels skipped) neutral, with
/// the RAW stops when `is_raw` and the encoded ones otherwise. `[0, 0]`
/// when the patch is empty or has a channel at 0. Mirrors the app's
/// `temperatureTintFor`.
pub fn neutral_temperature_tint(rgba16: &[u16], is_raw: bool) -> [f32; 2] {
    let mut sum = [0.0f64; 3];
    let mut n = 0u32;
    for p in rgba16.chunks_exact(4) {
        if p[3] == 0 {
            continue;
        }
        for c in 0..3 {
            sum[c] += p[c] as f64;
        }
        n += 1;
    }
    if n == 0 || sum.iter().any(|&v| v <= 0.0) {
        return [0.0, 0.0];
    }
    // Gains that neutralize the patch, up to scale.
    let (r, g, b) = (1.0 / sum[0], 1.0 / sum[1], 1.0 / sum[2]);
    let (ts, ms) = if is_raw {
        (RAW_TEMPERATURE_STOPS, RAW_TINT_STOPS)
    } else {
        (ENCODED_TEMPERATURE_STOPS, ENCODED_TINT_STOPS)
    };
    let t = (r / b).log2() / (2.0 * ts as f64);
    let m = -(g / (r * b).sqrt()).log2() / ms as f64;
    let slider = |v: f64| ((v * 100.0).clamp(-100.0, 100.0).round() as f32) + 0.0;
    [slider(t), slider(m)]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A histogram whose luminance (and every channel) follows `levels`:
    /// grey pixels at each listed 8-bit level, with counts.
    fn grey_histogram(levels: &[(u8, u32)]) -> Vec<u32> {
        let mut px = Vec::new();
        for &(v, n) in levels {
            for _ in 0..n {
                px.extend_from_slice(&[v, v, v, 255]);
            }
        }
        histogram_from_rgba8(&px)
    }

    /// A smooth spread of grey levels between `lo` and `hi`.
    fn ramp(lo: u8, hi: u8) -> Vec<u32> {
        let levels: Vec<(u8, u32)> = (lo..=hi).map(|v| (v, 10)).collect();
        grey_histogram(&levels)
    }

    #[test]
    fn histogram_bins_channels_and_luminance() {
        let h = histogram_from_rgba8(&[255, 0, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0]);
        assert_eq!(h.len(), 1024);
        assert_eq!(h[255], 1);
        assert_eq!(h[0], 1, "the blue pixel's red; the transparent pixel is skipped");
        assert_eq!(h[256], 2);
        assert_eq!(h[512 + 255], 1);
        assert_eq!(h[768 + 54], 1, "0.2126 · 255 = 54.2");
        assert_eq!(h[768 + 18], 1, "0.0722 · 255 = 18.4");
        assert_eq!(h.iter().sum::<u32>(), 8);
    }

    #[test]
    fn a_dark_image_is_brightened() {
        let t = auto_tone(&ramp(5, 70), &ToneSettings::default());
        assert!(t.exposure > 0.8, "{t:?}");
        assert!(t.exposure <= 2.0);
    }

    #[test]
    fn a_bright_image_is_darkened() {
        let t = auto_tone(&ramp(170, 250), &ToneSettings::default());
        assert!(t.exposure < -0.5, "{t:?}");
    }

    #[test]
    fn a_flat_image_gains_contrast_and_endpoints() {
        let t = auto_tone(&ramp(100, 150), &ToneSettings::default());
        assert!(t.exposure.abs() < 0.3, "{t:?}");
        assert!(t.contrast >= 20.0, "{t:?}");
        assert!(t.whites > 0.0 && t.blacks < 0.0, "{t:?}");
    }

    #[test]
    fn clipped_highlights_pull_whites_and_highlights_down() {
        // Mostly mid-tones, with 15 % blown to white.
        let mut levels: Vec<(u8, u32)> = (40..=200).map(|v| (v, 10)).collect();
        levels.push((255, 290));
        let t = auto_tone(&grey_histogram(&levels), &ToneSettings::default());
        assert!(t.whites < 0.0, "{t:?}");
        assert!(t.highlights < 0.0, "{t:?}");
    }

    #[test]
    fn crushed_shadows_lift_blacks_and_shadows() {
        let mut levels: Vec<(u8, u32)> = (60..=230).map(|v| (v, 10)).collect();
        levels.push((0, 400));
        let t = auto_tone(&grey_histogram(&levels), &ToneSettings::default());
        assert!(t.shadows > 0.0, "{t:?}");
    }

    #[test]
    fn a_well_exposed_image_is_left_nearly_alone() {
        let t = auto_tone(&ramp(8, 248), &ToneSettings::default());
        assert!(t.exposure.abs() <= 0.15, "{t:?}");
        assert!(t.contrast.abs() <= 10.0 && t.whites.abs() <= 10.0 && t.blacks.abs() <= 10.0, "{t:?}");
        assert_eq!(t.highlights, 0.0);
    }

    #[test]
    fn corrections_add_to_the_current_settings_and_stay_in_range() {
        let current = ToneSettings { exposure: 4.5, contrast: 90.0, ..Default::default() };
        let t = auto_tone(&ramp(5, 40), &current);
        assert!(t.exposure <= 5.0 && t.contrast <= 100.0, "{t:?}");
        assert!(t.exposure > 4.5);
    }

    #[test]
    fn auto_tone_is_deterministic_and_ignores_bad_input() {
        let h = ramp(30, 120);
        assert_eq!(auto_tone(&h, &ToneSettings::default()), auto_tone(&h, &ToneSettings::default()));
        let current = ToneSettings { exposure: 0.3, ..Default::default() };
        assert_eq!(auto_tone(&[0; 1024], &current), current);
        assert_eq!(auto_tone(&[1; 10], &current), current);
    }

    #[test]
    fn auto_tone_json_round_trips() {
        let json = auto_tone_json(&ramp(5, 70), r#"{"exposure":0.5}"#).unwrap();
        let t: ToneSettings = serde_json::from_str(&json).unwrap();
        assert!(t.exposure > 0.5);
        for key in ["exposure", "contrast", "highlights", "shadows", "whites", "blacks"] {
            assert!(json.contains(key), "{json}");
        }
        assert!(auto_tone_json(&ramp(5, 70), "").is_ok());
        assert!(auto_tone_json(&ramp(5, 70), "{").is_err());
    }

    #[test]
    fn the_picker_inverts_the_apps_white_balance() {
        // A patch the app's RAW white balance at T = 40, tint = −20 would
        // make neutral: its inverse gains.
        let (t, m) = (0.4f64, -0.2f64);
        let gains = [(0.6 * t).exp2(), (-0.4 * m).exp2(), (-0.6 * t).exp2()];
        let px: Vec<u16> = (0..9).flat_map(|_| [(30000.0 / gains[0]) as u16, (30000.0 / gains[1]) as u16, (30000.0 / gains[2]) as u16, 65535]).collect();
        assert_eq!(neutral_temperature_tint(&px, true), [40.0, -20.0]);
        let grey = [20000u16, 20000, 20000, 65535];
        assert_eq!(neutral_temperature_tint(&grey, true), [0.0, 0.0]);
        assert_eq!(neutral_temperature_tint(&grey, false), [0.0, 0.0]);
        // A blue cast asks for warmth; a green cast for magenta.
        let blue = [10000u16, 15000, 30000, 65535];
        assert!(neutral_temperature_tint(&blue, false)[0] > 0.0);
        let green = [15000u16, 30000, 15000, 65535];
        assert!(neutral_temperature_tint(&green, true)[1] > 0.0);
        assert_eq!(neutral_temperature_tint(&[0, 5, 5, 65535], true), [0.0, 0.0]);
        assert_eq!(neutral_temperature_tint(&[5, 5, 5, 0], true), [0.0, 0.0]);
    }

    #[test]
    fn a_blue_sky_does_not_pull_the_white_balance() {
        // 70 % blue sky, 30 % neutral grey at the as-shot balance.
        let mut px = Vec::new();
        for i in 0..1000 {
            let g = 0.1 + 0.3 * (i % 10) as f32 / 10.0;
            if i % 10 < 7 {
                px.extend_from_slice(&[0.4 * g, 0.7 * g, 1.2 * g, 1.0]);
            } else {
                px.extend_from_slice(&[g, g, g, 1.0]);
            }
        }
        let wb = auto_white_balance(&px);
        assert!(wb.iter().all(|v| (v - 1.0).abs() < 0.02), "{wb:?}");
    }

    #[test]
    fn grey_world_neutralizes_a_cast() {
        // A warm cast: red 1.3x, blue 0.7x of green, over a range of levels.
        let px: Vec<f32> = (1..100).flat_map(|i| {
            let g = i as f32 / 100.0;
            [1.3 * g * 0.5, g * 0.5, 0.7 * g * 0.5, 1.0]
        }).collect();
        let wb = auto_white_balance(&px);
        assert!((wb[0] - 1.0 / 1.3).abs() < 1e-3 && wb[1] == 1.0 && (wb[2] - 1.0 / 0.7).abs() < 1e-3, "{wb:?}");
        assert_eq!(auto_white_balance(&[]), [1.0, 1.0, 1.0]);
        assert_eq!(auto_white_balance(&[0.0, 0.0, 0.0, 1.0]), [1.0, 1.0, 1.0]);
    }
}
