// The develop chain's look pass on rendered linear Rec. 2020
// (engine/src/develop/look.rs): colour in OkLab (Saturation and Vibrance,
// blended per pixel with the areas' through their masks, then Color by
// hue), colour grading and curves through the sRGB curve on Rec. 2020
// primaries. The maths is lopsy_core::look, the CPU reference; change the
// two together. Straight alpha, untouched; nothing clamped.
struct Params {
    // OkLab from and to linear Rec. 2020 (lopsy_core::look::oklab_matrices).
    u_lmsFromRgb: mat3x3<f32>,
    u_rgbFromLms: mat3x3<f32>,
    u_labFromLms: mat3x3<f32>,
    u_lmsFromLab: mat3x3<f32>,
    // Luminance weights of Rec. 2020.
    u_luma: vec3<f32>,
    // 1 = the colour step runs (any saturation, vibrance or mixer value,
    // the photo's or an area's).
    u_colorOn: i32,
    u_vibrance: f32,
    u_saturation: f32,
    // Vibrance strength and the chroma at which it stops.
    u_vibConsts: vec2<f32>,
    // 1 = Color by hue has a value; its 24 values, as color_mixer.wgsl.
    u_mixerOn: i32,
    u_mixer: array<vec4<f32>, 6>,
    // The eight band centres, degrees.
    u_bandHues: array<vec4<f32>, 2>,
    // Hue shift at ±100 (degrees), lightness shift at ±100, the chroma
    // where the lightness shift is full, 0.
    u_mixerConsts: vec4<f32>,
    // 1 = a grade is set; its 18 values: four wheels, exponent, width.
    u_gradeOn: i32,
    u_grade: array<vec4<f32>, 5>,
    // 1 where a curve (master, red, green, blue) is not the identity; the
    // curves texture's width and entries per curve.
    u_curveOn: vec4<f32>,
    u_curveWidth: i32,
    u_curveSize: i32,
    // The areas' 16 floats each and how many; each area's layer Vibrance.
    u_areas: array<vec4<f32>, 32>,
    u_areaCount: i32,
    u_areaVibrance: array<vec4<f32>, 2>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_curves: texture_2d<f32>;

//#include area_mask
//#include working_space

fn cbrtOdd(v: f32) -> f32 {
    let r = pow(abs(v), 1.0 / f32(3.0));
    return select(r, -r, v < 0.0);
}

fn toLab(c: vec3<f32>) -> vec3<f32> {
    let lms = params.u_lmsFromRgb * c;
    return params.u_labFromLms * vec3<f32>(cbrtOdd(lms.x), cbrtOdd(lms.y), cbrtOdd(lms.z));
}

fn fromLab(lab: vec3<f32>) -> vec3<f32> {
    let l = params.u_lmsFromLab * lab;
    return params.u_rgbFromLms * (l * l * l);
}

fn colorStep(c: vec3<f32>, sat: f32, vib: f32) -> vec3<f32> {
    let lab = toLab(c);
    let chroma = sqrt(lab.y * lab.y + lab.z * lab.z);
    let hue = degrees(atan2(lab.z, lab.y));
    var dh = 0.0;
    var ds = 0.0;
    var dl = 0.0;
    if (params.u_mixerOn == 1) {
        var bh = params.u_bandHues;
        var hues = array<f32, 8>(bh[0].x, bh[0].y, bh[0].z, bh[0].w, bh[1].x, bh[1].y, bh[1].z, bh[1].w);
        var mixer = params.u_mixer;
        var flat: array<f32, 24>;
        for (var q = 0; q < 6; q++) {
            flat[q * 4] = mixer[q].x;
            flat[q * 4 + 1] = mixer[q].y;
            flat[q * 4 + 2] = mixer[q].z;
            flat[q * 4 + 3] = mixer[q].w;
        }
        // lopsy_core::color_mixer::band_weights: the band below the hue and
        // the smoothstep of the way to the next one.
        let hw = hue - 360.0 * floor(hue / 360.0);
        var i0 = 0;
        var w1 = 0.0;
        for (var i = 0; i < 8; i++) {
            let lo = hues[i];
            var hi = hues[0] + 360.0;
            if (i < 7) {
                hi = hues[i + 1];
            }
            var hh = hw;
            if (i == 7 && hw < hues[0]) {
                hh = hw + 360.0;
            }
            if (hh >= lo && hh < hi) {
                let t = (hh - lo) / (hi - lo);
                i0 = i;
                w1 = t * t * (3.0 - 2.0 * t);
                break;
            }
        }
        var i1 = i0 + 1;
        if (i1 == 8) {
            i1 = 0;
        }
        let w0 = 1.0 - w1;
        dh = w0 * flat[i0 * 3] + w1 * flat[i1 * 3];
        ds = w0 * flat[i0 * 3 + 1] + w1 * flat[i1 * 3 + 1];
        dl = w0 * flat[i0 * 3 + 2] + w1 * flat[i1 * 3 + 2];
    }
    if (sat == 0.0 && vib == 0.0 && dh == 0.0 && ds == 0.0 && dl == 0.0) {
        return c;
    }
    let vibK = 1.0 + vib / 100.0 * params.u_vibConsts.x * (1.0 - smoothstep1(0.0, params.u_vibConsts.y, chroma));
    // (100 + s) / 100 is exactly 0 at −100 however the division is done,
    // so Saturation −100 is exactly grey.
    let k = max((100.0 + sat) / 100.0, 0.0) * max(vibK, 0.0) * max((100.0 + ds) / 100.0, 0.0);
    let newC = chroma * k;
    let mc = params.u_mixerConsts;
    let newL = lab.x + dl / 100.0 * mc.y * min(chroma / mc.z, 1.0);
    if (newC == 0.0) {
        return vec3<f32>(newL * newL * newL);
    }
    let h = radians(hue + dh / 100.0 * mc.x);
    return fromLab(vec3<f32>(newL, newC * cos(h), newC * sin(h)));
}

fn gradeStep(c: vec3<f32>) -> vec3<f32> {
    var g = params.u_grade;
    let l = dot(c, params.u_luma);
    let tone = pow(clamp(srgbEncodeExt(l), 0.0, 1.0), g[4].x);
    let width = g[4].y;
    let sw = 1.0 - smoothstep1(1.0 / 3.0 - width, 1.0 / 3.0 + width, tone);
    let hw = smoothstep1(2.0 / 3.0 - width, 2.0 / 3.0 + width, tone);
    let mw = 1.0 - sw - hw;
    let grade = g[3] + g[0] * sw + g[1] * mw + g[2] * hw;
    let o = grade.rgb + vec3<f32>(grade.a);
    if (all(o == vec3<f32>(0.0))) {
        return c;
    }
    var e = vec3<f32>(srgbEncodeExt(c.r), srgbEncodeExt(c.g), srgbEncodeExt(c.b));
    let x = e + o;
    let f = 0.25 * max(-o, vec3<f32>(0.0));
    let eased = 0.5 * (x + sqrt(x * x + 4.0 * f * f));
    e = select(x, eased, o < vec3<f32>(0.0));
    return vec3<f32>(srgbDecodeExt(e.r), srgbDecodeExt(e.g), srgbDecodeExt(e.b));
}

fn curveTexel(i: i32) -> vec4<f32> {
    let w = params.u_curveWidth;
    return textureLoad(u_curves, vec2<i32>(i % w, i / w), 0);
}

// Table `ch` (0 master, 1 red, 2 green, 3 blue) at v: lopsy_core::look::curve_at.
fn curveAt(v: f32, ch: i32) -> f32 {
    let n = params.u_curveSize - 1;
    let maxIdx = f32(n);
    var lo = 0;
    var frac = 0.0;
    var below = false;
    var above = false;
    if (v <= 0.0) {
        below = true;
    } else if (v >= 1.0) {
        above = true;
        lo = n - 1;
    } else {
        let idx = v * maxIdx;
        lo = min(i32(floor(idx)), n - 1);
        frac = idx - f32(lo);
    }
    var ta = curveTexel(lo);
    var tb = curveTexel(lo + 1);
    let a = ta[ch];
    let b = tb[ch];
    if (below) {
        return a + (b - a) * maxIdx * v;
    }
    if (above) {
        return b + (b - a) * maxIdx * (v - 1.0);
    }
    return a * (1.0 - frac) + b * frac;
}

fn curvesStep(c: vec3<f32>) -> vec3<f32> {
    let on = params.u_curveOn;
    var e = vec3<f32>(srgbEncodeExt(c.r), srgbEncodeExt(c.g), srgbEncodeExt(c.b));
    if (on.x > 0.5) {
        e = vec3<f32>(curveAt(e.r, 0), curveAt(e.g, 0), curveAt(e.b, 0));
    }
    var r = e.r;
    var g = e.g;
    var b = e.b;
    if (on.y > 0.5) {
        r = curveAt(r, 1);
    }
    if (on.z > 0.5) {
        g = curveAt(g, 2);
    }
    if (on.w > 0.5) {
        b = curveAt(b, 3);
    }
    return vec3<f32>(srgbDecodeExt(r), srgbDecodeExt(g), srgbDecodeExt(b));
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let src = textureLoad(u_tex, vec2<i32>(position.xy), 0);
    var rgb = src.rgb;

    if (params.u_colorOn == 1) {
        var sat = params.u_saturation;
        var vib = params.u_vibrance;
        var areas = params.u_areas;
        var av = params.u_areaVibrance;
        var vibs = array<f32, 8>(av[0].x, av[0].y, av[0].z, av[0].w, av[1].x, av[1].y, av[1].z, av[1].w);
        for (var i = 0; i < 8; i++) {
            if (i >= params.u_areaCount) {
                break;
            }
            let mk = areaMask(areas[i * 4], areas[i * 4 + 1], areas[i * 4 + 2], position.xy);
            if (mk > 0.0) {
                sat = sat + mk * areas[i * 4 + 3].w;
                vib = vib + mk * vibs[i];
            }
        }
        rgb = colorStep(rgb, sat, vib);
    }
    if (params.u_gradeOn == 1) {
        rgb = gradeStep(rgb);
    }
    if (any(params.u_curveOn > vec4<f32>(0.5))) {
        rgb = curvesStep(rgb);
    }
    return vec4<f32>(rgb, src.a);
}
