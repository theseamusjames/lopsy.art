// Encoded CIELAB <-> sRGB, shared through `//#include lab`.
// Lab documents store encoded CIELAB in their textures (L in R, a in G,
// b in B; see engine/core/src/lab.rs). These mirror that module's math
// exactly, so a GPU decode/encode agrees with the CPU export path.
const LAB_D50_WHITE = vec3<f32>(0.9642, 1.0000, 0.8249);
const LAB_DELTA: f32 = 6.0 / 29.0;

const LAB_BRADFORD_D50_TO_D65 = mat3x3<f32>(
     0.9555766, -0.0282895,  0.0122982,
    -0.0230393,  1.0099416, -0.0204830,
     0.0631636,  0.0210077,  1.3299098,
);

const LAB_BRADFORD_D65_TO_D50 = mat3x3<f32>(
     1.0478112,  0.0295424, -0.0092345,
     0.0228866,  0.9904844,  0.0150436,
    -0.0501270, -0.0170491,  0.7521316,
);

const LAB_XYZ_D65_TO_SRGB = mat3x3<f32>(
     3.2404542, -0.9692660,  0.0556434,
    -1.5371385,  1.8760108, -0.2040259,
    -0.4985314,  0.0415560,  1.0572252,
);

const LAB_SRGB_TO_XYZ_D65 = mat3x3<f32>(
    0.4124564, 0.2126729, 0.0193339,
    0.3575761, 0.7151522, 0.1191920,
    0.1804375, 0.0721750, 0.9503041,
);

fn labF(t: f32) -> f32 {
    if (t > LAB_DELTA * LAB_DELTA * LAB_DELTA) {
        return pow(t, 1.0 / 3.0);
    }
    return t / (3.0 * LAB_DELTA * LAB_DELTA) + 4.0 / 29.0;
}

fn labFInv(t: f32) -> f32 {
    if (t > LAB_DELTA) {
        return t * t * t;
    }
    return 3.0 * LAB_DELTA * LAB_DELTA * (t - 4.0 / 29.0);
}

// The exponents divide by f32(2.4) so they fold in 32-bit float, as the
// GLSL these replace did; folding 1.0 / 2.4 at higher precision lands on
// the neighbouring f32.
fn labLinearToSrgb(value: f32) -> f32 {
    let v = clamp(value, 0.0, 1.0);
    if (v <= 0.0031308) {
        return v * 12.92;
    }
    return 1.055 * pow(v, 1.0 / f32(2.4)) - 0.055;
}

fn labSrgbToLinear(value: f32) -> f32 {
    let v = clamp(value, 0.0, 1.0);
    if (v <= 0.04045) {
        return v / 12.92;
    }
    return pow((v + 0.055) / 1.055, 2.4);
}

fn labToSrgb(encoded: vec3<f32>) -> vec3<f32> {
    let L = encoded.r * 100.0;
    let a = encoded.g * 255.0 - 128.0;
    let b = encoded.b * 255.0 - 128.0;

    let fy = (L + 16.0) / 116.0;
    let f = vec3<f32>(fy + a / 500.0, fy, fy - b / 200.0);
    let xyzD50 = vec3<f32>(labFInv(f.x), labFInv(f.y), labFInv(f.z)) * LAB_D50_WHITE;
    let lin = LAB_XYZ_D65_TO_SRGB * (LAB_BRADFORD_D50_TO_D65 * xyzD50);

    return vec3<f32>(labLinearToSrgb(lin.r), labLinearToSrgb(lin.g), labLinearToSrgb(lin.b));
}

fn srgbToLab(srgb: vec3<f32>) -> vec3<f32> {
    let lin = vec3<f32>(labSrgbToLinear(srgb.r), labSrgbToLinear(srgb.g), labSrgbToLinear(srgb.b));
    let xyz = (LAB_BRADFORD_D65_TO_D50 * (LAB_SRGB_TO_XYZ_D65 * lin)) / LAB_D50_WHITE;
    let f = vec3<f32>(labF(xyz.x), labF(xyz.y), labF(xyz.z));
    let L = 116.0 * f.y - 16.0;
    let a = 500.0 * (f.x - f.y);
    let b = 200.0 * (f.y - f.z);
    return clamp(
        vec3<f32>(L / 100.0, (a + 128.0) / 255.0, (b + 128.0) / 255.0),
        vec3<f32>(0.0),
        vec3<f32>(1.0),
    );
}
