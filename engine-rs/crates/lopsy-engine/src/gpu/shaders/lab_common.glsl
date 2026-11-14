// ─── Encoded CIELAB <-> sRGB ──────────────────────────────────────────
// Lab documents store encoded CIELAB in their textures (L in R, a in G,
// b in B; see lopsy-core/src/lab.rs). These mirror that module's math
// exactly, so a GPU decode/encode agrees with the CPU export path. Spliced in
// by `preprocess_frag` (shader.rs).
const vec3 LAB_D50_WHITE = vec3(0.9642, 1.0000, 0.8249);
const float LAB_DELTA = 6.0 / 29.0;

const mat3 LAB_BRADFORD_D50_TO_D65 = mat3(
     0.9555766, -0.0282895,  0.0122982,
    -0.0230393,  1.0099416, -0.0204830,
     0.0631636,  0.0210077,  1.3299098
);

const mat3 LAB_BRADFORD_D65_TO_D50 = mat3(
     1.0478112,  0.0295424, -0.0092345,
     0.0228866,  0.9904844,  0.0150436,
    -0.0501270, -0.0170491,  0.7521316
);

const mat3 LAB_XYZ_D65_TO_SRGB = mat3(
     3.2404542, -0.9692660,  0.0556434,
    -1.5371385,  1.8760108, -0.2040259,
    -0.4985314,  0.0415560,  1.0572252
);

const mat3 LAB_SRGB_TO_XYZ_D65 = mat3(
    0.4124564, 0.2126729, 0.0193339,
    0.3575761, 0.7151522, 0.1191920,
    0.1804375, 0.0721750, 0.9503041
);

float labF(float t) {
    return t > LAB_DELTA * LAB_DELTA * LAB_DELTA
        ? pow(t, 1.0 / 3.0)
        : t / (3.0 * LAB_DELTA * LAB_DELTA) + 4.0 / 29.0;
}

float labFInv(float t) {
    return t > LAB_DELTA ? t * t * t : 3.0 * LAB_DELTA * LAB_DELTA * (t - 4.0 / 29.0);
}

float labLinearToSrgb(float v) {
    v = clamp(v, 0.0, 1.0);
    return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

float labSrgbToLinear(float v) {
    v = clamp(v, 0.0, 1.0);
    return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4);
}

vec3 labToSrgb(vec3 encoded) {
    float L = encoded.r * 100.0;
    float a = encoded.g * 255.0 - 128.0;
    float b = encoded.b * 255.0 - 128.0;

    float fy = (L + 16.0) / 116.0;
    vec3 f = vec3(fy + a / 500.0, fy, fy - b / 200.0);
    vec3 xyzD50 = vec3(labFInv(f.x), labFInv(f.y), labFInv(f.z)) * LAB_D50_WHITE;
    vec3 linear = LAB_XYZ_D65_TO_SRGB * (LAB_BRADFORD_D50_TO_D65 * xyzD50);

    return vec3(labLinearToSrgb(linear.r), labLinearToSrgb(linear.g), labLinearToSrgb(linear.b));
}

vec3 srgbToLab(vec3 srgb) {
    vec3 linear = vec3(labSrgbToLinear(srgb.r), labSrgbToLinear(srgb.g), labSrgbToLinear(srgb.b));
    vec3 xyz = (LAB_BRADFORD_D65_TO_D50 * (LAB_SRGB_TO_XYZ_D65 * linear)) / LAB_D50_WHITE;
    vec3 f = vec3(labF(xyz.x), labF(xyz.y), labF(xyz.z));
    float L = 116.0 * f.y - 16.0;
    float a = 500.0 * (f.x - f.y);
    float b = 200.0 * (f.y - f.z);
    return clamp(vec3(L / 100.0, (a + 128.0) / 255.0, (b + 128.0) / 255.0), 0.0, 1.0);
}
