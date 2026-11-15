// Unified Texture filter. Each primitive yields a zero-centred value in
// [-1, 1] that is shaped (contrast), optionally lit as a height map
// (Relief), and added to the pixel. Parameters arrive pre-validated from
// lopsy_core::filters::texture.
struct Params {
    // 0 grain, 1 rough, 2 canvas, 3 streaks, 4 cells
    u_kind: i32,
    // 0 light & dark, 1 lighten, 2 darken, 3 relief
    u_blend: i32,
    // 0 - 1
    u_amount: f32,
    // feature size, px
    u_size: f32,
    // elongation along u_angle, >= 1
    u_stretch: f32,
    // radians
    u_angle: f32,
    // 1 - 6, fractional
    u_octaves: f32,
    // 0 - 1
    u_contrast: f32,
    // 0 or 1; a WGSL uniform struct cannot hold a bool.
    u_colored: i32,
    u_seed: u32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

const PI: f32 = 3.14159265359;

// PCG3D — Jarzynski & Olano, "Hash Functions for GPU Rendering" (JCGT 2020).
// Integer-only so the same seed gives bit-identical lattices on every backend.
fn pcg3d(value: vec3<u32>) -> vec3<u32> {
    var v = value * 1664525u + 1013904223u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v ^= v >> vec3<u32>(16u);
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    return v;
}

fn hashCell(c: vec2<i32>, salt: u32) -> vec3<u32> {
    // Masking keeps the int -> uint conversion defined for negative cells.
    let u = vec2<u32>(c & vec2<i32>(0x7FFFFFFF));
    return pcg3d(vec3<u32>(u.x, u.y, salt * 0x9E3779B9u + 0x632BE5ABu));
}

fn hash1(c: vec2<i32>, salt: u32) -> f32 {
    return f32(hashCell(c, salt).x) / 4294967295.0;
}

fn hash2(c: vec2<i32>, salt: u32) -> vec2<f32> {
    return vec2<f32>(hashCell(c, salt).xy) / 4294967295.0;
}

// Gradient noise: smooth, zero-centred, and free of the axis-aligned
// blockiness value noise shows once octaves are ridged or lit.
fn gradientNoise(p: vec2<f32>, salt: u32) -> f32 {
    let i = floor(p);
    let f = p - i;
    let c = vec2<i32>(i);
    let h00 = hash2(c, salt) * 2.0 - 1.0;
    let h10 = hash2(c + vec2<i32>(1, 0), salt) * 2.0 - 1.0;
    let h01 = hash2(c + vec2<i32>(0, 1), salt) * 2.0 - 1.0;
    let h11 = hash2(c + vec2<i32>(1, 1), salt) * 2.0 - 1.0;
    let a = dot(h00, f);
    let b = dot(h10, f - vec2<f32>(1.0, 0.0));
    let d = dot(h01, f - vec2<f32>(0.0, 1.0));
    let e = dot(h11, f - vec2<f32>(1.0, 1.0));
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(a, b, u.x), mix(d, e, u.x), u.y) * 2.0;
}

// Each octave is rotated (~37 degrees) as well as doubled so the lattices
// of successive octaves never line up.
const OCTAVE_STEP = mat2x2<f32>(1.6, 1.2, -1.2, 1.6);

fn octaveWeight(i: i32) -> f32 {
    return clamp(params.u_octaves - f32(i), 0.0, 1.0);
}

fn fbm(start: vec2<f32>, salt: u32) -> f32 {
    var p = start;
    var sum = 0.0;
    var amp = 1.0;
    var norm = 0.0;
    for (var i: i32 = 0; i < 6; i++) {
        let w = octaveWeight(i);
        if (w <= 0.0) { break; }
        sum += gradientNoise(p, salt + u32(i) * 101u) * amp * w;
        norm += amp * w;
        p = OCTAVE_STEP * p + vec2<f32>(17.31, 9.73);
        amp *= 0.5;
    }
    return sum / norm;
}

fn ridged(start: vec2<f32>, salt: u32) -> f32 {
    var p = start;
    var sum = 0.0;
    var amp = 1.0;
    var norm = 0.0;
    for (var i: i32 = 0; i < 6; i++) {
        let w = octaveWeight(i);
        if (w <= 0.0) { break; }
        let n = 1.0 - abs(gradientNoise(p, salt + u32(i) * 101u));
        sum += n * n * amp * w;
        norm += amp * w;
        p = OCTAVE_STEP * p + vec2<f32>(17.31, 9.73);
        amp *= 0.5;
    }
    return (sum / norm - 0.45) * 2.4;
}

// Extra detail beyond the first octave, 0 - 1, for primitives that use it
// as an amount rather than an octave count.
fn detailAmount() -> f32 {
    return (params.u_octaves - 1.0) / 5.0;
}

fn canvasWeave(q: vec2<f32>, salt: u32) -> f32 {
    let cell = floor(q);
    let f = q - cell;
    let c = vec2<i32>(cell);
    let isWarpOnTop = ((c.x + c.y) & 1) == 0;
    let across = sin(PI * f.x);
    let along = sin(PI * f.y);
    var h: f32;
    var tone: f32;
    var fiberQ: vec2<f32>;
    if (isWarpOnTop) {
        h = across * (0.55 + 0.45 * along);
        tone = hash1(vec2<i32>(c.x, 0), salt + 7u);
        fiberQ = vec2<f32>(q.x * 6.0, q.y * 0.75);
    } else {
        h = along * (0.55 + 0.45 * across);
        tone = hash1(vec2<i32>(0, c.y), salt + 13u);
        fiberQ = vec2<f32>(q.x * 0.75, q.y * 6.0);
    }
    let fiber = fbm(fiberQ, salt + 29u);
    h = h * (0.8 + 0.4 * (tone - 0.5)) + fiber * 0.4 * detailAmount();
    return h * 2.0 - 1.0;
}

fn cells(start: vec2<f32>, salt: u32) -> f32 {
    var q = start;
    let warp = detailAmount();
    if (warp > 0.0) {
        q += vec2<f32>(fbm(q * 0.5, salt + 41u), fbm(q * 0.5 + vec2<f32>(5.2, 1.3), salt + 43u)) * warp * 0.6;
    }
    let cell = floor(q);
    let f = q - cell;
    let c = vec2<i32>(cell);
    var f1 = 8.0;
    var f2 = 8.0;
    var tone = 0.5;
    for (var y: i32 = -1; y <= 1; y++) {
        for (var x: i32 = -1; x <= 1; x++) {
            let o = vec2<i32>(x, y);
            let pt = vec2<f32>(o) + 0.05 + 0.9 * hash2(c + o, salt + 3u);
            let d = length(pt - f);
            if (d < f1) {
                f2 = f1;
                f1 = d;
                tone = hash1(c + o, salt + 5u);
            } else if (d < f2) {
                f2 = d;
            }
        }
    }
    let edge = clamp((f2 - f1) * 2.5, 0.0, 1.0);
    return mix(edge, tone, 0.25) * 2.0 - 1.0;
}

fn toPattern(pos: vec2<f32>, extraStretch: f32) -> vec2<f32> {
    let dir = vec2<f32>(cos(params.u_angle), sin(params.u_angle));
    let perp = vec2<f32>(-dir.y, dir.x);
    return vec2<f32>(
        dot(pos, dir) / (params.u_size * params.u_stretch * extraStretch),
        dot(pos, perp) / params.u_size,
    );
}

fn pattern(pos: vec2<f32>, salt: u32) -> f32 {
    if (params.u_kind == 1) { return ridged(toPattern(pos, 1.0), salt); }
    if (params.u_kind == 2) { return canvasWeave(toPattern(pos, 1.0), salt); }
    if (params.u_kind == 3) { return fbm(toPattern(pos, 16.0), salt) * 2.0; }
    if (params.u_kind == 4) { return cells(toPattern(pos, 1.0), salt); }
    return fbm(toPattern(pos, 1.0), salt) * 2.0;
}

fn shaped(pos: vec2<f32>, salt: u32) -> f32 {
    return clamp(pattern(pos, salt) * (1.0 + 4.0 * params.u_contrast), -1.0, 1.0);
}

fn relief(pos: vec2<f32>, salt: u32) -> f32 {
    let h = shaped(pos, salt);
    // Slopes are per pixel; scaling by the feature size keeps the bevel
    // depth similar whether the features are 2 px or 200 px across.
    let k = 0.6 * max(params.u_size, 1.0);
    let g = vec2<f32>(
        shaped(pos + vec2<f32>(1.0, 0.0), salt) - h,
        shaped(pos + vec2<f32>(0.0, 1.0), salt) - h,
    ) * k;
    let n = normalize(vec3<f32>(-g, 1.0));
    // Texture row 0 is the top of the image, so the light sits up and left.
    let light = normalize(vec3<f32>(-0.5, -0.5, 0.7));
    return clamp((dot(n, light) - light.z) * 1.5, -1.0, 1.0);
}

fn textureValue(pos: vec2<f32>, salt: u32) -> f32 {
    if (params.u_blend == 3) { return relief(pos, salt); }
    let t = shaped(pos, salt);
    if (params.u_blend == 1) { return max(t, 0.0); }
    if (params.u_blend == 2) { return min(t, 0.0); }
    return t;
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let c = textureSample(u_tex, u_tex_sampler, uv);
    if (c.a <= 0.0) {
        return c;
    }
    let pos = position.xy;
    var t: vec3<f32>;
    if (params.u_colored != 0) {
        t = vec3<f32>(
            textureValue(pos, params.u_seed),
            textureValue(pos, params.u_seed + 7919u),
            textureValue(pos, params.u_seed + 15887u),
        );
    } else {
        t = vec3<f32>(textureValue(pos, params.u_seed));
    }
    return vec4<f32>(clamp(c.rgb + t * (params.u_amount * 0.6), vec3<f32>(0.0), vec3<f32>(1.0)), c.a);
}
