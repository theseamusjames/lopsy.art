// The develop chain's tone pass: scene linear Rec. 2020 to rendered linear
// Rec. 2020 (engine/src/develop/tone.rs). First tone on scene data, the maths
// of lopsy_core::scene_tone: the photo's and the areas' exposure, white
// balance and tone sliders blended per pixel through the areas' masks, a
// gain, and the tone map on luminance in stops. Then the profile's part,
// lopsy_core::tone: saturation, highlight desaturation (in sRGB primaries),
// the base curve on luminance with its shoulder above the table. Change
// each with its reference. Straight alpha, untouched; nothing clamped.
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
    // 0 skips tone on scene data altogether.
    u_sceneOn: i32,
    // The photo's exposure (EV), temperature and tint (recipe units).
    u_exposure: f32,
    u_temperature: f32,
    u_tint: f32,
    // Contrast, highlights, shadows, whites (recipe units); blacks below.
    u_tone: vec4<f32>,
    u_blacks: f32,
    // White balance stops at ±100: temperature, tint.
    u_wbStops: vec2<f32>,
    // Contrast stops, least slope, luminance floor, middle grey.
    u_toneConsts: vec4<f32>,
    // Knot positions in stops (6 of 8 used).
    u_knots: array<vec4<f32>, 2>,
    // Four sliders' knot rows (highlights, shadows, whites, blacks), each
    // 6 floats at −100 then 6 at +100.
    u_rows: array<vec4<f32>, 12>,
    // The areas' 16 floats each (lopsy_core::areas) and how many there are.
    u_areas: array<vec4<f32>, 32>,
    u_areaCount: i32,
    // Each area's layer: (whites, blacks, 0, 0).
    u_areaTone: array<vec4<f32>, 8>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_curveLut: texture_2d<f32>;

//#include base_curve
//#include area_mask

fn toneCurve(l: f32, size: i32, width: i32) -> f32 {
    if (l > 1.0) {
        let rise = params.u_curveSlope * (l - 1.0);
        return params.u_curveTop + rise / (1.0 + rise / params.u_shoulderHeadroom);
    }
    return curveLookup(l, size, width);
}

// The factor luminance l is scaled by, for the tone sliders s (contrast,
// highlights, shadows, whites) and b (blacks): lopsy_core::scene_tone::
// knot_outputs, tangents, eval and gain_at.
fn toneGain(l: f32, s: vec4<f32>, b: f32) -> f32 {
    var kn = params.u_knots;
    var rows = params.u_rows;
    var flat: array<f32, 48>;
    for (var q = 0; q < 12; q++) {
        flat[q * 4] = rows[q].x;
        flat[q * 4 + 1] = rows[q].y;
        flat[q * 4 + 2] = rows[q].z;
        flat[q * 4 + 3] = rows[q].w;
    }
    var x = array<f32, 6>(kn[0].x, kn[0].y, kn[0].z, kn[0].w, kn[1].x, kn[1].y);
    let gain = exp2(params.u_toneConsts.x * s.x / 100.0);
    var y: array<f32, 6>;
    for (var i = 0; i < 6; i++) {
        y[i] = gain * x[i];
    }
    var sliders = array<f32, 4>(s.y, s.z, s.w, b);
    for (var r = 0; r < 4; r++) {
        let v = sliders[r];
        var base = r * 12 + 6;
        var k = v / 100.0;
        if (v < 0.0) {
            base = r * 12;
            k = -v / 100.0;
        }
        for (var i = 0; i < 6; i++) {
            y[i] = y[i] + k * flat[base + i];
        }
    }
    let minSlope = params.u_toneConsts.y;
    for (var i = 3; i < 6; i++) {
        y[i] = max(y[i], y[i - 1] + minSlope * (x[i] - x[i - 1]));
    }
    for (var j = 0; j < 2; j++) {
        let i = 1 - j;
        y[i] = min(y[i], y[i + 1] - minSlope * (x[i + 1] - x[i]));
    }
    var d: array<f32, 5>;
    for (var i = 0; i < 5; i++) {
        d[i] = (y[i + 1] - y[i]) / (x[i + 1] - x[i]);
    }
    var m: array<f32, 6>;
    m[0] = d[0];
    m[5] = d[4];
    for (var i = 1; i < 5; i++) {
        m[i] = 0.5 * (d[i - 1] + d[i]);
    }
    for (var i = 0; i < 5; i++) {
        let a = m[i] / d[i];
        let bb = m[i + 1] / d[i];
        let sq = a * a + bb * bb;
        if (sq > 9.0) {
            let t = 3.0 / sqrt(sq);
            m[i] = t * a * d[i];
            m[i + 1] = t * bb * d[i];
        }
    }

    let xs = log2(max(l, params.u_toneConsts.z) / params.u_toneConsts.w);
    var ys = 0.0;
    if (xs <= x[0]) {
        ys = y[0] + m[0] * (xs - x[0]);
    } else if (xs >= x[5]) {
        ys = y[5] + m[5] * (xs - x[5]);
    } else {
        var i = 0;
        for (var k = 0; k < 4; k++) {
            if (xs > x[k + 1]) {
                i = k + 1;
            }
        }
        let h = x[i + 1] - x[i];
        let t = (xs - x[i]) / h;
        let t2 = t * t;
        let t3 = t2 * t;
        ys = (2.0 * t3 - 3.0 * t2 + 1.0) * y[i] + (t3 - 2.0 * t2 + t) * h * m[i]
            + (-2.0 * t3 + 3.0 * t2) * y[i + 1] + (t3 - t2) * h * m[i + 1];
    }
    return exp2(ys - xs);
}

fn sceneTone(rgb_in: vec3<f32>, p: vec2<f32>) -> vec3<f32> {
    var rgb = rgb_in;
    var ev = params.u_exposure;
    var t = params.u_temperature;
    var tint = params.u_tint;
    var s = params.u_tone;
    var b = params.u_blacks;
    var areas = params.u_areas;
    var areaTone = params.u_areaTone;
    for (var i = 0; i < 8; i++) {
        if (i >= params.u_areaCount) {
            break;
        }
        let a2 = areas[i * 4 + 2];
        let a3 = areas[i * 4 + 3];
        let mk = areaMask(areas[i * 4], areas[i * 4 + 1], a2, p);
        if (mk > 0.0) {
            ev = ev + mk * a2.y;
            t = t + mk * a3.y;
            tint = tint + mk * a3.z;
            s = s + mk * vec4<f32>(a2.z, a2.w, a3.x, areaTone[i].x);
            b = b + mk * areaTone[i].y;
        }
    }
    if (ev != 0.0 || t != 0.0 || tint != 0.0) {
        let wbs = params.u_wbStops;
        let g = vec3<f32>(exp2(wbs.x * t / 100.0), exp2(-wbs.y * tint / 100.0), exp2(-wbs.x * t / 100.0));
        rgb = rgb * exp2(ev) * (g / dot(g, params.u_luma));
    }
    if (any(s != vec4<f32>(0.0)) || b != 0.0) {
        let l = dot(rgb, params.u_luma);
        if (l > 0.0) {
            rgb = rgb * toneGain(l, s, b);
        }
    }
    return rgb;
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let c = textureLoad(u_tex, vec2<i32>(position.xy), 0);
    var rgb = c.rgb;

    if (params.u_sceneOn == 1) {
        rgb = sceneTone(rgb, position.xy);
    }

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
