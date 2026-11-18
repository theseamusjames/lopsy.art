// The proof-of-concept RAW develop stage (engine/src/develop/). Turns a
// composite holding linear camera RGB (from rafRenderLinearBand) into
// gamma-encoded sRGB, in the order lopsy_core::raf::develop::develop_reference
// documents: white balance -> camera matrix -> exposure -> saturation ->
// highlight desaturation -> base curve -> sRGB transfer. Straight alpha;
// alpha untouched; negatives clamped to 0; values above 1 kept.
struct Params {
    // Camera RGB -> linear sRGB.
    u_camToRgb: mat3x3<f32>,
    // Per-channel multipliers relative to the as-shot white balance.
    u_wbRatio: vec3<f32>,
    // 2^exposureEv, computed on the CPU as the reference does.
    u_exposureGain: f32,
    u_saturation: f32,
    // 1 = blend channels above 1.0 toward the maximum.
    u_highlightDesat: i32,
    // Base-curve entries in u_curveLut (0 = no curve) and the LUT texture's
    // width: entry i is texel (i % width, i / width).
    u_curveSize: i32,
    u_curveWidth: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_curveLut: texture_2d<f32>;

fn curveEntry(i: i32, width: i32) -> f32 {
    return textureLoad(u_curveLut, vec2<i32>(i % width, i / width), 0).r;
}

// Linear interpolation between entries, as dng::color::apply_lut does it.
// Hardware filtering would interpolate at the texture's own precision.
fn curveLookup(v: f32, size: i32, width: i32) -> f32 {
    let maxIdx = f32(size - 1);
    let idx = clamp(v * maxIdx, 0.0, maxIdx);
    let lo = i32(floor(idx));
    let hi = min(lo + 1, size - 1);
    let frac = idx - f32(lo);
    return curveEntry(lo, width) * (1.0 - frac) + curveEntry(hi, width) * frac;
}

fn linearToSrgb(v: f32) -> f32 {
    let c = max(v, 0.0);
    if (c <= 0.0031308) {
        return c * 12.92;
    }
    return 1.055 * pow(c, 1.0 / f32(2.4)) - 0.055;
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let c = textureLoad(u_tex, vec2<i32>(position.xy), 0);
    let luma709 = vec3<f32>(0.2126, 0.7152, 0.0722);

    var rgb = params.u_camToRgb * (c.rgb * params.u_wbRatio);
    rgb = rgb * params.u_exposureGain;

    let sat = params.u_saturation;
    if (abs(sat - 1.0) >= 1e-4) {
        let l = dot(rgb, luma709);
        rgb = vec3<f32>(l) + sat * (rgb - vec3<f32>(l));
    }

    if (params.u_highlightDesat == 1) {
        let m = max(max(rgb.r, rgb.g), rgb.b);
        if (m > 1.0) {
            let t = min((m - 1.0) / 0.5, 1.0);
            rgb = rgb + t * (vec3<f32>(m) - rgb);
        }
    }

    let size = params.u_curveSize;
    if (size >= 2) {
        let width = params.u_curveWidth;
        let lum = dot(rgb, luma709);
        if (lum <= 0.0) {
            rgb = vec3<f32>(curveLookup(0.0, size, width));
        } else {
            let scale = curveLookup(lum, size, width) / lum;
            rgb = max(rgb * scale, vec3<f32>(0.0));
        }
    }

    return vec4<f32>(linearToSrgb(rgb.r), linearToSrgb(rgb.g), linearToSrgb(rgb.b), c.a);
}
