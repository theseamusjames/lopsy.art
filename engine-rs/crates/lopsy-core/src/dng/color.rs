/// DNG color pipeline: white balance, color matrix, and gamma.

/// Compute white balance multipliers from AsShotNeutral.
/// AsShotNeutral gives the neutral color in camera RGB space.
/// We normalize to green = 1.0.
pub fn white_balance_multipliers(as_shot_neutral: &[f64]) -> [f32; 3] {
    if as_shot_neutral.len() < 3 {
        return [1.0, 1.0, 1.0];
    }
    let r = as_shot_neutral[0].max(1e-10);
    let g = as_shot_neutral[1].max(1e-10);
    let b = as_shot_neutral[2].max(1e-10);
    // Invert and normalize to green channel
    let inv_r = 1.0 / r;
    let inv_g = 1.0 / g;
    let inv_b = 1.0 / b;
    let scale = inv_g as f32;
    [
        (inv_r / inv_g as f64) as f32 * scale / scale,
        1.0,
        (inv_b / inv_g as f64) as f32 * scale / scale,
    ]
}

pub fn apply_white_balance(rgb: &mut [f32], wb: &[f32; 3]) {
    let len = rgb.len() / 3;
    for i in 0..len {
        rgb[i * 3] *= wb[0];
        rgb[i * 3 + 1] *= wb[1];
        rgb[i * 3 + 2] *= wb[2];
    }
}

/// Build camera RGB → sRGB matrix from DNG ForwardMatrix1.
/// ForwardMatrix maps camera RGB → XYZ (D50). We then apply XYZ → sRGB.
pub fn forward_matrix_to_srgb(fm: &[f64]) -> [f32; 9] {
    if fm.len() < 9 { return IDENTITY; }

    // ForwardMatrix is 3x3 row-major: camera RGB → XYZ (D50)
    let fm_mat = [
        fm[0], fm[1], fm[2],
        fm[3], fm[4], fm[5],
        fm[6], fm[7], fm[8],
    ];

    // XYZ (D50) → sRGB via Bradford chromatic adaptation D50→D65 then XYZ→sRGB
    // Combined matrix (standard):
    let xyz_to_srgb = [
        3.1338561, -1.6168667, -0.4906146,
       -0.9787684,  1.9161415,  0.0334540,
        0.0719453, -0.2289914,  1.4052427,
    ];

    mul_3x3(&xyz_to_srgb, &fm_mat)
}

/// Build camera RGB → sRGB matrix from DNG ColorMatrix1.
/// ColorMatrix maps XYZ → camera RGB. We need the inverse path.
pub fn color_matrix_to_srgb(cm: &[f64]) -> [f32; 9] {
    if cm.len() < 9 { return IDENTITY; }

    // ColorMatrix is XYZ → camera RGB (3x3 row-major)
    let cm_mat = [
        cm[0], cm[1], cm[2],
        cm[3], cm[4], cm[5],
        cm[6], cm[7], cm[8],
    ];

    // Invert to get camera RGB → XYZ
    let inv = match invert_3x3(&cm_mat) {
        Some(m) => m,
        None => return IDENTITY,
    };

    // Then XYZ (D65) → sRGB
    let xyz_to_srgb = [
        3.2404542, -1.5371385, -0.4985314,
       -0.9692660,  1.8760108,  0.0415560,
        0.0556434, -0.2040259,  1.0572252,
    ];

    mul_3x3(&xyz_to_srgb, &inv)
}

pub fn apply_matrix(rgb: &mut [f32], mat: &[f32; 9]) {
    let len = rgb.len() / 3;
    for i in 0..len {
        let r = rgb[i * 3];
        let g = rgb[i * 3 + 1];
        let b = rgb[i * 3 + 2];
        rgb[i * 3]     = mat[0] * r + mat[1] * g + mat[2] * b;
        rgb[i * 3 + 1] = mat[3] * r + mat[4] * g + mat[5] * b;
        rgb[i * 3 + 2] = mat[6] * r + mat[7] * g + mat[8] * b;
    }
}

/// Apply a precomputed LUT (4096 entries) to each RGB channel.
pub fn apply_lut(rgb: &mut [f32], lut: &[f32]) {
    let max_idx = (lut.len() - 1) as f32;
    for v in rgb.iter_mut() {
        let idx = (*v * max_idx).clamp(0.0, max_idx);
        let lo = idx as usize;
        let hi = (lo + 1).min(lut.len() - 1);
        let frac = idx - lo as f32;
        *v = lut[lo] * (1.0 - frac) + lut[hi] * frac;
    }
}

pub fn apply_srgb_gamma(rgb: &mut [f32]) {
    for v in rgb.iter_mut() {
        *v = linear_to_srgb(*v);
    }
}

fn linear_to_srgb(v: f32) -> f32 {
    let c = v.max(0.0);
    if c <= 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

const IDENTITY: [f32; 9] = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];

fn mul_3x3(a: &[f64; 9], b: &[f64; 9]) -> [f32; 9] {
    let mut out = [0.0f32; 9];
    for r in 0..3 {
        for c in 0..3 {
            let mut sum = 0.0f64;
            for k in 0..3 {
                sum += a[r * 3 + k] * b[k * 3 + c];
            }
            out[r * 3 + c] = sum as f32;
        }
    }
    out
}

fn invert_3x3(m: &[f64; 9]) -> Option<[f64; 9]> {
    let det = m[0] * (m[4] * m[8] - m[5] * m[7])
            - m[1] * (m[3] * m[8] - m[5] * m[6])
            + m[2] * (m[3] * m[7] - m[4] * m[6]);

    if det.abs() < 1e-10 { return None; }
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
