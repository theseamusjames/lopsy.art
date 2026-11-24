// The develop chain's tone step: scene linear Rec. 2020 to rendered linear
// Rec. 2020 (engine/src/develop/tone.rs). The maths and the reasons for it
// are in lopsy_core::tone, the CPU reference; change the two together.
// Saturation, then highlight desaturation (in sRGB primaries), then the
// base curve on luminance with its shoulder above the table. Straight
// alpha, untouched; nothing clamped.
struct Params {
    // Rec. 2020 -> linear sRGB and back, for the highlight desaturation.
    u_toSrgb: mat3x3<f32>,
    u_fromSrgb: mat3x3<f32>,
    // Luminance weights of Rec. 2020.
    u_luma: vec3<f32>,
    u_saturation: f32,
    // 1 = blend sRGB channels above 1.0 toward their maximum.
    u_highlightDesat: i32,
    // Base-curve entries in u_curveLut (0 = no curve) and the LUT texture's
    // width.
    u_curveSize: i32,
    u_curveWidth: i32,
    // The table's last entry and its last segment's slope (lopsy_core::
    // tone::curve_top), and the shoulder's headroom.
    u_curveTop: f32,
    u_curveSlope: f32,
    u_shoulderHeadroom: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_curveLut: texture_2d<f32>;

//#include base_curve

fn toneCurve(l: f32, size: i32, width: i32) -> f32 {
    if (l > 1.0) {
        let rise = params.u_curveSlope * (l - 1.0);
        return params.u_curveTop + rise / (1.0 + rise / params.u_shoulderHeadroom);
    }
    return curveLookup(l, size, width);
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let c = textureLoad(u_tex, vec2<i32>(position.xy), 0);
    var rgb = c.rgb;

    let sat = params.u_saturation;
    if (abs(sat - 1.0) >= 1e-4) {
        let l = dot(rgb, params.u_luma);
        rgb = vec3<f32>(l) + sat * (rgb - vec3<f32>(l));
    }

    if (params.u_highlightDesat == 1) {
        var s = params.u_toSrgb * rgb;
        let m = max(max(s.r, s.g), s.b);
        if (m > 1.0) {
            let t = min((m - 1.0) / 0.5, 1.0);
            s = s + t * (vec3<f32>(m) - s);
            rgb = params.u_fromSrgb * s;
        }
    }

    let size = params.u_curveSize;
    if (size >= 2) {
        let width = params.u_curveWidth;
        let lum = dot(rgb, params.u_luma);
        if (lum <= 0.0) {
            rgb = vec3<f32>(toneCurve(0.0, size, width));
        } else {
            rgb = rgb * (toneCurve(lum, size, width) / lum);
        }
    }

    return vec4<f32>(rgb, c.a);
}
