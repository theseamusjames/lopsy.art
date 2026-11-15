//! CIELAB conversions for the native "Lab Color" document mode.
//!
//! The Lab white point here is D50, not D65, even though the rest of the
//! engine's color pipeline (see `color.rs`) works in sRGB/D65. D50 is the
//! CIE standard illuminant used as the ICC Profile Connection Space (PCS),
//! so anchoring Lab conversions to D50 now means future ICC profile work
//! (soft-proofing, profile-based color management) composes with this
//! module without a second white-point migration later. This matches the
//! convention used by Photoshop's native Lab mode.
//!
//! Layer textures are RGBA8, so Lab values (which don't naturally fit a
//! single byte range) are encoded for storage: L (0..=100) is scaled into
//! 0..=255, and a/b (nominally -128..=127) are shifted by +128 into
//! 0..=255. `lab_to_bytes`/`bytes_to_lab` handle that encoding; all other
//! functions in this module work in real Lab units.

/// CIE delta = 6/29, the break point in the CIELAB f(t) piecewise function.
const DELTA: f32 = 6.0 / 29.0;

/// CIE standard illuminant D50 reference white, in CIE XYZ (Y normalized
/// to 1.0). Used as the Lab reference white throughout this module.
const D50_WHITE: (f32, f32, f32) = (0.9642, 1.0000, 0.8249);

/// Linear sRGB (D65) -> CIE XYZ (D65). Standard sRGB primaries and D65
/// white point, per IEC 61966-2-1.
#[rustfmt::skip]
const SRGB_TO_XYZ_D65: [f32; 9] = [
    0.4124564, 0.3575761, 0.1804375,
    0.2126729, 0.7151522, 0.0721750,
    0.0193339, 0.1191920, 0.9503041,
];

/// CIE XYZ (D65) -> linear sRGB (D65). Inverse of `SRGB_TO_XYZ_D65`.
#[rustfmt::skip]
const XYZ_D65_TO_SRGB: [f32; 9] = [
     3.2404542, -1.5371385, -0.4985314,
    -0.9692660,  1.8760108,  0.0415560,
     0.0556434, -0.2040259,  1.0572252,
];

/// Bradford chromatic adaptation, CIE XYZ (D65) -> CIE XYZ (D50). This is
/// the same adaptation matrix used to convert between the D65-referenced
/// sRGB working space and the D50-referenced ICC PCS.
#[rustfmt::skip]
const BRADFORD_D65_TO_D50: [f32; 9] = [
     1.0478112,  0.0228866, -0.0501270,
     0.0295424,  0.9904844, -0.0170491,
    -0.0092345,  0.0150436,  0.7521316,
];

/// Bradford chromatic adaptation, CIE XYZ (D50) -> CIE XYZ (D65). Inverse
/// of `BRADFORD_D65_TO_D50`.
#[rustfmt::skip]
const BRADFORD_D50_TO_D65: [f32; 9] = [
     0.9555766, -0.0230393,  0.0631636,
    -0.0282895,  1.0099416,  0.0210077,
     0.0122982, -0.0204830,  1.3299098,
];

fn mat_vec3(m: &[f32; 9], v: (f32, f32, f32)) -> (f32, f32, f32) {
    (
        m[0] * v.0 + m[1] * v.1 + m[2] * v.2,
        m[3] * v.0 + m[4] * v.1 + m[5] * v.2,
        m[6] * v.0 + m[7] * v.1 + m[8] * v.2,
    )
}

/// sRGB EOTF: 8-bit sRGB -> linear float. Reimplemented locally (rather
/// than reusing `color::srgb_to_linear`) so this module has no dependency
/// on `color.rs`.
fn srgb_u8_to_linear(v: u8) -> f32 {
    let s = v as f32 / 255.0;
    if s <= 0.04045 {
        s / 12.92
    } else {
        ((s + 0.055) / 1.055).powf(2.4)
    }
}

/// sRGB OETF: linear float -> 8-bit sRGB, clamped to the valid range.
fn linear_to_srgb_u8(v: f32) -> u8 {
    let c = v.clamp(0.0, 1.0);
    let s = if c <= 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    };
    (s * 255.0 + 0.5) as u8
}

/// CIELAB f(t), delta = 6/29: t^(1/3) above delta^3, otherwise the linear
/// segment that keeps f(t) and its derivative continuous at delta.
fn f_lab(t: f32) -> f32 {
    let delta3 = DELTA * DELTA * DELTA;
    if t > delta3 {
        t.cbrt()
    } else {
        t / (3.0 * DELTA * DELTA) + 4.0 / 29.0
    }
}

/// Exact inverse of `f_lab`.
fn f_lab_inv(t: f32) -> f32 {
    if t > DELTA {
        t * t * t
    } else {
        3.0 * DELTA * DELTA * (t - 4.0 / 29.0)
    }
}

fn xyz_d50_to_lab(xyz: (f32, f32, f32)) -> (f32, f32, f32) {
    let fx = f_lab(xyz.0 / D50_WHITE.0);
    let fy = f_lab(xyz.1 / D50_WHITE.1);
    let fz = f_lab(xyz.2 / D50_WHITE.2);
    (116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz))
}

fn lab_to_xyz_d50(l: f32, a: f32, b: f32) -> (f32, f32, f32) {
    let fy = (l + 16.0) / 116.0;
    let fx = fy + a / 500.0;
    let fz = fy - b / 200.0;
    (
        f_lab_inv(fx) * D50_WHITE.0,
        f_lab_inv(fy) * D50_WHITE.1,
        f_lab_inv(fz) * D50_WHITE.2,
    )
}

/// sRGB (0..=255) -> CIELAB. Returns (L, a, b) in real Lab units:
/// L in 0..=100, a/b roughly -128..=127.
pub fn srgb_to_lab(r: u8, g: u8, b: u8) -> (f32, f32, f32) {
    let linear = (
        srgb_u8_to_linear(r),
        srgb_u8_to_linear(g),
        srgb_u8_to_linear(b),
    );
    let xyz_d65 = mat_vec3(&SRGB_TO_XYZ_D65, linear);
    let xyz_d50 = mat_vec3(&BRADFORD_D65_TO_D50, xyz_d65);
    xyz_d50_to_lab(xyz_d50)
}

/// CIELAB (real units) -> sRGB (0..=255), clamped to the sRGB gamut.
pub fn lab_to_srgb(l: f32, a: f32, b: f32) -> (u8, u8, u8) {
    let xyz_d50 = lab_to_xyz_d50(l, a, b);
    let xyz_d65 = mat_vec3(&BRADFORD_D50_TO_D65, xyz_d50);
    let linear = mat_vec3(&XYZ_D65_TO_SRGB, xyz_d65);
    (
        linear_to_srgb_u8(linear.0),
        linear_to_srgb_u8(linear.1),
        linear_to_srgb_u8(linear.2),
    )
}

/// Encode real Lab units into the 0..=255 texture byte range.
pub fn lab_to_bytes(l: f32, a: f32, b: f32) -> (u8, u8, u8) {
    let l_byte = (l * 2.55).round().clamp(0.0, 255.0) as u8;
    let a_byte = (a + 128.0).round().clamp(0.0, 255.0) as u8;
    let b_byte = (b + 128.0).round().clamp(0.0, 255.0) as u8;
    (l_byte, a_byte, b_byte)
}

/// Decode texture bytes back to real Lab units.
pub fn bytes_to_lab(l: u8, a: u8, b: u8) -> (f32, f32, f32) {
    (l as f32 / 2.55, a as f32 - 128.0, b as f32 - 128.0)
}

/// In-place RGBA8 buffer: sRGB -> encoded-Lab. Alpha preserved. Any
/// trailing bytes that don't form a whole RGBA pixel are left untouched.
pub fn srgb_pixels_to_lab(pixels: &mut [u8]) {
    for px in pixels.chunks_exact_mut(4) {
        let (l, a, b) = srgb_to_lab(px[0], px[1], px[2]);
        let (l_byte, a_byte, b_byte) = lab_to_bytes(l, a, b);
        px[0] = l_byte;
        px[1] = a_byte;
        px[2] = b_byte;
    }
}

/// In-place RGBA8 buffer: encoded-Lab -> sRGB. Alpha preserved. Any
/// trailing bytes that don't form a whole RGBA pixel are left untouched.
pub fn lab_pixels_to_srgb(pixels: &mut [u8]) {
    for px in pixels.chunks_exact_mut(4) {
        let (l, a, b) = bytes_to_lab(px[0], px[1], px[2]);
        let (r, g, b) = lab_to_srgb(l, a, b);
        px[0] = r;
        px[1] = g;
        px[2] = b;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn white_is_near_l100_a0_b0() {
        let (l, a, b) = srgb_to_lab(255, 255, 255);
        assert!((l - 100.0).abs() < 1.0, "L = {l}");
        assert!(a.abs() < 1.5, "a = {a}");
        assert!(b.abs() < 1.5, "b = {b}");
    }

    #[test]
    fn black_is_near_l0_a0_b0() {
        let (l, a, b) = srgb_to_lab(0, 0, 0);
        assert!(l.abs() < 1.0, "L = {l}");
        assert!(a.abs() < 1.5, "a = {a}");
        assert!(b.abs() < 1.5, "b = {b}");
    }

    #[test]
    fn mid_gray_stays_neutral() {
        let (l, a, b) = srgb_to_lab(128, 128, 128);
        assert!(a.abs() < 1.5, "a = {a}");
        assert!(b.abs() < 1.5, "b = {b}");
        assert!(l > 40.0 && l < 65.0, "L = {l}");
    }

    #[test]
    fn pure_red_is_in_expected_neighbourhood() {
        let (l, a, b) = srgb_to_lab(255, 0, 0);
        assert!((l - 54.0).abs() < 6.0, "L = {l}");
        assert!(a > 50.0, "a = {a}");
        assert!(b > 30.0, "b = {b}");
    }

    #[test]
    fn srgb_lab_srgb_roundtrip_sweep() {
        let mut checked = 0;
        for r in (0..=255u32).step_by(32) {
            for g in (0..=255u32).step_by(32) {
                for b in (0..=255u32).step_by(32) {
                    let (r, g, b) = (r as u8, g as u8, b as u8);
                    let (l, a, bb) = srgb_to_lab(r, g, b);
                    let (r2, g2, b2) = lab_to_srgb(l, a, bb);
                    assert!(
                        (r as i16 - r2 as i16).abs() <= 2,
                        "r mismatch: {r} vs {r2} (input {r},{g},{b})"
                    );
                    assert!(
                        (g as i16 - g2 as i16).abs() <= 2,
                        "g mismatch: {g} vs {g2} (input {r},{g},{b})"
                    );
                    assert!(
                        (b as i16 - b2 as i16).abs() <= 2,
                        "b mismatch: {b} vs {b2} (input {r},{g},{b})"
                    );
                    checked += 1;
                }
            }
        }
        assert!(
            checked >= 100,
            "expected at least 100 samples, got {checked}"
        );
    }

    #[test]
    fn lab_bytes_roundtrip_within_quantization_step() {
        for l in (0..=255u16).step_by(17) {
            for a in (0..=255u16).step_by(17) {
                for b in (0..=255u16).step_by(17) {
                    let (l, a, b) = (l as u8, a as u8, b as u8);
                    let (lr, ar, br) = bytes_to_lab(l, a, b);
                    let (l2, a2, b2) = lab_to_bytes(lr, ar, br);
                    assert!((l as i16 - l2 as i16).abs() <= 1, "L byte {l} vs {l2}");
                    assert!((a as i16 - a2 as i16).abs() <= 1, "a byte {a} vs {a2}");
                    assert!((b as i16 - b2 as i16).abs() <= 1, "b byte {b} vs {b2}");
                }
            }
        }
    }

    #[test]
    fn pixel_buffer_roundtrip_preserves_color_and_alpha() {
        // Fully saturated primaries (255,0,0 / 0,255,0 / 255,255,0, ...)
        // sit at corners of the sRGB gamut, where the a/b byte quantization
        // step (~1 Lab unit) gets amplified on decode because the nearest
        // in-gamut point can be several sRGB units away. That's an inherent
        // property of 8-bit-encoded Lab, exercised separately (without byte
        // quantization) by `pure_red_is_in_expected_neighbourhood` and
        // `srgb_lab_srgb_roundtrip_sweep`. This test instead covers ordinary
        // photographic colors, where the ±3 byte-roundtrip budget holds.
        let original: Vec<u8> = vec![
            0, 0, 0, 255, 255, 255, 255, 128, 200, 50, 50, 64, 50, 180, 60, 200, 60, 90, 200, 0,
            128, 64, 200, 33,
        ];
        let mut pixels = original.clone();
        srgb_pixels_to_lab(&mut pixels);
        lab_pixels_to_srgb(&mut pixels);

        for (i, px) in original.chunks_exact(4).enumerate() {
            let out = &pixels[i * 4..i * 4 + 4];
            for c in 0..3 {
                assert!(
                    (px[c] as i16 - out[c] as i16).abs() <= 3,
                    "channel {c} of pixel {i}: {} vs {}",
                    px[c],
                    out[c]
                );
            }
            assert_eq!(
                px[3], out[3],
                "alpha of pixel {i} must be preserved exactly"
            );
        }
    }

    #[test]
    fn non_multiple_of_four_buffer_does_not_panic() {
        let mut pixels = vec![10u8, 20, 30, 255, 40, 50];
        srgb_pixels_to_lab(&mut pixels);
        lab_pixels_to_srgb(&mut pixels);
    }

    #[test]
    fn empty_buffer_does_not_panic() {
        let mut pixels: Vec<u8> = Vec::new();
        srgb_pixels_to_lab(&mut pixels);
        lab_pixels_to_srgb(&mut pixels);
    }
}
