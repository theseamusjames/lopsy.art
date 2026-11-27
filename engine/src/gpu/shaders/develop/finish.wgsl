// Finish for the develop view: a shaped vignette and film grain. The maths
// is documented in lopsy_core::finish, the CPU reference; change the two
// together.
struct Params {
    // Vignette: amount, size, roundness, feather (recipe units).
    u_vignette: vec4<f32>,
    // Grain: amount, size, roughness, and the pixel scale.
    u_grain: vec4<f32>,
    // Document width and height in pixels.
    u_docSize: vec2<f32>,
    u_seed: u32,
    // Where the document lies in a larger picture (include/region.wgsl):
    // the vignette is the whole picture's, the grain at the whole's pixels.
    u_region: vec4<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;

//#include region

fn smoothstep1(e0: f32, e1: f32, x: f32) -> f32 {
    let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

fn vignetteMask(p: vec2<f32>, size: vec2<f32>) -> f32 {
    let half = 0.5 * size;
    var u = (p.x - half.x) / half.x;
    var v = (p.y - half.y) / half.y;
    let round = max(params.u_vignette.z / 100.0, 0.0);
    let halfMin = min(half.x, half.y);
    u = u + round * ((p.x - half.x) / halfMin - u);
    v = v + round * ((p.y - half.y) / halfMin - v);
    let n = 2.0 + 6.0 * max(-params.u_vignette.z / 100.0, 0.0);
    let d = pow(pow(abs(u), n) + pow(abs(v), n), 1.0 / n) / pow(2.0, 1.0 / n);
    let mid = 0.25 + 0.95 * params.u_vignette.y / 100.0;
    let width = 0.05 + 0.95 * params.u_vignette.w / 100.0;
    return smoothstep1(mid - 0.5 * width, mid + 0.5 * width, d);
}

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

fn valueNoise(p: vec2<f32>, cell: f32, seed: u32) -> f32 {
    let g = p / cell;
    let i = floor(g);
    let fx = smoothstep1(0.0, 1.0, g.x - i.x);
    let fy = smoothstep1(0.0, 1.0, g.y - i.y);
    let ix = u32(max(i.x, 0.0));
    let iy = u32(max(i.y, 0.0));
    let n00 = hash(ix, iy, seed);
    let n10 = hash(ix + 1u, iy, seed);
    let n01 = hash(ix, iy + 1u, seed);
    let n11 = hash(ix + 1u, iy + 1u, seed);
    let top = n00 + fx * (n10 - n00);
    let bottom = n01 + fx * (n11 - n01);
    return top + fy * (bottom - top);
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let src = textureLoad(u_tex, vec2<i32>(position.xy), 0);
    var c = src.rgb;
    let p = wholePoint(position.xy, params.u_region);
    var docSize = params.u_docSize;
    if (params.u_region.z > 0.0) {
        docSize = params.u_region.zw;
    }
    let a = params.u_vignette.x / 100.0;
    if (a != 0.0) {
        let k = vignetteMask(p, docSize);
        if (a < 0.0) {
            c = c * (1.0 + a * k);
        } else {
            c = c + a * k * (vec3<f32>(1.0) - c);
        }
    }
    let grain = params.u_grain.x;
    if (grain != 0.0) {
        let y = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
        let mid = 0.3 + 0.7 * clamp(4.0 * y * (1.0 - y), 0.0, 1.0);
        let scale = params.u_grain.w;
        let cell = 1.0 + 3.0 * params.u_grain.y / 100.0;
        let r = params.u_grain.z / 100.0;
        var n = 0.0;
        if (scale >= 1.0) {
            let g = p / scale;
            let coarse = valueNoise(g, cell, params.u_seed);
            let fine = valueNoise(g, 0.5 * cell, params.u_seed ^ 0x9E3779B9u);
            n = coarse + r * (fine - coarse) - 0.5;
        } else {
            // A working image: the full-size grain as a downscale shows it
            // (lopsy_core::finish::working_octave).
            let coarseCell = cell * scale;
            let fineCell = 0.5 * cell * scale;
            let coarse = valueNoise(p, max(coarseCell, 1.0), params.u_seed) - 0.5;
            let fine = valueNoise(p, max(fineCell, 1.0), params.u_seed ^ 0x9E3779B9u) - 0.5;
            // GRAIN_PREVIEW_GAIN in lopsy_core::finish.
            let coarseAmp = min(1.6 * max(cell, 1.0) * scale, 1.0);
            let fineAmp = min(1.6 * max(0.5 * cell, 1.0) * scale, 1.0);
            n = (1.0 - r) * coarseAmp * coarse + r * fineAmp * fine;
        }
        c = c + vec3<f32>(0.24 * grain / 100.0 * mid * n);
    }
    return vec4<f32>(max(c, vec3<f32>(0.0)), src.a);
}
