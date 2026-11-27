//! The proof-of-concept RAW develop split: decode RAF to linear camera RGB
//! on the CPU, and leave the look to a GPU develop stage.
//!
//! `render_rgb` bakes everything into the decode: demosaic → camera matrix
//! → chroma denoise → film-sim saturation → 1.3× exposure → highlight
//! desaturation → base curve → sRGB gamma → capture sharpening → clamp. Once
//! that has run, white balance and exposure cannot be changed. This module
//! stops the decode earlier:
//!
//! - [`render_linear_band`] renders a band to oriented RGBA f32 in **camera
//!   RGB**, at the as-shot white balance (already applied to the mosaic by
//!   `prepare_raf`), demosaiced, not clamped (below black stays negative),
//!   with clipped channels reconstructed before the demosaic
//!   (`super::highlights`), and with no matrix, curve, gamma or sharpening. It keeps `render_band`'s banding contract: a band is
//!   bit-identical to the same rows of a whole-frame [`render_linear_rgb`].
//! - [`develop_defaults`] returns the [`RawDevelopSettings`] that reproduce
//!   today's look on the GPU (`engine/src/gpu/shaders/develop/raw_develop.wgsl`):
//!   the neutralized cam→sRGB matrix, the film-sim saturation, the 1.3×
//!   boost as a baseline EV, highlight desaturation and the base-curve LUT.
//! - [`develop_reference`] is that GPU stage's maths on the CPU, for tests.
//! - [`scene_reference`] is the same stage with the develop working space
//!   on (`crate::working_space`): white balance, [`cam_to_working`] and
//!   exposure only, to unclamped scene data in linear Rec. 2020. The rest
//!   of the look moves to the tone step ([`tone_settings`], `crate::tone`).
//!
//! **Chroma denoise.** Today's denoise median-filters chroma *after* the
//! camera matrix. A median does not commute with a matrix, so filtering in
//! camera space would only approximate it. The linear render instead
//! applies the as-shot matrix, denoises exactly as `render_rgb` does, and
//! maps back to camera RGB with the inverse matrix. Developed with the
//! default settings, the result matches `render_rgb` (without sharpening) to
//! float rounding. With a user white balance (`wbRatio` ≠ 1) the denoise
//! was done at the as-shot balance — an approximation, invisible at radius 1.
//!
//! **Stage order.** The GPU applies: `wbRatio` → matrix → exposure →
//! saturation → highlight desaturation → base curve → sRGB transfer.
//! Saturation is linear, so it commutes with exposure; it must come before
//! highlight desaturation because that is what `render_rgb` does (the boost
//! can push a channel over 1.0, which desaturation then neutralizes).
//! Capture sharpening is not reproduced; the Photonamous pipeline will add it as
//! its default sharpening.
//!
//! **What the full pipeline (spec 6.10) changes.** This is stages 2–4 and 8–9
//! squeezed into one pass in display-referred sRGB primaries. The real
//! pipeline works in linear Rec. 2020 with no clamp until the output
//! transform, derives the camera→working matrix from the white balance by
//! interpolating two calibration illuminants (DNG method, temperature and
//! tint in kelvin), turns the base curve and saturation into profiles,
//! moves the denoise to its own stage and caches stage outputs. Clipped
//! channels are already reconstructed here, before the profile, and each
//! channel's clip level is recorded (`RafRenderParams::clip_levels`).

use serde::{Deserialize, Serialize};

use super::{base_curves, check_band, demosaic_rgb, denoise_chroma, orient_band, RafBand, RafBandPixels, RafRenderParams};
use crate::dng::color;

/// How far (in rows) a linear output pixel reaches into the mosaic: the
/// highlight reconstruction's window, the demosaic and the separable chroma
/// median of radius 1. No sharpening.
pub const LINEAR_REACH_ROWS: u32 = super::highlights::REACH_ROWS + super::markesteijn::REACH as u32 + 1;

// The linear render reuses `render_band`'s halo, so it must be enough.
const _: () = assert!(LINEAR_REACH_ROWS <= super::BAND_HALO_ROWS);

/// The 1.3× exposure boost `render_rgb` applies, as a baseline EV.
pub fn baseline_exposure_ev() -> f32 {
    1.3f32.log2()
}

/// What the GPU develop stage needs, in the JSON shape `setRawDevelop`
/// takes. Every field but `baseCurve` is required.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawDevelopSettings {
    /// Per-channel multipliers in camera RGB, relative to the as-shot white
    /// balance: `[1, 1, 1]` is as shot.
    pub wb_ratio: [f32; 3],
    /// Camera RGB → linear sRGB, row-major, neutralized (a neutral camera
    /// value maps to a neutral output).
    pub cam_to_rgb: [f32; 9],
    /// Total exposure in EV: the baseline plus the user's adjustment.
    pub exposure_ev: f32,
    /// Luma-preserving (Rec. 709) saturation factor; 1 leaves colour alone.
    pub saturation: f32,
    /// Blend channels above 1.0 toward their maximum, as `render_rgb` does.
    pub highlight_desaturation: bool,
    /// Tone curve on linear luminance, sampled at evenly spaced inputs over
    /// 0..1 (at least 2 entries); `None` for no curve.
    #[serde(default)]
    pub base_curve: Option<Vec<f32>>,
    /// The photo's clip level per channel (R, G, B) in linear camera RGB at
    /// the as-shot white balance, as `RafRenderParams::clip_levels`: the
    /// white balance picker skips a pixel with any channel at or near its
    /// level. Optional; absent, the picker measures every pixel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip_levels: Option<[f32; 3]>,
}

/// The defaults are what reproduces today's import.
pub type RawDevelopDefaults = RawDevelopSettings;

/// The settings that reproduce `render_rgb` (minus capture sharpening) for
/// an image prepared with `params`.
pub fn develop_defaults(params: &RafRenderParams) -> RawDevelopDefaults {
    let curve = base_curves::curve_for_film_mode(params.film_mode);
    RawDevelopSettings {
        wb_ratio: [1.0, 1.0, 1.0],
        cam_to_rgb: params.cam_to_srgb,
        exposure_ev: baseline_exposure_ev(),
        saturation: base_curves::saturation_for_film_mode(params.film_mode),
        highlight_desaturation: true,
        base_curve: Some(base_curves::curve_lut(curve).to_vec()),
        clip_levels: params.clip_levels,
    }
}

/// What a profile sets: every `setRawDevelop` field except `wbRatio`.
/// `exposureEv` is the baseline; the app adds the user's exposure to it and
/// supplies `wbRatio` before passing the result to `setRawDevelop`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSettings {
    pub cam_to_rgb: [f32; 9],
    pub exposure_ev: f32,
    pub saturation: f32,
    pub highlight_desaturation: bool,
    pub base_curve: Option<Vec<f32>>,
}

/// One entry of the Profile control, for every format (RAF's list here,
/// DNG and ARW's in `raw::standard_profiles`). The menu needs nothing but
/// these fields: list the entries whose `listed` is true, in order, under
/// `menuName`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevelopProfile {
    /// Stable id: `camera`, `provia`, `velvia`, `astia`, `classic-chrome`,
    /// `pro-neg`, `neutral`, `monochrome`.
    pub id: String,
    /// The entry's own name (a RAF look's "Velvia look"; the camera entry's
    /// "Camera (Velvia look)").
    pub name: String,
    pub settings: ProfileSettings,
    /// What the entry is.
    #[serde(default)]
    pub role: ProfileRole,
    /// The name the menu shows, as given: `name`, or `name` with the
    /// maker's standard noted ("Standard (Provia look)", "Camera (Provia
    /// look, Standard)").
    #[serde(default)]
    pub menu_name: String,
    /// Whether the menu lists the entry: false for a look the camera entry
    /// already is (`sameAs`), so it is not listed twice.
    #[serde(default = "listed_by_default")]
    pub listed: bool,
    /// For the `camera` entry, the id of the look entry it is (a RAF's
    /// recorded film simulation, `velvia`); `null` otherwise, and for a
    /// format whose camera entry is no other entry.
    #[serde(default)]
    pub same_as: Option<String>,
    /// Whether the entry is, or (the camera entry) stands for, the maker's
    /// standard look: Fujifilm's Provia; for DNG and ARW, Standard.
    #[serde(default)]
    pub maker_standard: bool,
}

fn listed_by_default() -> bool {
    true
}

/// What a Profile entry is.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRole {
    /// The look the file opens with, first in the list; the app's recipe
    /// default (`standard`).
    Camera,
    /// A maker's look to choose instead (RAF's film looks).
    #[default]
    Look,
    /// Near-linear, no added saturation: a flat start for grading.
    Neutral,
    /// No colour.
    Monochrome,
}

/// The Fujifilm looks, by the FilmMode makernote value that selects their
/// curve and saturation in `base_curves`. They are approximations of the
/// camera's film simulations (a tone curve and a saturation factor), not
/// Fujifilm's own processing, and the names say so.
/// The film look Fujifilm calls its Standard.
const STANDARD_LOOK: &str = "provia";

const FILM_LOOKS: [(&str, &str, u16); 5] = [
    ("provia", "Provia look", 0x000),
    ("velvia", "Velvia look", 0x200),
    ("astia", "Astia look", 0x100),
    ("classic-chrome", "Classic Chrome look", 0x600),
    ("pro-neg", "Pro Neg look", 0x500),
];

fn profile_settings(params: &RafRenderParams, curve: &base_curves::BaseCurve, saturation: f32) -> ProfileSettings {
    ProfileSettings {
        cam_to_rgb: params.cam_to_srgb,
        exposure_ev: baseline_exposure_ev(),
        saturation,
        highlight_desaturation: true,
        base_curve: Some(base_curves::curve_lut(curve).to_vec()),
    }
}

/// The profiles of the Edit view's Profile control for an image prepared
/// with `params`, in display order:
/// - `camera`: the film simulation the camera recorded, which is today's
///   import look and exactly `develop_defaults` without `wbRatio`;
/// - each Fujifilm look `base_curves` defines (Provia, Velvia, Astia,
///   Classic Chrome, Pro Neg);
/// - `neutral`: no film-sim saturation and the gentle `NEUTRAL` curve, a
///   starting point for grading;
/// - `monochrome`: saturation 0 with the neutral curve.
pub fn develop_profiles(params: &RafRenderParams) -> Vec<DevelopProfile> {
    // The recorded mode's look is the one with the same curve and saturation
    // (Velvia's two codes, Astia's family and both Pro Negs each share one).
    let same_look = |a: Option<u16>, b: Option<u16>| {
        base_curves::curve_for_film_mode(a).name == base_curves::curve_for_film_mode(b).name
            && base_curves::saturation_for_film_mode(a) == base_curves::saturation_for_film_mode(b)
    };
    let recorded = params.film_mode.and_then(|m| FILM_LOOKS.iter().find(|look| same_look(Some(m), Some(look.2))));
    let camera_name = match recorded {
        Some(look) => format!("Camera ({})", look.1),
        None => "Camera".to_string(),
    };
    let defaults = develop_defaults(params);
    let recorded_standard = recorded.is_some_and(|look| look.0 == STANDARD_LOOK);
    let camera_menu_name = match recorded {
        Some(look) if recorded_standard => format!("Camera ({}, Standard)", look.1),
        _ => camera_name.clone(),
    };
    let mut out = vec![DevelopProfile {
        id: "camera".to_string(),
        name: camera_name,
        settings: ProfileSettings {
            cam_to_rgb: defaults.cam_to_rgb,
            exposure_ev: defaults.exposure_ev,
            saturation: defaults.saturation,
            highlight_desaturation: defaults.highlight_desaturation,
            base_curve: defaults.base_curve,
        },
        role: ProfileRole::Camera,
        menu_name: camera_menu_name,
        listed: true,
        same_as: recorded.map(|look| look.0.to_string()),
        maker_standard: recorded_standard,
    }];
    for (id, name, mode) in FILM_LOOKS {
        let standard = id == STANDARD_LOOK;
        out.push(DevelopProfile {
            id: id.to_string(),
            name: name.to_string(),
            settings: profile_settings(
                params,
                base_curves::curve_for_film_mode(Some(mode)),
                base_curves::saturation_for_film_mode(Some(mode)),
            ),
            role: ProfileRole::Look,
            menu_name: if standard { format!("Standard ({name})") } else { name.to_string() },
            listed: recorded.is_none_or(|look| look.0 != id),
            same_as: None,
            maker_standard: standard,
        });
    }
    let plain = |id: &str, name: &str, role: ProfileRole, saturation: f32| DevelopProfile {
        id: id.to_string(),
        name: name.to_string(),
        settings: profile_settings(params, &base_curves::NEUTRAL, saturation),
        role,
        menu_name: name.to_string(),
        listed: true,
        same_as: None,
        maker_standard: false,
    };
    out.push(plain("neutral", "Neutral", ProfileRole::Neutral, 1.0));
    out.push(plain("monochrome", "Monochrome", ProfileRole::Monochrome, 0.0));
    out
}

/// Demosaic a white-balanced mosaic of `w`×`h` (first row at CFA phase 0)
/// to interleaved linear camera RGB, chroma-denoised (see the module notes)
/// and unclamped. Each output pixel depends only on mosaic pixels within
/// `LINEAR_REACH_ROWS`.
pub fn render_linear_rgb(mosaic: &[f32], w: usize, h: usize, params: &RafRenderParams) -> Vec<f32> {
    render_linear_rgb_at(mosaic, w, h, 0, params)
}

/// [`render_linear_rgb`] of `h` mosaic rows that start at frame row
/// `y_offset` (a multiple of the CFA period): clipped channels are
/// reconstructed first (`super::highlights`), with the chroma at the rows'
/// place in the frame.
fn render_linear_rgb_at(mosaic: &[f32], w: usize, h: usize, y_offset: usize, params: &RafRenderParams) -> Vec<f32> {
    let reconstructed = params.highlight_chroma.as_ref().and_then(|grid| {
        let (p, cfa) = cfa_period_and_pattern(params);
        grid.reconstruct(mosaic, w, h, y_offset, &cfa, p)
    });
    let mosaic = reconstructed.as_deref().unwrap_or(mosaic);
    let mut rgb = demosaic_rgb(mosaic, w, h, params);
    if params.denoise {
        if let Some(inverse) = invert_3x3(&params.cam_to_srgb) {
            color::apply_matrix(&mut rgb, &params.cam_to_srgb);
            denoise_chroma(&mut rgb, w, h);
            color::apply_matrix(&mut rgb, &inverse);
        } else {
            denoise_chroma(&mut rgb, w, h);
        }
    }
    rgb
}

/// Render one band to linear camera RGB. `src` holds mosaic rows
/// `[band.src_y0, band.src_y1)`, exactly as for `render_band`. The result is
/// oriented RGBA f32 (alpha 1), unclamped, and bit-identical to the same
/// rows of a whole-frame [`render_linear_rgb`].
pub fn render_linear_band(src: &[f32], params: &RafRenderParams, band: RafBand) -> Result<RafBandPixels, String> {
    let src_h = check_band(src, params, band)?;
    let rgb = render_linear_rgb_at(src, params.width as usize, src_h, band.src_y0 as usize, params);
    Ok(orient_band(rgb, params, band, false))
}

/// The GPU develop stage on the CPU: straight-alpha RGBA in linear camera
/// RGB to gamma-encoded sRGB RGBA, alpha untouched, negatives clamped to 0,
/// values above 1 kept. For tests; the shader is the implementation.
pub fn develop_reference(linear_rgba: &[f32], settings: &RawDevelopSettings) -> Vec<f32> {
    let mut rgb: Vec<f32> = Vec::with_capacity(linear_rgba.len() / 4 * 3);
    for px in linear_rgba.chunks_exact(4) {
        rgb.extend_from_slice(&[
            px[0] * settings.wb_ratio[0],
            px[1] * settings.wb_ratio[1],
            px[2] * settings.wb_ratio[2],
        ]);
    }
    color::apply_matrix(&mut rgb, &settings.cam_to_rgb);
    let gain = settings.exposure_ev.exp2();
    for v in rgb.iter_mut() {
        *v *= gain;
    }
    super::apply_saturation(&mut rgb, settings.saturation);
    if settings.highlight_desaturation {
        super::desaturate_highlights(&mut rgb);
    }
    if let Some(lut) = settings.base_curve.as_deref().filter(|l| l.len() >= 2) {
        color::apply_lut(&mut rgb, lut);
    }
    color::apply_srgb_gamma(&mut rgb);

    let mut out = Vec::with_capacity(linear_rgba.len());
    for (c, px) in rgb.chunks_exact(3).zip(linear_rgba.chunks_exact(4)) {
        out.extend_from_slice(&[c[0], c[1], c[2], px[3]]);
    }
    out
}

/// The camera matrix of the working space: `cam_to_rgb` (camera RGB to
/// linear sRGB) followed by sRGB to Rec. 2020, row-major, so the RAW step
/// lands in linear Rec. 2020 and colours outside sRGB are kept.
pub fn cam_to_working(settings: &RawDevelopSettings) -> [f32; 9] {
    use crate::working_space::{conversion, Gamut};
    let s = conversion(Gamut::Srgb, Gamut::Rec2020);
    let m = &settings.cam_to_rgb;
    std::array::from_fn(|i| {
        let (r, c) = (i / 3, i % 3);
        (0..3).map(|k| f64::from(s[r * 3 + k]) * f64::from(m[k * 3 + c])).sum::<f64>() as f32
    })
}

/// The RAW step with the working space on (`crate::working_space`), on the
/// CPU: straight-alpha RGBA in linear camera RGB to scene linear Rec. 2020,
/// through white balance, [`cam_to_working`] and exposure only. Nothing is
/// clamped and alpha is untouched; saturation, highlight desaturation and
/// the base curve are the tone step's (`crate::tone`).
pub fn scene_reference(linear_rgba: &[f32], settings: &RawDevelopSettings) -> Vec<f32> {
    let m = cam_to_working(settings);
    let gain = settings.exposure_ev.exp2();
    crate::working_space::map_rgb(linear_rgba, |c| {
        let balanced = [c[0] * settings.wb_ratio[0], c[1] * settings.wb_ratio[1], c[2] * settings.wb_ratio[2]];
        crate::working_space::apply(&m, balanced).map(|v| v * gain)
    })
}

/// The settings of the tone step that follows [`scene_reference`].
pub fn tone_settings(settings: &RawDevelopSettings) -> crate::tone::ToneSettings<'_> {
    crate::tone::ToneSettings {
        saturation: settings.saturation,
        // Clipped channels are reconstructed in the decode, so highlights
        // keep their hue and the curve's shoulder and the output step's
        // roll-off take them to white; greying them out would undo that.
        highlight_desaturation: false,
        curve: settings.base_curve.as_deref().filter(|c| c.len() >= 2),
    }
}

// ── Binned preview (spec E7) ─────────────────────────────────────────
//
// A demosaic of a 40 MP X-Trans frame takes seconds. For a first view the
// mosaic is binned instead: the frame is cut into `factor`×`factor` blocks
// and each output pixel is, per colour, the mean of that colour's own
// samples in its block. No interpolation, no demosaic, no denoise. The
// mosaic already carries the as-shot white balance, so the result is in the
// same camera RGB and scale as `render_linear_band`, and the same develop
// settings render it the same way, up to resolution.
//
// A factor is valid when it bins whole pattern units and every block holds
// every colour. Bayer: any even factor (a 2×2 superpixel has 1 R, 2 G, 1 B). X-Trans: 3 works when the
// blocks fall on the pattern's 3×3 halves, each of which holds 2 R, 5 G and
// 2 B (true for the phase `prepare_raf` aligns to row and column 0, and
// checked rather than assumed); 6 (a whole period: 8 R, 20 G, 8 B) always
// works. The colour samples of a block sit at slightly different centroids
// and each colour is sampled sparsely, so fine detail aliases into colour
// fringes at edges: fine for a preview, not a decode. (Estimating red and
// blue as green plus a colour difference cut that error by about a fifth
// on a real 40 MP frame but took three times as long; not worth it here.)
// Rows and columns past the last whole block are dropped (fewer than
// `factor` of each).

/// Largest factor `binned_factor_for` considers.
const MAX_BIN_FACTOR: u32 = 24;

fn cfa_period_and_pattern(params: &RafRenderParams) -> (usize, Vec<u8>) {
    if params.is_xtrans && params.cfa.len() == 36 {
        (6, params.cfa.clone())
    } else {
        (2, params.cfa.iter().take(4).copied().collect())
    }
}

/// Whether every `factor`×`factor` block of the frame holds every colour.
pub fn is_valid_bin_factor(params: &RafRenderParams, factor: u32) -> bool {
    let (p, cfa) = cfa_period_and_pattern(params);
    // Whole periods or, for X-Trans, whole 3×3 halves of one: a block of
    // any other size would hold different colour counts from block to block.
    let unit = if p == 6 { 3 } else { 2 };
    if factor < 2 || factor % unit != 0 {
        return false;
    }
    if cfa.len() != p * p {
        return false;
    }
    let f = factor as usize;
    // Block origins fall on phases k·f mod p; check each such block.
    let phases: Vec<usize> = (0..p).map(|k| (k * f) % p).collect();
    phases.iter().all(|&py| {
        phases.iter().all(|&px| {
            let mut seen = [false; 3];
            for dy in 0..f {
                for dx in 0..f {
                    let c = cfa[((py + dy) % p) * p + (px + dx) % p] as usize;
                    if c < 3 {
                        seen[c] = true;
                    }
                }
            }
            seen.iter().all(|&s| s)
        })
    })
}

/// The coarsest valid factor whose binned image still has a long edge of
/// at least `min_long_edge` (oriented or not, the long edge is the same).
/// When even the finest valid factor falls short, that finest factor.
pub fn binned_factor_for(params: &RafRenderParams, min_long_edge: u32) -> u32 {
    let long = params.width.max(params.height);
    let valid: Vec<u32> = (2..=MAX_BIN_FACTOR).filter(|&f| is_valid_bin_factor(params, f)).collect();
    valid
        .iter()
        .copied()
        .filter(|&f| long / f >= min_long_edge)
        .max()
        .or_else(|| valid.first().copied())
        .unwrap_or(6)
}

/// Bin the whole white-balanced mosaic (`params.width`×`params.height`) by
/// `factor`: oriented RGBA f32 in linear camera RGB (alpha 1, unclamped)
/// at `floor(width / factor)`×`floor(height / factor)` before orientation.
/// Returns (width, height, pixels) after orientation.
pub fn render_binned_linear(mosaic: &[f32], params: &RafRenderParams, factor: u32) -> Result<(u32, u32, Vec<f32>), String> {
    let (w, h) = (params.width as usize, params.height as usize);
    if mosaic.len() != w * h {
        return Err(format!("RAF mosaic has {} values, expected {}", mosaic.len(), w * h));
    }
    if !is_valid_bin_factor(params, factor) {
        return Err(format!("Bin factor {factor} leaves a colour out of some blocks of this CFA"));
    }
    let (p, cfa) = cfa_period_and_pattern(params);
    let f = factor as usize;
    let (bw, bh) = (w / f, h / f);
    if bw == 0 || bh == 0 {
        return Err(format!("A {w}×{h} frame is smaller than one {f}×{f} block"));
    }

    // Each block's colour counts depend only on its origin's CFA phase.
    let mut inv_counts = vec![[0.0f32; 3]; p * p];
    for py in 0..p {
        for px in 0..p {
            let mut n = [0u32; 3];
            for dy in 0..f {
                for dx in 0..f {
                    n[cfa[((py + dy) % p) * p + (px + dx) % p] as usize % 3] += 1;
                }
            }
            inv_counts[py * p + px] = n.map(|c| if c > 0 { 1.0 / c as f32 } else { 0.0 });
        }
    }

    // Each sample's colour by row phase and column, looked up rather than
    // recomputed with two remainders per sample.
    let colour_rows: Vec<Vec<u8>> =
        (0..p).map(|py| (0..bw * f).map(|x| cfa[py * p + x % p] % 3).collect()).collect();
    // A sample near its clip level is reconstructed exactly as the full
    // render reconstructs it before demosaicing, so the two agree.
    let grid = params.highlight_chroma.as_ref();
    let thresholds = grid.map_or([f32::INFINITY; 3], |g| g.thresholds());
    let mut rgba = vec![0.0f32; bw * bh * 4];
    let mut sums = vec![[0.0f32; 3]; bw];
    for by in 0..bh {
        sums.iter_mut().for_each(|s| *s = [0.0; 3]);
        for dy in 0..f {
            let row = by * f + dy;
            let line = &mosaic[row * w..row * w + bw * f];
            let colours = &colour_rows[row % p];
            for (bx, ((sum, samples), cols)) in sums.iter_mut().zip(line.chunks_exact(f)).zip(colours.chunks_exact(f)).enumerate() {
                for (i, (&v, &c)) in samples.iter().zip(cols).enumerate() {
                    let v = match grid {
                        Some(g) if v >= thresholds[c as usize] => g.sample(mosaic, w, h, bx * f + i, row, 0, &cfa, p),
                        _ => v,
                    };
                    sum[c as usize] += v;
                }
            }
        }
        let py = (by * f) % p;
        for (bx, sum) in sums.iter().enumerate() {
            let inv = inv_counts[py * p + (bx * f) % p];
            let o = (by * bw + bx) * 4;
            rgba[o] = sum[0] * inv[0];
            rgba[o + 1] = sum[1] * inv[1];
            rgba[o + 2] = sum[2] * inv[2];
            rgba[o + 3] = 1.0;
        }
    }
    Ok(crate::orientation::apply_exif_orientation_owned(bw as u32, bh as u32, rgba, params.orientation))
}

/// The binned preview of the whole frame with the factor
/// `binned_factor_for(params, min_long_edge)` picks. Returns (width, height,
/// pixels) after orientation.
pub fn render_binned_linear_for(
    mosaic: &[f32],
    params: &RafRenderParams,
    min_long_edge: u32,
) -> Result<(u32, u32, Vec<f32>), String> {
    render_binned_linear(mosaic, params, binned_factor_for(params, min_long_edge))
}

fn invert_3x3(m: &[f32; 9]) -> Option<[f32; 9]> {
    let m: [f64; 9] = m.map(f64::from);
    let c00 = m[4] * m[8] - m[5] * m[7];
    let c01 = m[5] * m[6] - m[3] * m[8];
    let c02 = m[3] * m[7] - m[4] * m[6];
    let det = m[0] * c00 + m[1] * c01 + m[2] * c02;
    if det.abs() < 1e-12 {
        return None;
    }
    let inv = [
        c00,
        m[2] * m[7] - m[1] * m[8],
        m[1] * m[5] - m[2] * m[4],
        c01,
        m[0] * m[8] - m[2] * m[6],
        m[2] * m[3] - m[0] * m[5],
        c02,
        m[1] * m[6] - m[0] * m[7],
        m[0] * m[4] - m[1] * m[3],
    ];
    Some(inv.map(|v| (v / det) as f32))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params_with_film_mode(film_mode: Option<u16>) -> RafRenderParams {
        RafRenderParams {
            width: 12,
            height: 12,
            cfa: vec![1; 36],
            is_xtrans: true,
            demosaic: super::super::DemosaicMode::Markesteijn,
            denoise: true,
            cam_to_srgb: [1.71, -0.62, -0.09, -0.21, 1.48, -0.27, 0.04, -0.47, 1.43],
            film_mode,
            orientation: 1,
            white_level: 16383,
            clip_levels: None,
            highlight_chroma: None,
        }
    }

    fn with_wb(p: &ProfileSettings) -> RawDevelopSettings {
        RawDevelopSettings {
            wb_ratio: [1.0, 1.0, 1.0],
            cam_to_rgb: p.cam_to_rgb,
            exposure_ev: p.exposure_ev,
            saturation: p.saturation,
            highlight_desaturation: p.highlight_desaturation,
            base_curve: p.base_curve.clone(),
            clip_levels: None,
        }
    }

    #[test]
    fn the_camera_profile_is_the_import_default() {
        for mode in [None, Some(0x000), Some(0x200), Some(0x400), Some(0x600), Some(0x501), Some(0x777)] {
            let params = params_with_film_mode(mode);
            let profiles = develop_profiles(&params);
            assert_eq!(profiles[0].id, "camera");
            assert_eq!(with_wb(&profiles[0].settings), develop_defaults(&params), "{mode:?}");
        }
        assert_eq!(develop_profiles(&params_with_film_mode(Some(0x400)))[0].name, "Camera (Velvia look)");
        assert_eq!(develop_profiles(&params_with_film_mode(Some(0x501)))[0].name, "Camera (Pro Neg look)");
        assert_eq!(develop_profiles(&params_with_film_mode(None))[0].name, "Camera");
    }

    #[test]
    fn every_profile_is_valid_develop_settings() {
        let profiles = develop_profiles(&params_with_film_mode(Some(0x600)));
        let ids: Vec<&str> = profiles.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["camera", "provia", "velvia", "astia", "classic-chrome", "pro-neg", "neutral", "monochrome"]);
        for p in &profiles {
            let s = with_wb(&p.settings);
            assert!(s.cam_to_rgb.iter().all(|v| v.is_finite()) && s.exposure_ev.is_finite(), "{}", p.id);
            assert!((0.0..=2.0).contains(&s.saturation), "{}", p.id);
            let curve = s.base_curve.as_deref().expect("every profile has a curve");
            assert_eq!(curve.len(), base_curves::LUT_SIZE);
            assert!(curve[0].abs() < 1e-3 && curve.iter().all(|v| v.is_finite() && (0.0..=1.0001).contains(v)), "{}", p.id);
            assert!(curve.windows(2).all(|w| w[1] >= w[0] - 1e-5), "{}: curve not monotone", p.id);
            // The JSON a profile carries, plus wbRatio, is what setRawDevelop takes.
            let mut json: serde_json::Value = serde_json::to_value(&p.settings).unwrap();
            json["wbRatio"] = serde_json::json!([1.0, 1.0, 1.0]);
            let parsed: RawDevelopSettings = serde_json::from_value(json).unwrap();
            assert_eq!(parsed, s);
            assert!(!p.name.is_empty());
        }
        let looks: Vec<&str> = profiles[1..6].iter().map(|p| p.name.as_str()).collect();
        assert!(looks.iter().all(|n| n.ends_with(" look")), "{looks:?}");
    }

    /// The menu the roles give, as the app prints it: the listed entries'
    /// `menuName`s in order.
    fn menu(mode: Option<u16>) -> Vec<String> {
        develop_profiles(&params_with_film_mode(mode)).into_iter().filter(|p| p.listed).map(|p| p.menu_name).collect()
    }

    #[test]
    fn the_roles_say_what_the_menu_shows() {
        // The camera's look is not listed twice, and Provia is called
        // Fujifilm's Standard wherever it appears.
        assert_eq!(menu(Some(0x200)), ["Camera (Velvia look)", "Standard (Provia look)", "Astia look", "Classic Chrome look", "Pro Neg look", "Neutral", "Monochrome"]);
        assert_eq!(menu(Some(0x000)), ["Camera (Provia look, Standard)", "Velvia look", "Astia look", "Classic Chrome look", "Pro Neg look", "Neutral", "Monochrome"]);
        assert_eq!(menu(None), ["Camera", "Standard (Provia look)", "Velvia look", "Astia look", "Classic Chrome look", "Pro Neg look", "Neutral", "Monochrome"]);
        for mode in [None, Some(0x000), Some(0x100), Some(0x200), Some(0x400), Some(0x501), Some(0x600), Some(0x777)] {
            let profiles = develop_profiles(&params_with_film_mode(mode));
            let camera = &profiles[0];
            assert_eq!(camera.role, ProfileRole::Camera);
            assert_eq!(profiles.iter().filter(|p| p.role == ProfileRole::Camera).count(), 1);
            // The entry the camera is has the camera's settings, and is the
            // only one not listed.
            let hidden: Vec<&str> = profiles.iter().filter(|p| !p.listed).map(|p| p.id.as_str()).collect();
            match &camera.same_as {
                Some(id) => {
                    assert_eq!(hidden, [id.as_str()], "{mode:?}");
                    let same = profiles.iter().find(|p| &p.id == id).unwrap();
                    assert_eq!(same.settings, camera.settings, "{mode:?}");
                    assert_eq!(camera.maker_standard, same.maker_standard, "{mode:?}");
                }
                None => assert!(hidden.is_empty(), "{mode:?}"),
            }
            // Exactly one listed entry is, or stands for, the maker's standard.
            assert_eq!(profiles.iter().filter(|p| p.listed && p.maker_standard).count(), 1, "{mode:?}");
            assert_eq!(profiles.iter().find(|p| p.id == "neutral").unwrap().role, ProfileRole::Neutral);
            assert_eq!(profiles.iter().find(|p| p.id == "monochrome").unwrap().role, ProfileRole::Monochrome);
            // The JSON the app reads: the fields it had, and the new ones.
            let json = serde_json::to_value(camera).unwrap();
            for key in ["id", "name", "settings", "role", "menuName", "listed", "sameAs", "makerStandard"] {
                assert!(json.get(key).is_some(), "{key}");
            }
            assert_eq!(json["role"], "camera");
        }
    }

    #[test]
    fn monochrome_is_grey_and_neutral_is_unsaturated() {
        let profiles = develop_profiles(&params_with_film_mode(None));
        let by_id = |id: &str| with_wb(&profiles.iter().find(|p| p.id == id).unwrap().settings);
        let colour = [0.3f32, 0.1, 0.05, 1.0];
        let mono = develop_reference(&colour, &by_id("monochrome"));
        assert!((mono[0] - mono[1]).abs() < 1e-5 && (mono[1] - mono[2]).abs() < 1e-5, "{mono:?}");
        assert_eq!(by_id("neutral").saturation, 1.0);
        assert!(by_id("velvia").saturation > by_id("neutral").saturation);
    }

    #[test]
    fn inverse_round_trips() {
        let m = [1.8f32, -0.6, -0.2, -0.3, 1.5, -0.2, 0.05, -0.5, 1.45];
        let inv = invert_3x3(&m).unwrap();
        for r in 0..3 {
            for c in 0..3 {
                let v: f32 = (0..3).map(|k| m[r * 3 + k] * inv[k * 3 + c]).sum();
                assert!((v - if r == c { 1.0 } else { 0.0 }).abs() < 1e-5);
            }
        }
    }

    #[test]
    fn settings_json_uses_the_wasm_field_names() {
        let s = RawDevelopSettings {
            wb_ratio: [1.0, 1.0, 1.0],
            cam_to_rgb: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
            exposure_ev: 0.5,
            saturation: 1.2,
            highlight_desaturation: true,
            base_curve: None,
            clip_levels: None,
        };
        let json = serde_json::to_string(&s).unwrap();
        for key in ["wbRatio", "camToRgb", "exposureEv", "saturation", "highlightDesaturation", "baseCurve"] {
            assert!(json.contains(&format!("\"{key}\"")), "{json}");
        }
        let back: RawDevelopSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
        let no_curve: RawDevelopSettings = serde_json::from_str(
            r#"{"wbRatio":[1,1,1],"camToRgb":[1,0,0,0,1,0,0,0,1],"exposureEv":0,"saturation":1,"highlightDesaturation":false}"#,
        )
        .unwrap();
        assert_eq!(no_curve.base_curve, None);
    }

    #[test]
    fn identity_settings_only_encode_srgb() {
        let s = RawDevelopSettings {
            wb_ratio: [1.0, 1.0, 1.0],
            cam_to_rgb: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
            exposure_ev: 0.0,
            saturation: 1.0,
            highlight_desaturation: false,
            base_curve: None,
            clip_levels: None,
        };
        let out = develop_reference(&[0.18, -0.1, 2.0, 0.5], &s);
        assert!((out[0] - 0.4613).abs() < 1e-3);
        assert_eq!(out[1], 0.0);
        assert!(out[2] > 1.0, "values above white pass through");
        assert_eq!(out[3], 0.5);
    }
}
