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
//!   `prepare_raf`), demosaiced, not clamped, with no matrix, curve, gamma
//!   or sharpening. It keeps `render_band`'s banding contract: a band is
//!   bit-identical to the same rows of a whole-frame [`render_linear_rgb`].
//! - [`develop_defaults`] returns the [`RawDevelopSettings`] that reproduce
//!   today's look on the GPU (`engine/src/gpu/shaders/develop/raw_develop.wgsl`):
//!   the neutralized cam→sRGB matrix, the film-sim saturation, the 1.3×
//!   boost as a baseline EV, highlight desaturation and the base-curve LUT.
//! - [`develop_reference`] is that GPU stage's maths on the CPU, for tests.
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
//! Capture sharpening is not reproduced; the Photos pipeline will add it as
//! its default sharpening.
//!
//! **What the full pipeline (spec 6.10) changes.** This is stages 2–4 and 8–9
//! squeezed into one pass in display-referred sRGB primaries. The real
//! pipeline works in linear Rec. 2020 with no clamp until the output
//! transform, derives the camera→working matrix from the white balance by
//! interpolating two calibration illuminants (DNG method, temperature and
//! tint in kelvin), reconstructs clipped highlights before the profile
//! instead of desaturating them, turns the base curve and saturation into
//! profiles, records per-channel clip levels, moves the denoise to its own
//! stage and caches stage outputs.

use serde::{Deserialize, Serialize};

use super::{base_curves, check_band, demosaic_rgb, denoise_chroma, orient_band, RafBand, RafBandPixels, RafRenderParams};
use crate::dng::color;

/// How far (in rows) a linear output pixel reaches into the mosaic: the
/// demosaic and the separable chroma median of radius 1. No sharpening.
pub const LINEAR_REACH_ROWS: u32 = super::markesteijn::REACH as u32 + 1;

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
    }
}

/// Demosaic a white-balanced mosaic of `w`×`h` (first row at CFA phase 0)
/// to interleaved linear camera RGB, chroma-denoised (see the module notes)
/// and unclamped. Each output pixel depends only on mosaic pixels within
/// `LINEAR_REACH_ROWS`.
pub fn render_linear_rgb(mosaic: &[f32], w: usize, h: usize, params: &RafRenderParams) -> Vec<f32> {
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
    let rgb = render_linear_rgb(src, params.width as usize, src_h, params);
    Ok(orient_band(&rgb, params, band, false))
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
        };
        let out = develop_reference(&[0.18, -0.1, 2.0, 0.5], &s);
        assert!((out[0] - 0.4613).abs() < 1e-3);
        assert_eq!(out[1], 0.0);
        assert!(out[2] > 1.0, "values above white pass through");
        assert_eq!(out[3], 0.5);
    }
}
