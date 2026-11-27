// The develop chain's output step: rendered linear Rec. 2020 to what a
// screen or a file holds (engine/src/develop/output.rs). The method, its
// constants and the reasons for them are in lopsy_core::output, the CPU
// reference; change the two together. Highlight roll-off on luminance,
// gamut mapping toward the neutral axis in the target's primaries, the
// target's transfer curve, then dither. Straight alpha, untouched.
struct Params {
    // Rec. 2020 -> the target's linear RGB.
    u_toTarget: mat3x3<f32>,
    // Luminance weights of Rec. 2020 and of the target.
    u_luma: vec3<f32>,
    u_targetLuma: vec3<f32>,
    // The brightest value the target holds (1 for SDR) and where the
    // roll-off starts.
    u_peak: f32,
    u_knee: f32,
    // Fraction of the way to the boundary where compression starts; 1
    // compresses nothing and moves what is outside onto the boundary.
    u_gamutThreshold: f32,
    // 0 = the sRGB curve (extended past 1 for an HDR canvas), 1 =
    // v^(1 / u_gamma), 2 = the BT.709 / BT.2020 OETF, 3 = none (linear).
    u_transfer: i32,
    u_gamma: f32,
    // Dither from end to end in encoded units; 0 for none.
    u_dither: f32,
    // Where the document lies in a larger picture (include/region.wgsl):
    // the dither is the whole's at each pixel.
    u_region: vec4<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;

//#include working_space
//#include region

// lopsy_core::finish::hash, in exact integer arithmetic.
fn hash(ix: u32, iy: u32, seed: u32) -> f32 {
    var a = (ix + seed * 747796405u) * 1664525u + 1013904223u;
    var b = iy * 1664525u + 1013904223u;
    a = a + b * 1664525u;
    b = b + a * 1664525u;
    a = a ^ (a >> 16u);
    b = b ^ (b >> 16u);
    a = a + b * 1664525u;
    a = a ^ (a >> 16u);
    return f32(a >> 8u) / 16777216.0;
}

fn rolloff(l: f32) -> f32 {
    let knee = params.u_knee;
    let peak = params.u_peak;
    if (l <= knee) {
        return l;
    }
    if (knee >= peak) {
        return peak;
    }
    let e = l - knee;
    return knee + e / (1.0 + e / (peak - knee));
}

fn compress(u: f32) -> f32 {
    let t = params.u_gamutThreshold;
    if (t >= 1.0) {
        return min(u, 1.0);
    }
    if (u <= t) {
        return u;
    }
    let x = u - t;
    return t + x / (1.0 + x / (1.0 - t));
}

// BT.2020's alpha and beta, as lopsy_core::output::BT709_ALPHA and _BETA.
const BT709_ALPHA: f32 = 1.0992968;
const BT709_BETA: f32 = 0.01805397;

fn encode(v: f32) -> f32 {
    if (params.u_transfer == 3) {
        return v;
    }
    if (params.u_transfer == 1) {
        return pow(v, 1.0 / params.u_gamma);
    }
    if (params.u_transfer == 2) {
        if (v < BT709_BETA) {
            return 4.5 * v;
        }
        return BT709_ALPHA * pow(v, 0.45) - (BT709_ALPHA - 1.0);
    }
    return srgbEncodeExt(v);
}

// A channel this close under the peak is the peak (lopsy_core::output,
// PEAK_SNAP).
const PEAK_SNAP: f32 = 1e-5;

fn gamutMap(c: vec3<f32>) -> vec3<f32> {
    let peak = params.u_peak;
    let ach = max(max(c.r, c.g), c.b);
    if (ach <= 0.0) {
        return vec3<f32>(0.0);
    }
    let start = min(params.u_gamutThreshold, 1.0);
    var t = c;
    let d = (vec3<f32>(ach) - c) / ach;
    if (d.r > start) { t.r = ach - compress(d.r) * ach; }
    if (d.g > start) { t.g = ach - compress(d.g) * ach; }
    if (d.b > start) { t.b = ach - compress(d.b) * ach; }
    let y = dot(t, params.u_targetLuma);
    if (y >= peak) {
        return vec3<f32>(peak);
    }
    let u = (ach - y) / (peak - y);
    if (u > start) {
        // The largest channel's new value, reached by moving toward the grey
        // at y * y / peak (lopsy_core::output, step 2).
        let top = y + compress(u) * (peak - y);
        let a = y * (y / peak);
        t = vec3<f32>(a) + ((top - a) / (ach - a)) * (t - vec3<f32>(a));
    }
    return select(max(t, vec3<f32>(0.0)), vec3<f32>(peak), t > vec3<f32>(peak * (1.0 - PEAK_SNAP)));
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let c = textureLoad(u_tex, vec2<i32>(position.xy), 0);
    var rgb = c.rgb;
    let y = dot(rgb, params.u_luma);
    if (y > params.u_knee) {
        rgb = rgb * (rolloff(y) / y);
    }
    let t = gamutMap(params.u_toTarget * rgb);
    var e = vec3<f32>(encode(t.r), encode(t.g), encode(t.b));
    if (params.u_dither > 0.0) {
        let p = vec2<u32>(wholePoint(position.xy, params.u_region));
        e = e + vec3<f32>((hash(p.x, p.y, 0x5d17u) - 0.5) * params.u_dither);
    }
    return vec4<f32>(e, c.a);
}
