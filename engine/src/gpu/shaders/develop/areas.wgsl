// Areas for the develop view: linear and radial gradient masks, each with
// local adjustments, applied in order; or one area's mask as a red overlay.
// The float layout, the mask maths and the adjustments are documented in
// lopsy_core::areas, the CPU reference; change the two together.
struct Params {
    // 16 floats per area, four vectors: (kind, invert, amount, x0),
    // (y0, x1, y1, rotation), (feather, exposure, contrast, highlights),
    // (shadows, temperature, tint, saturation).
    u_areas: array<vec4<f32>, 32>,
    u_count: i32,
    // 0 = apply the areas; 1 = overlay area u_overlay's mask.
    u_mode: i32,
    u_overlay: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;

fn smoothstep1(e0: f32, e1: f32, x: f32) -> f32 {
    let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

fn areaMask(a0: vec4<f32>, a1: vec4<f32>, a2: vec4<f32>, p: vec2<f32>) -> f32 {
    var m = 0.0;
    if (a0.x == 1.0) {
        let q = p - vec2<f32>(a0.w, a1.x);
        let s = sin(a1.w);
        let c = cos(a1.w);
        let u = (q.x * c + q.y * s) / max(abs(a1.y), 1e-3);
        let v = (-q.x * s + q.y * c) / max(abs(a1.z), 1e-3);
        let r = sqrt(u * u + v * v);
        m = 1.0 - smoothstep1(1.0 - max(a2.x, 1e-3), 1.0, r);
    } else {
        let d = vec2<f32>(a1.y - a0.w, a1.z - a1.x);
        let len2 = dot(d, d);
        if (len2 >= 1e-6) {
            let t = dot(p - vec2<f32>(a0.w, a1.x), d) / len2;
            m = 1.0 - smoothstep1(0.0, 1.0, t);
        }
    }
    if (a0.y >= 0.5) {
        m = 1.0 - m;
    }
    return m * a0.z;
}

fn toLinear(c: f32) -> f32 {
    if (c <= 0.04045) {
        return c / 12.92;
    }
    return pow((c + 0.055) / 1.055, 2.4);
}

fn toEncoded(v: f32) -> f32 {
    let c = max(v, 0.0);
    if (c <= 0.0031308) {
        return c * 12.92;
    }
    return 1.055 * pow(c, 1.0 / f32(2.4)) - 0.055;
}

fn luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn adjust(rgb: vec3<f32>, a2: vec4<f32>, a3: vec4<f32>, m: f32) -> vec3<f32> {
    if (m <= 0.0) {
        return rgb;
    }
    let gain = exp2(m * a2.y);
    let t = a3.y / 100.0;
    let wb = vec3<f32>(exp2(0.3 * m * t), exp2(-0.25 * m * a3.z / 100.0), exp2(-0.3 * m * t));
    var e = vec3<f32>(
        toEncoded(toLinear(rgb.r) * gain * wb.r),
        toEncoded(toLinear(rgb.g) * gain * wb.g),
        toEncoded(toLinear(rgb.b) * gain * wb.b),
    );
    let k = 1.0 + m * a2.z / 100.0;
    e = (e - vec3<f32>(0.5)) * k + vec3<f32>(0.5);
    let y = luma(e);
    let shift = 0.25 * m * (a2.w / 100.0 * smoothstep1(0.5, 1.0, y) + a3.x / 100.0 * (1.0 - smoothstep1(0.0, 0.5, y)));
    e = e + vec3<f32>(shift);
    let y2 = luma(e);
    let s = 1.0 + m * a3.w / 100.0;
    return max(vec3<f32>(y2) + s * (e - vec3<f32>(y2)), vec3<f32>(0.0));
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let src = textureLoad(u_tex, vec2<i32>(position.xy), 0);
    var areas = params.u_areas;
    if (params.u_mode == 1) {
        let i = params.u_overlay;
        let k = 0.5 * areaMask(areas[i * 4], areas[i * 4 + 1], areas[i * 4 + 2], position.xy);
        return vec4<f32>(src.rgb + k * (vec3<f32>(1.0, 0.1, 0.1) - src.rgb), src.a);
    }
    var rgb = src.rgb;
    for (var i = 0; i < 8; i++) {
        if (i >= params.u_count) {
            break;
        }
        let m = areaMask(areas[i * 4], areas[i * 4 + 1], areas[i * 4 + 2], position.xy);
        rgb = adjust(rgb, areas[i * 4 + 2], areas[i * 4 + 3], m);
    }
    return vec4<f32>(rgb, src.a);
}
