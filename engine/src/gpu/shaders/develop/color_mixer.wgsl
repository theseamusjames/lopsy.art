// Color by hue (Photos' colour mixer) in OkLCh on display-referred,
// sRGB-encoded, straight-alpha pixels. The CPU reference, with the band
// centres and every constant explained, is lopsy_core::color_mixer; change
// the two together.
struct Params {
    // (hue, saturation, luminance) per band in −100..100, band order red,
    // orange, yellow, green, aqua, blue, purple, magenta, packed four floats
    // to a vector.
    u_values: array<vec4<f32>, 6>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;

const PI: f32 = 3.14159265;
const HUE_SHIFT_MAX_DEG: f32 = 30.0;
const LUM_SHIFT_MAX: f32 = 0.15;
const LUM_FULL_CHROMA: f32 = 0.08;
const GAMUT_STEPS: i32 = 12;

fn srgbToLinear(c: f32) -> f32 {
    if (c <= 0.04045) {
        return c / 12.92;
    }
    return pow((c + 0.055) / 1.055, 2.4);
}

fn linearToSrgb(v: f32) -> f32 {
    let c = max(v, 0.0);
    if (c <= 0.0031308) {
        return c * 12.92;
    }
    return 1.055 * pow(c, 1.0 / f32(2.4)) - 0.055;
}

fn cbrt(x: f32) -> f32 {
    return sign(x) * pow(abs(x), 1.0 / f32(3.0));
}

fn linearToOklab(c: vec3<f32>) -> vec3<f32> {
    let l = cbrt(0.41222147 * c.r + 0.53633255 * c.g + 0.051445995 * c.b);
    let m = cbrt(0.2119035 * c.r + 0.6806995 * c.g + 0.10739696 * c.b);
    let s = cbrt(0.08830246 * c.r + 0.28171885 * c.g + 0.6299787 * c.b);
    return vec3<f32>(
        0.21045426 * l + 0.7936178 * m - 0.004072047 * s,
        1.9779985 * l - 2.4285922 * m + 0.4505937 * s,
        0.025904037 * l + 0.78277177 * m - 0.80867577 * s,
    );
}

fn oklabToLinear(lab: vec3<f32>) -> vec3<f32> {
    let l0 = lab.x + 0.39633778 * lab.y + 0.21580376 * lab.z;
    let m0 = lab.x - 0.105561346 * lab.y - 0.06385417 * lab.z;
    let s0 = lab.x - 0.08948418 * lab.y - 1.2914855 * lab.z;
    let l = l0 * l0 * l0;
    let m = m0 * m0 * m0;
    let s = s0 * s0 * s0;
    return vec3<f32>(
        4.0767417 * l - 3.3077116 * m + 0.23096994 * s,
        -1.268438 * l + 2.6097574 * m - 0.34131938 * s,
        -0.0041960863 * l - 0.7034186 * m + 1.7076147 * s,
    );
}

fn inGamut(c: vec3<f32>) -> bool {
    return all(c >= vec3<f32>(-1e-4)) && all(c <= vec3<f32>(1.0 + 1e-4));
}

fn atChroma(l: f32, c: f32, h: f32) -> vec3<f32> {
    return oklabToLinear(vec3<f32>(l, c * cos(h), c * sin(h)));
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let src = textureLoad(u_tex, vec2<i32>(position.xy), 0);
    var hues = array<f32, 9>(25.0, 55.0, 100.0, 140.0, 195.0, 255.0, 295.0, 330.0, 385.0);
    var vals = params.u_values;

    let lin = vec3<f32>(srgbToLinear(src.r), srgbToLinear(src.g), srgbToLinear(src.b));
    let lab = linearToOklab(lin);
    let chroma = sqrt(lab.y * lab.y + lab.z * lab.z);
    let hueDeg = atan2(lab.z, lab.y) * (180.0 / PI);

    // The two bands around the hue and the smoothstep weight of the upper one.
    var h = hueDeg - 360.0 * floor(hueDeg / 360.0);
    if (h < hues[0]) {
        h = h + 360.0;
    }
    var lo = 7;
    for (var i = 0; i < 7; i++) {
        if (h >= hues[i] && h < hues[i + 1]) {
            lo = i;
        }
    }
    let hi = (lo + 1) % 8;
    let t = (h - hues[lo]) / (hues[lo + 1] - hues[lo]);
    let wHi = t * t * (3.0 - 2.0 * t);
    let wLo = 1.0 - wHi;

    var d = vec3<f32>(0.0);
    for (var k = 0; k < 3; k++) {
        let a = lo * 3 + k;
        let b = hi * 3 + k;
        d[k] = wLo * vals[a / 4][a % 4] + wHi * vals[b / 4][b % 4];
    }
    if (all(d == vec3<f32>(0.0))) {
        return src;
    }

    let newHue = (hueDeg + d.x / 100.0 * HUE_SHIFT_MAX_DEG) * (PI / 180.0);
    let newL = lab.x + d.z / 100.0 * LUM_SHIFT_MAX * min(chroma / LUM_FULL_CHROMA, 1.0);
    let wanted = chroma * max(1.0 + d.y / 100.0, 0.0);
    var out = atChroma(newL, wanted, newHue);
    if (wanted > chroma && !inGamut(out)) {
        var cLo = chroma;
        var cHi = wanted;
        for (var i = 0; i < GAMUT_STEPS; i++) {
            let mid = 0.5 * (cLo + cHi);
            if (inGamut(atChroma(newL, mid, newHue))) {
                cLo = mid;
            } else {
                cHi = mid;
            }
        }
        out = atChroma(newL, cLo, newHue);
    }
    let enc = vec3<f32>(linearToSrgb(out.r), linearToSrgb(out.g), linearToSrgb(out.b));
    return vec4<f32>(clamp(enc, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
}
