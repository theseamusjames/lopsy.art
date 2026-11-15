//! Adobe DNG Color Profile (DCP) parsing and application.
//!
//! DCPs are TIFF-format files containing per-camera color calibration:
//! color matrix, tone curve, and optional HSL maps. Loading a DCP gives
//! significantly better color than our generic matrix.
//!
//! ## Format summary (Adobe DNG 1.4 spec, chapter 6)
//!
//! A DCP is a TIFF with a single IFD0 holding a subset of the DNG profile
//! tags. The tags this module understands:
//!
//! | Tag   | Name                          | Type  | Notes                          |
//! |-------|-------------------------------|-------|--------------------------------|
//! | 50778 | CalibrationIlluminant1        | SHORT | EXIF light source code         |
//! | 50779 | CalibrationIlluminant2        | SHORT | EXIF light source code         |
//! | 50721 | ColorMatrix1                  | SRAT  | 3x3, XYZ(illum1) → camera RGB  |
//! | 50722 | ColorMatrix2                  | SRAT  | 3x3, XYZ(illum2) → camera RGB  |
//! | 50964 | ForwardMatrix1                | SRAT  | 3x3, camera RGB → XYZ(D50)     |
//! | 50965 | ForwardMatrix2                | SRAT  | 3x3, camera RGB → XYZ(D50)     |
//! | 50936 | ProfileName                   | ASCII | Profile display name           |
//! | 50932 | ProfileCalibrationSignature   | ASCII | Calibration signature          |
//! | 50937 | ProfileHueSatMapDims          | LONG  | [hue, sat, val] divisions      |
//! | 50938 | ProfileHueSatMapData1         | FLOAT | Flat [h,s,v] cells, illum1     |
//! | 50939 | ProfileHueSatMapData2         | FLOAT | Flat [h,s,v] cells, illum2     |
//! | 50940 | ProfileToneCurve              | FLOAT | (x,y) control points in [0,1]  |
//! | 50981 | ProfileLookTableDims          | LONG  | [hue, sat, val] divisions      |
//! | 50982 | ProfileLookTableData          | FLOAT | Flat [h,s,v] cells             |
//!
//! Note: in the DNG spec, ProfileHueSatMapData1 = 50938 and the
//! dimensions tag is 50937. Some references swap these; we use the
//! spec's numbering.
//!
//! ## Wiring (next step)
//!
//! This module is not yet integrated into [`super::read_raf`]. To wire
//! it in, the production decoder needs:
//!
//! 1. A UI for the user to select a DCP file per document.
//! 2. A way to match a profile to the camera (compare profile name /
//!    calibration signature against the RAF camera model).
//! 3. Replacing the current generic saturation matrix and per-camera
//!    color matrix in `raf/mod.rs` with [`DcpProfile::camera_to_srgb`].
//! 4. Calling [`apply_tone_curve`] in place of the base curve, and
//!    optionally [`apply_hsv_map`] when the profile carries one.

use crate::dng::tiff::{IfdEntry, TiffReader};

// ── Tag IDs ─────────────────────────────────────────────────────────

const TAG_CALIBRATION_ILLUMINANT1: u16 = 50778;
const TAG_CALIBRATION_ILLUMINANT2: u16 = 50779;
const TAG_COLOR_MATRIX1: u16 = 50721;
const TAG_COLOR_MATRIX2: u16 = 50722;
const TAG_FORWARD_MATRIX1: u16 = 50964;
const TAG_FORWARD_MATRIX2: u16 = 50965;
const TAG_PROFILE_CALIBRATION_SIGNATURE: u16 = 50932;
const TAG_PROFILE_NAME: u16 = 50936;
const TAG_PROFILE_HUE_SAT_MAP_DIMS: u16 = 50937;
const TAG_PROFILE_HUE_SAT_MAP_DATA1: u16 = 50938;
const TAG_PROFILE_HUE_SAT_MAP_DATA2: u16 = 50939;
const TAG_PROFILE_TONE_CURVE: u16 = 50940;
const TAG_PROFILE_LOOK_TABLE_DIMS: u16 = 50981;
const TAG_PROFILE_LOOK_TABLE_DATA: u16 = 50982;

// ── Public types ────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct DcpProfile {
    pub name: String,
    pub calibration_signature: String,
    /// Calibration illuminant 1 (e.g. 17 = tungsten A, 21 = D65).
    pub illuminant1: u16,
    pub illuminant2: u16,
    /// XYZ → camera matrix for illuminant 1. Row-major 3×3.
    pub color_matrix1: [f32; 9],
    pub color_matrix2: Option<[f32; 9]>,
    /// Camera → XYZ(D50) forward matrix, if present.
    pub forward_matrix1: Option<[f32; 9]>,
    pub forward_matrix2: Option<[f32; 9]>,
    /// Tone curve as (x, y) control points in [0, 1].
    pub tone_curve: Vec<(f32, f32)>,
    /// HSL map (hue × sat × val cells of [hue_shift, sat_shift, val_shift]).
    /// When two HSL maps are present, this is the one matching illuminant 1.
    pub hsv_map: Option<HsvMap>,
    /// Optional second HSL map for illuminant 2. Same dimensions as `hsv_map`.
    pub hsv_map2: Option<HsvMap>,
    pub look_table: Option<HsvMap>,
}

#[derive(Debug, Clone)]
pub struct HsvMap {
    pub hue_divs: u32,
    pub sat_divs: u32,
    pub val_divs: u32,
    /// Flat array of cells, each is [hue_shift_deg, sat_scale, val_scale].
    /// Ordering matches the DNG spec: hue varies fastest, then sat, then val.
    pub data: Vec<[f32; 3]>,
}

impl DcpProfile {
    /// Parse a DCP file from raw bytes.
    pub fn parse(data: &[u8]) -> Result<Self, String> {
        let reader = TiffReader::new(data)
            .map_err(|e| format!("DCP: {e}"))?;
        let ifd0 = reader.read_ifd(0)
            .map_err(|e| format!("DCP IFD0: {e}"))?;

        let name = read_ascii(&ifd0, TAG_PROFILE_NAME).unwrap_or_default();
        let calibration_signature =
            read_ascii(&ifd0, TAG_PROFILE_CALIBRATION_SIGNATURE).unwrap_or_default();

        let illuminant1 = find_tag(&ifd0, TAG_CALIBRATION_ILLUMINANT1)
            .and_then(|e| e.as_u16())
            .unwrap_or(0);
        let illuminant2 = find_tag(&ifd0, TAG_CALIBRATION_ILLUMINANT2)
            .and_then(|e| e.as_u16())
            .unwrap_or(0);

        let color_matrix1 = read_matrix_3x3(&ifd0, TAG_COLOR_MATRIX1)
            .ok_or_else(|| "DCP: missing ColorMatrix1".to_string())?;
        let color_matrix2 = read_matrix_3x3(&ifd0, TAG_COLOR_MATRIX2);
        let forward_matrix1 = read_matrix_3x3(&ifd0, TAG_FORWARD_MATRIX1);
        let forward_matrix2 = read_matrix_3x3(&ifd0, TAG_FORWARD_MATRIX2);

        let tone_curve = read_tone_curve(&ifd0);

        let hsv_dims = read_hsv_dims(&ifd0, TAG_PROFILE_HUE_SAT_MAP_DIMS);
        let hsv_map = hsv_dims.and_then(|dims| {
            read_hsv_data(&ifd0, TAG_PROFILE_HUE_SAT_MAP_DATA1, dims)
        });
        let hsv_map2 = hsv_dims.and_then(|dims| {
            read_hsv_data(&ifd0, TAG_PROFILE_HUE_SAT_MAP_DATA2, dims)
        });

        let look_dims = read_hsv_dims(&ifd0, TAG_PROFILE_LOOK_TABLE_DIMS);
        let look_table = look_dims.and_then(|dims| {
            read_hsv_data(&ifd0, TAG_PROFILE_LOOK_TABLE_DATA, dims)
        });

        Ok(Self {
            name,
            calibration_signature,
            illuminant1,
            illuminant2,
            color_matrix1,
            color_matrix2,
            forward_matrix1,
            forward_matrix2,
            tone_curve,
            hsv_map,
            hsv_map2,
            look_table,
        })
    }

    /// Get the camera→sRGB matrix interpolated between calibration
    /// illuminants for a target color temperature in Kelvin (e.g. 5500K
    /// for daylight). Returns a 3×3 matrix ready for use with
    /// `apply_matrix()`.
    pub fn camera_to_srgb(&self, color_temp: f32) -> [f32; 9] {
        let weight = self.interpolation_weight(color_temp);

        // Prefer the forward matrix path (camera → XYZ(D50)) when both
        // forward matrices are present. The XYZ(D50) → sRGB matrix below
        // bakes in Bradford adaptation from D50 to D65.
        if let (Some(fm1), Some(fm2)) = (self.forward_matrix1, self.forward_matrix2) {
            let fm = lerp_matrix(&fm1, &fm2, weight);
            return mul_3x3(&XYZ_D50_TO_SRGB, &fm);
        }
        if let Some(fm) = self.forward_matrix1.or(self.forward_matrix2) {
            return mul_3x3(&XYZ_D50_TO_SRGB, &fm);
        }

        // Fall back to inverting the XYZ → camera color matrix. The
        // result is camera → XYZ. We treat that XYZ as D65 (the canonical
        // sRGB whitepoint) and chain it into sRGB. This is the same
        // shortcut already used in `dng::color::color_matrix_to_srgb`.
        let cm = match self.color_matrix2 {
            Some(cm2) => lerp_matrix(&self.color_matrix1, &cm2, weight),
            None => self.color_matrix1,
        };
        let inv = invert_3x3(&cm).unwrap_or(IDENTITY);
        mul_3x3(&XYZ_D65_TO_SRGB, &inv)
    }

    /// Interpolation weight between calibration illuminant 1 (0.0) and
    /// illuminant 2 (1.0) for the given target color temperature.
    ///
    /// Per the DNG spec, the interpolation is linear in **reciprocal**
    /// color temperature (mireds). If only one illuminant is present
    /// we always return 0.0.
    fn interpolation_weight(&self, color_temp_k: f32) -> f32 {
        if self.color_matrix2.is_none() {
            return 0.0;
        }
        let t1 = illuminant_to_kelvin(self.illuminant1).unwrap_or(2850.0);
        let t2 = illuminant_to_kelvin(self.illuminant2).unwrap_or(6500.0);
        if (t1 - t2).abs() < 1e-3 { return 0.0; }

        // Mireds.
        let m_target = 1.0e6 / color_temp_k.max(1.0);
        let m1 = 1.0e6 / t1;
        let m2 = 1.0e6 / t2;
        let w = (m_target - m1) / (m2 - m1);
        w.clamp(0.0, 1.0)
    }
}

/// Apply the tone curve to RGB f32 values in place.
///
/// Uses a 4096-entry lookup table built once via monotonic cubic
/// (Fritsch–Carlson) spline interpolation through the control points.
/// The curve is applied to the luminance channel — RGB is scaled by
/// `mapped_lum / lum` to preserve hue and saturation. This matches the
/// behaviour of [`crate::dng::color::apply_lut`].
pub fn apply_tone_curve(rgb: &mut [f32], curve: &[(f32, f32)]) {
    if curve.len() < 2 {
        return;
    }
    let lut = build_tone_lut(curve, 4096);
    let max_idx = (lut.len() - 1) as f32;
    let lookup = |v: f32| -> f32 {
        let idx = (v * max_idx).clamp(0.0, max_idx);
        let lo = idx as usize;
        let hi = (lo + 1).min(lut.len() - 1);
        let frac = idx - lo as f32;
        lut[lo] * (1.0 - frac) + lut[hi] * frac
    };

    let len = rgb.len() / 3;
    for i in 0..len {
        let r = rgb[i * 3];
        let g = rgb[i * 3 + 1];
        let b = rgb[i * 3 + 2];
        let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if lum <= 0.0 {
            let m = lookup(0.0);
            rgb[i * 3] = m;
            rgb[i * 3 + 1] = m;
            rgb[i * 3 + 2] = m;
            continue;
        }
        let mapped = lookup(lum);
        let scale = mapped / lum;
        rgb[i * 3] = (r * scale).max(0.0);
        rgb[i * 3 + 1] = (g * scale).max(0.0);
        rgb[i * 3 + 2] = (b * scale).max(0.0);
    }
}

/// Apply the HSV map to RGB f32 values in place. Converts to HSV,
/// looks up shifts in the 3D LUT (trilinear interpolation), applies
/// shifts, converts back to RGB.
///
/// The map stores per-cell `[hue_shift_deg, sat_scale, val_scale]`.
/// Hue is rotated additively (modulo 360°); saturation and value are
/// scaled multiplicatively.
pub fn apply_hsv_map(rgb: &mut [f32], map: &HsvMap) {
    if map.data.is_empty() || map.hue_divs < 2 || map.sat_divs < 2 || map.val_divs < 1 {
        return;
    }

    let hue_divs = map.hue_divs as f32;
    let sat_divs_minus_one = (map.sat_divs as f32 - 1.0).max(1.0);
    let val_divs_minus_one = (map.val_divs as f32 - 1.0).max(1.0);

    let len = rgb.len() / 3;
    for i in 0..len {
        let r = rgb[i * 3];
        let g = rgb[i * 3 + 1];
        let b = rgb[i * 3 + 2];

        let (mut h, mut s, mut v) = rgb_to_hsv(r, g, b);
        if v <= 0.0 {
            continue;
        }

        // Hue index wraps around. Saturation and value clamp to edges.
        let hue_pos = (h / 360.0) * hue_divs;
        let sat_pos = s.clamp(0.0, 1.0) * sat_divs_minus_one;
        let val_pos = v.clamp(0.0, 1.0) * val_divs_minus_one;

        let hue_lo = hue_pos.floor() as i32;
        let sat_lo = sat_pos.floor() as i32;
        let val_lo = val_pos.floor() as i32;

        let fh = hue_pos - hue_lo as f32;
        let fs = sat_pos - sat_lo as f32;
        let fv = val_pos - val_lo as f32;

        let mut acc = [0.0f32; 3];
        for dv in 0..2 {
            for ds in 0..2 {
                for dh in 0..2 {
                    let cell = sample_hsv_cell(map, hue_lo + dh, sat_lo + ds, val_lo + dv);
                    let wh = if dh == 0 { 1.0 - fh } else { fh };
                    let ws = if ds == 0 { 1.0 - fs } else { fs };
                    let wv = if dv == 0 { 1.0 - fv } else { fv };
                    let w = wh * ws * wv;
                    acc[0] += cell[0] * w;
                    acc[1] += cell[1] * w;
                    acc[2] += cell[2] * w;
                }
            }
        }

        h = (h + acc[0]).rem_euclid(360.0);
        s = (s * acc[1]).clamp(0.0, 1.0);
        v = (v * acc[2]).max(0.0);

        let (nr, ng, nb) = hsv_to_rgb(h, s, v);
        rgb[i * 3] = nr;
        rgb[i * 3 + 1] = ng;
        rgb[i * 3 + 2] = nb;
    }
}

// ── Tag readers ─────────────────────────────────────────────────────

fn find_tag(entries: &[IfdEntry], tag: u16) -> Option<&IfdEntry> {
    entries.iter().find(|e| e.tag == tag)
}

fn read_ascii(entries: &[IfdEntry], tag: u16) -> Option<String> {
    let entry = find_tag(entries, tag)?;
    // ASCII TIFF strings are null-terminated. Some writers store UTF-8.
    let raw = &entry.raw_bytes;
    let end = raw.iter().position(|&b| b == 0).unwrap_or(raw.len());
    Some(String::from_utf8_lossy(&raw[..end]).into_owned())
}

fn read_matrix_3x3(entries: &[IfdEntry], tag: u16) -> Option<[f32; 9]> {
    let entry = find_tag(entries, tag)?;
    let values = entry.as_rational_vec();
    if values.len() < 9 { return None; }
    let mut out = [0.0f32; 9];
    for i in 0..9 {
        out[i] = values[i] as f32;
    }
    Some(out)
}

fn read_tone_curve(entries: &[IfdEntry]) -> Vec<(f32, f32)> {
    let Some(entry) = find_tag(entries, TAG_PROFILE_TONE_CURVE) else {
        return Vec::new();
    };
    let values = entry.as_rational_vec();
    if values.len() < 4 || values.len() % 2 != 0 {
        return Vec::new();
    }
    values.chunks_exact(2)
        .map(|c| (c[0] as f32, c[1] as f32))
        .collect()
}

fn read_hsv_dims(entries: &[IfdEntry], tag: u16) -> Option<(u32, u32, u32)> {
    let entry = find_tag(entries, tag)?;
    let dims = entry.as_u32_vec()?;
    if dims.len() < 3 { return None; }
    let hue = dims[0];
    let sat = dims[1];
    let val = dims[2];
    if hue == 0 || sat == 0 || val == 0 { return None; }
    let total = (hue as u64) * (sat as u64) * (val as u64);
    // Sanity cap. A 90×30×30 LUT is already enormous; 1M cells is plenty.
    if total > 1_000_000 { return None; }
    Some((hue, sat, val))
}

fn read_hsv_data(entries: &[IfdEntry], tag: u16, dims: (u32, u32, u32)) -> Option<HsvMap> {
    let entry = find_tag(entries, tag)?;
    let values = entry.as_rational_vec();
    let expected = (dims.0 as usize) * (dims.1 as usize) * (dims.2 as usize) * 3;
    if values.len() < expected {
        return None;
    }
    let mut data = Vec::with_capacity(expected / 3);
    for c in values.chunks_exact(3).take(expected / 3) {
        data.push([c[0] as f32, c[1] as f32, c[2] as f32]);
    }
    Some(HsvMap {
        hue_divs: dims.0,
        sat_divs: dims.1,
        val_divs: dims.2,
        data,
    })
}

// ── Tone curve LUT (monotonic cubic spline, Fritsch–Carlson) ────────

fn build_tone_lut(curve: &[(f32, f32)], size: usize) -> Vec<f32> {
    let mut pts: Vec<(f32, f32)> = curve.iter()
        .map(|&(x, y)| (x.clamp(0.0, 1.0), y.clamp(0.0, 1.0)))
        .collect();
    pts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    // Deduplicate identical x coordinates to avoid divide-by-zero.
    pts.dedup_by(|a, b| (a.0 - b.0).abs() < 1e-6);

    if pts.first().map(|p| p.0 > 0.0).unwrap_or(true) {
        pts.insert(0, (0.0, pts.first().map(|p| p.1).unwrap_or(0.0)));
    }
    if pts.last().map(|p| p.0 < 1.0).unwrap_or(true) {
        pts.push((1.0, pts.last().map(|p| p.1).unwrap_or(1.0)));
    }

    let n = pts.len();
    // Tangents via Fritsch–Carlson.
    let mut d = vec![0.0f32; n - 1];
    for i in 0..n - 1 {
        let dx = pts[i + 1].0 - pts[i].0;
        d[i] = if dx > 0.0 { (pts[i + 1].1 - pts[i].1) / dx } else { 0.0 };
    }
    let mut m = vec![0.0f32; n];
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for i in 1..n - 1 {
        if d[i - 1] * d[i] <= 0.0 {
            m[i] = 0.0;
        } else {
            m[i] = (d[i - 1] + d[i]) * 0.5;
        }
    }
    // Enforce monotonicity.
    for i in 0..n - 1 {
        if d[i].abs() < 1e-9 {
            m[i] = 0.0;
            m[i + 1] = 0.0;
            continue;
        }
        let a = m[i] / d[i];
        let b = m[i + 1] / d[i];
        let s = a * a + b * b;
        if s > 9.0 {
            let t = 3.0 / s.sqrt();
            m[i] = t * a * d[i];
            m[i + 1] = t * b * d[i];
        }
    }

    let mut lut = vec![0.0f32; size];
    let mut seg = 0usize;
    for i in 0..size {
        let x = i as f32 / (size - 1) as f32;
        while seg + 1 < n - 1 && x > pts[seg + 1].0 {
            seg += 1;
        }
        let (x0, y0) = pts[seg];
        let (x1, y1) = pts[seg + 1];
        let h = x1 - x0;
        if h <= 0.0 {
            lut[i] = y1.clamp(0.0, 1.0);
            continue;
        }
        let t = ((x - x0) / h).clamp(0.0, 1.0);
        let t2 = t * t;
        let t3 = t2 * t;
        let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
        let h10 = t3 - 2.0 * t2 + t;
        let h01 = -2.0 * t3 + 3.0 * t2;
        let h11 = t3 - t2;
        let y = h00 * y0 + h10 * h * m[seg] + h01 * y1 + h11 * h * m[seg + 1];
        lut[i] = y.clamp(0.0, 1.0);
    }
    lut
}

// ── HSV map sampling ────────────────────────────────────────────────

fn sample_hsv_cell(map: &HsvMap, h: i32, s: i32, v: i32) -> [f32; 3] {
    let hue_divs = map.hue_divs as i32;
    let sat_divs = map.sat_divs as i32;
    let val_divs = map.val_divs as i32;
    // Hue wraps; sat/val clamp.
    let h = h.rem_euclid(hue_divs);
    let s = s.clamp(0, sat_divs - 1);
    let v = v.clamp(0, val_divs - 1);
    // DNG ordering: hue varies fastest, then sat, then val.
    let idx = (v * sat_divs * hue_divs + s * hue_divs + h) as usize;
    if idx >= map.data.len() {
        return [0.0, 1.0, 1.0];
    }
    map.data[idx]
}

// ── Color conversions ──────────────────────────────────────────────

fn rgb_to_hsv(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    let v = max;
    let s = if max > 0.0 { delta / max } else { 0.0 };
    let h = if delta <= 0.0 {
        0.0
    } else if max == r {
        60.0 * (((g - b) / delta).rem_euclid(6.0))
    } else if max == g {
        60.0 * ((b - r) / delta + 2.0)
    } else {
        60.0 * ((r - g) / delta + 4.0)
    };
    (h.rem_euclid(360.0), s, v)
}

fn hsv_to_rgb(h: f32, s: f32, v: f32) -> (f32, f32, f32) {
    if s <= 0.0 {
        return (v, v, v);
    }
    let h = h.rem_euclid(360.0) / 60.0;
    let i = h.floor();
    let f = h - i;
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * f);
    let t = v * (1.0 - s * (1.0 - f));
    match i as i32 {
        0 => (v, t, p),
        1 => (q, v, p),
        2 => (p, v, t),
        3 => (p, q, v),
        4 => (t, p, v),
        _ => (v, p, q),
    }
}

// ── Matrix helpers ──────────────────────────────────────────────────

const IDENTITY: [f32; 9] = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];

/// XYZ(D50) → sRGB linear, with Bradford D50→D65 adaptation baked in.
/// Same matrix used by [`crate::dng::color::forward_matrix_to_srgb`].
const XYZ_D50_TO_SRGB: [f32; 9] = [
    3.1338561, -1.6168667, -0.4906146,
    -0.9787684, 1.9161415, 0.0334540,
    0.0719453, -0.2289914, 1.4052427,
];

/// XYZ(D65) → sRGB linear.
const XYZ_D65_TO_SRGB: [f32; 9] = [
    3.2404542, -1.5371385, -0.4985314,
    -0.9692660, 1.8760108, 0.0415560,
    0.0556434, -0.2040259, 1.0572252,
];

fn mul_3x3(a: &[f32; 9], b: &[f32; 9]) -> [f32; 9] {
    let mut out = [0.0f32; 9];
    for r in 0..3 {
        for c in 0..3 {
            let mut sum = 0.0f32;
            for k in 0..3 {
                sum += a[r * 3 + k] * b[k * 3 + c];
            }
            out[r * 3 + c] = sum;
        }
    }
    out
}

fn lerp_matrix(a: &[f32; 9], b: &[f32; 9], t: f32) -> [f32; 9] {
    let t = t.clamp(0.0, 1.0);
    let mut out = [0.0f32; 9];
    for i in 0..9 {
        out[i] = a[i] * (1.0 - t) + b[i] * t;
    }
    out
}

fn invert_3x3(m: &[f32; 9]) -> Option<[f32; 9]> {
    let det = m[0] * (m[4] * m[8] - m[5] * m[7])
        - m[1] * (m[3] * m[8] - m[5] * m[6])
        + m[2] * (m[3] * m[7] - m[4] * m[6]);
    if det.abs() < 1e-10 {
        return None;
    }
    let inv_det = 1.0 / det;
    Some([
        (m[4] * m[8] - m[5] * m[7]) * inv_det,
        (m[2] * m[7] - m[1] * m[8]) * inv_det,
        (m[1] * m[5] - m[2] * m[4]) * inv_det,
        (m[5] * m[6] - m[3] * m[8]) * inv_det,
        (m[0] * m[8] - m[2] * m[6]) * inv_det,
        (m[2] * m[3] - m[0] * m[5]) * inv_det,
        (m[3] * m[7] - m[4] * m[6]) * inv_det,
        (m[1] * m[6] - m[0] * m[7]) * inv_det,
        (m[0] * m[4] - m[1] * m[3]) * inv_det,
    ])
}

/// EXIF light source code → approximate color temperature in Kelvin.
/// Codes per the EXIF 2.3 spec / DNG CalibrationIlluminant tag.
fn illuminant_to_kelvin(code: u16) -> Option<f32> {
    match code {
        // EXIF light source values used in DNG.
        1 => Some(5500.0),  // Daylight
        2 => Some(4200.0),  // Fluorescent
        3 => Some(2850.0),  // Tungsten (incandescent)
        4 => Some(5500.0),  // Flash
        9 => Some(6500.0),  // Fine weather
        10 => Some(7500.0), // Cloudy weather
        11 => Some(7500.0), // Shade
        12 => Some(6400.0), // Daylight fluorescent (D 5700 – 7100K)
        13 => Some(4600.0), // Day white fluorescent
        14 => Some(4000.0), // Cool white fluorescent
        15 => Some(3000.0), // White fluorescent
        17 => Some(2856.0), // Standard illuminant A
        18 => Some(4874.0), // Standard illuminant B
        19 => Some(6774.0), // Standard illuminant C
        20 => Some(5503.0), // D55
        21 => Some(6504.0), // D65
        22 => Some(7504.0), // D75
        23 => Some(5003.0), // D50
        24 => Some(3200.0), // ISO studio tungsten
        _ => None,
    }
}

// ─────────────────────────────────────────────────────────────────────
//                              TESTS
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal DCP-style TIFF in memory so the parser has a
    /// real binary to chew on. The TIFF is little-endian.
    fn build_synthetic_dcp() -> Vec<u8> {
        // Tag layout we'll emit, in ascending tag order:
        //   50721 ColorMatrix1 (SRATIONAL, 9 entries, off-buffer)
        //   50722 ColorMatrix2 (SRATIONAL, 9 entries, off-buffer)
        //   50778 CalibrationIlluminant1 (SHORT, inline)
        //   50779 CalibrationIlluminant2 (SHORT, inline)
        //   50932 ProfileCalibrationSignature (ASCII, off-buffer)
        //   50936 ProfileName (ASCII, off-buffer)
        //   50940 ProfileToneCurve (FLOAT, 6 entries = 3 control points, off-buffer)
        //   50964 ForwardMatrix1 (SRATIONAL, 9 entries, off-buffer)
        //   50965 ForwardMatrix2 (SRATIONAL, 9 entries, off-buffer)
        //
        // Layout:
        //   [0..8]   TIFF header
        //   [8..]    IFD0 (count + entries + next_ifd=0)
        //   [..]     external data blobs

        let name = b"Test Profile\0";
        let sig = b"abcd1234\0";
        let tone = [0.0f32, 0.0, 0.5, 0.6, 1.0, 1.0];
        // Plausible XYZ→camera matrix (CM1, tungsten).
        let cm1_num: [i32; 9] = [
            8000, -1500, -1200,
            -3000, 12000, 2000,
            -500, 3500, 5000,
        ];
        // CM2, D65.
        let cm2_num: [i32; 9] = [
            7500, -2000, -800,
            -3200, 12200, 1800,
            -700, 3200, 5500,
        ];
        // Forward matrices (camera→XYZ(D50)).
        let fm1_num: [i32; 9] = [
            5500, 3000, 1500,
            2500, 7000, 500,
            0, 800, 8000,
        ];
        let fm2_num: [i32; 9] = [
            5400, 3100, 1600,
            2600, 6900, 500,
            100, 900, 7900,
        ];
        let denom: i32 = 10_000;

        // Build external blobs.
        let mut ext: Vec<u8> = Vec::new();
        let push_srational = |v: &[i32; 9], ext: &mut Vec<u8>| -> u32 {
            let off = ext.len() as u32;
            for &n in v {
                ext.extend_from_slice(&n.to_le_bytes());
                ext.extend_from_slice(&denom.to_le_bytes());
            }
            off
        };
        let push_ascii = |s: &[u8], ext: &mut Vec<u8>| -> u32 {
            let off = ext.len() as u32;
            ext.extend_from_slice(s);
            // pad to even
            if ext.len() % 2 == 1 { ext.push(0); }
            off
        };
        let push_float = |v: &[f32], ext: &mut Vec<u8>| -> u32 {
            let off = ext.len() as u32;
            for &x in v {
                ext.extend_from_slice(&x.to_le_bytes());
            }
            off
        };

        // Defer absolute offsets — they need + base_offset later.
        let cm1_local = push_srational(&cm1_num, &mut ext);
        let cm2_local = push_srational(&cm2_num, &mut ext);
        let fm1_local = push_srational(&fm1_num, &mut ext);
        let fm2_local = push_srational(&fm2_num, &mut ext);
        let name_local = push_ascii(name, &mut ext);
        let sig_local = push_ascii(sig, &mut ext);
        let tone_local = push_float(&tone, &mut ext);

        // 9 entries × 12 bytes + 2-byte count + 4-byte next-IFD pointer.
        let entry_count: u16 = 9;
        let ifd_size = 2 + 12 * (entry_count as usize) + 4;
        let ifd_offset: u32 = 8;
        let ext_base: u32 = ifd_offset + ifd_size as u32;

        let cm1_off = ext_base + cm1_local;
        let cm2_off = ext_base + cm2_local;
        let fm1_off = ext_base + fm1_local;
        let fm2_off = ext_base + fm2_local;
        let name_off = ext_base + name_local;
        let sig_off = ext_base + sig_local;
        let tone_off = ext_base + tone_local;

        let mut out: Vec<u8> = Vec::new();
        // TIFF header
        out.extend_from_slice(b"II");
        out.extend_from_slice(&42u16.to_le_bytes());
        out.extend_from_slice(&ifd_offset.to_le_bytes());
        // IFD
        out.extend_from_slice(&entry_count.to_le_bytes());

        let push_entry = |tag: u16, typ: u16, count: u32, value_or_off: u32, out: &mut Vec<u8>| {
            out.extend_from_slice(&tag.to_le_bytes());
            out.extend_from_slice(&typ.to_le_bytes());
            out.extend_from_slice(&count.to_le_bytes());
            out.extend_from_slice(&value_or_off.to_le_bytes());
        };

        // Entries in ascending tag order.
        push_entry(TAG_COLOR_MATRIX1, 10, 9, cm1_off, &mut out);
        push_entry(TAG_COLOR_MATRIX2, 10, 9, cm2_off, &mut out);
        // Inline SHORT: value packed in low bytes, high bytes zero.
        push_entry(TAG_CALIBRATION_ILLUMINANT1, 3, 1, 17, &mut out);
        push_entry(TAG_CALIBRATION_ILLUMINANT2, 3, 1, 21, &mut out);
        push_entry(TAG_PROFILE_CALIBRATION_SIGNATURE, 2, sig.len() as u32, sig_off, &mut out);
        push_entry(TAG_PROFILE_NAME, 2, name.len() as u32, name_off, &mut out);
        push_entry(TAG_PROFILE_TONE_CURVE, 11, tone.len() as u32, tone_off, &mut out);
        push_entry(TAG_FORWARD_MATRIX1, 10, 9, fm1_off, &mut out);
        push_entry(TAG_FORWARD_MATRIX2, 10, 9, fm2_off, &mut out);

        // next-IFD pointer
        out.extend_from_slice(&0u32.to_le_bytes());
        // Append external blob region.
        out.extend_from_slice(&ext);
        out
    }

    #[test]
    fn parses_synthetic_dcp() {
        let bytes = build_synthetic_dcp();
        let profile = DcpProfile::parse(&bytes).expect("parse");
        assert_eq!(profile.name, "Test Profile");
        assert_eq!(profile.calibration_signature, "abcd1234");
        assert_eq!(profile.illuminant1, 17);
        assert_eq!(profile.illuminant2, 21);

        // ColorMatrix1[0][0] = 8000 / 10000 = 0.8
        assert!((profile.color_matrix1[0] - 0.8).abs() < 1e-4);
        // Negative SRATIONAL round-trip.
        assert!((profile.color_matrix1[1] - (-0.15)).abs() < 1e-4);

        let cm2 = profile.color_matrix2.expect("CM2 present");
        assert!((cm2[0] - 0.75).abs() < 1e-4);

        let fm1 = profile.forward_matrix1.expect("FM1 present");
        assert!((fm1[0] - 0.55).abs() < 1e-4);
        assert!(profile.forward_matrix2.is_some());

        // Tone curve: (0,0), (0.5,0.6), (1,1).
        assert_eq!(profile.tone_curve.len(), 3);
        assert!((profile.tone_curve[1].0 - 0.5).abs() < 1e-4);
        assert!((profile.tone_curve[1].1 - 0.6).abs() < 1e-4);
    }

    #[test]
    fn matrices_have_plausible_values() {
        let bytes = build_synthetic_dcp();
        let profile = DcpProfile::parse(&bytes).unwrap();
        for &v in profile.color_matrix1.iter() {
            assert!(v.abs() <= 2.0, "CM1 entry {v} out of expected range");
        }
        if let Some(fm) = profile.forward_matrix1 {
            for &v in fm.iter() {
                assert!(v.abs() <= 2.0, "FM1 entry {v} out of expected range");
            }
        }
    }

    #[test]
    fn camera_to_srgb_uses_forward_matrix_when_available() {
        let bytes = build_synthetic_dcp();
        let profile = DcpProfile::parse(&bytes).unwrap();
        let m_5500 = profile.camera_to_srgb(5500.0);
        for &v in m_5500.iter() {
            assert!(v.is_finite(), "matrix entry must be finite");
        }
        // Different temperatures should produce different matrices.
        let m_3000 = profile.camera_to_srgb(3000.0);
        let m_6500 = profile.camera_to_srgb(6500.0);
        let diff: f32 = m_3000.iter().zip(m_6500.iter())
            .map(|(a, b)| (a - b).abs())
            .sum();
        assert!(diff > 1e-4, "matrix should depend on color temperature");
    }

    #[test]
    fn camera_to_srgb_works_without_forward_matrix() {
        // CM1 only — no CM2, no FM. Should still produce a finite matrix.
        let profile = DcpProfile {
            name: "x".into(),
            calibration_signature: String::new(),
            illuminant1: 21,
            illuminant2: 0,
            color_matrix1: [
                0.6, 0.2, 0.1,
                0.1, 0.7, 0.2,
                0.0, 0.1, 0.8,
            ],
            color_matrix2: None,
            forward_matrix1: None,
            forward_matrix2: None,
            tone_curve: vec![],
            hsv_map: None,
            hsv_map2: None,
            look_table: None,
        };
        let m = profile.camera_to_srgb(6500.0);
        for &v in m.iter() {
            assert!(v.is_finite());
        }
    }

    #[test]
    fn tone_curve_is_monotonic() {
        let curve = vec![(0.0, 0.0), (0.25, 0.18), (0.5, 0.5), (0.75, 0.82), (1.0, 1.0)];
        let lut = build_tone_lut(&curve, 1024);
        let mut prev = -1.0f32;
        for &v in &lut {
            assert!(v >= prev - 1e-5, "LUT must be monotonic, {v} < {prev}");
            assert!((0.0..=1.0).contains(&v), "LUT value {v} out of [0,1]");
            prev = v;
        }
    }

    #[test]
    fn apply_tone_curve_no_curve_is_noop() {
        let mut pixels = vec![0.2, 0.4, 0.6, 0.5, 0.5, 0.5];
        let copy = pixels.clone();
        apply_tone_curve(&mut pixels, &[]);
        for (a, b) in pixels.iter().zip(copy.iter()) {
            assert!((a - b).abs() < 1e-6);
        }
    }

    #[test]
    fn apply_tone_curve_preserves_neutrals() {
        let curve = vec![(0.0, 0.0), (0.5, 0.6), (1.0, 1.0)];
        let mut pixels = vec![0.5, 0.5, 0.5];
        apply_tone_curve(&mut pixels, &curve);
        // Neutral grey should stay neutral.
        assert!((pixels[0] - pixels[1]).abs() < 1e-5);
        assert!((pixels[1] - pixels[2]).abs() < 1e-5);
        // And map upward (since (0.5 → 0.6)).
        assert!(pixels[0] > 0.5);
    }

    #[test]
    fn identity_hsv_map_preserves_pixels() {
        // 2×2×2 LUT where every cell is identity: no hue shift, no scaling.
        let identity_cells = vec![[0.0_f32, 1.0, 1.0]; 8];
        let map = HsvMap {
            hue_divs: 2, sat_divs: 2, val_divs: 2,
            data: identity_cells,
        };
        let mut pixels = vec![0.7_f32, 0.3, 0.4, 0.1, 0.8, 0.2];
        let original = pixels.clone();
        apply_hsv_map(&mut pixels, &map);
        for (a, b) in pixels.iter().zip(original.iter()) {
            assert!((a - b).abs() < 1e-4, "expected {b}, got {a}");
        }
    }

    #[test]
    fn rgb_hsv_roundtrip() {
        let cases = [
            (1.0, 0.0, 0.0),
            (0.0, 1.0, 0.0),
            (0.0, 0.0, 1.0),
            (0.5, 0.25, 0.75),
            (0.3, 0.3, 0.3),
        ];
        for &(r, g, b) in &cases {
            let (h, s, v) = rgb_to_hsv(r, g, b);
            let (nr, ng, nb) = hsv_to_rgb(h, s, v);
            assert!((r - nr).abs() < 1e-4, "R: {r} != {nr}");
            assert!((g - ng).abs() < 1e-4, "G: {g} != {ng}");
            assert!((b - nb).abs() < 1e-4, "B: {b} != {nb}");
        }
    }

    #[test]
    fn illuminant_lookup_known_codes() {
        assert!((illuminant_to_kelvin(17).unwrap() - 2856.0).abs() < 1.0);
        assert!((illuminant_to_kelvin(21).unwrap() - 6504.0).abs() < 1.0);
        assert!((illuminant_to_kelvin(23).unwrap() - 5003.0).abs() < 1.0);
        assert!(illuminant_to_kelvin(99).is_none());
    }

    /// If a real .dcp lands in the test fixtures dir, exercise the parser
    /// against it too. Skipped silently when the file is absent.
    #[test]
    fn parses_real_dcp_if_present() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/src/raf/test_fixtures/sample.dcp");
        let Ok(bytes) = std::fs::read(path) else { return; };
        let profile = DcpProfile::parse(&bytes).expect("real DCP must parse");
        assert!(!profile.name.is_empty(), "profile name should not be empty");
        // Matrix entries should have plausible magnitude.
        for &v in profile.color_matrix1.iter() {
            assert!(v.abs() <= 4.0, "CM1 entry {v} suspiciously large");
        }
    }
}
