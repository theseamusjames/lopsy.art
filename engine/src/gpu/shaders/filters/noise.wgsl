struct Params {
    u_amount: f32,
    // 0 or 1; a WGSL uniform struct cannot hold a bool.
    u_monochrome: i32,
    // #668 — 0: uniform distribution (previous default); 1: Gaussian via
    // Box-Muller. Gaussian noise is visually softer and looks more like
    // real sensor / film grain.
    u_gaussian: i32,
    u_seed: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

// PCG3D — Jarzynski & Olano, "Hash Functions for GPU Rendering" (JCGT 2020)
// Cross-dimensional multiply ensures no axis-aligned correlation.
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

fn hash3(p: vec2<f32>) -> vec3<f32> {
    let ip = vec2<u32>(p);
    let s = bitcast<u32>(params.u_seed);
    // Mix x and y into the third input so PCG3D's cross-multiply has
    // entropy in all three lanes even when seed is zero.
    let v = pcg3d(vec3<u32>(ip.x, ip.y, ip.x * 0x4F5Du + ip.y * 0x9E37u + s));
    return vec3<f32>(v) / 4294967295.0;
}

// Convert two uniform values in (0,1] into one Gaussian sample via
// Box-Muller. We use only the cos branch — the sin branch is discarded
// (single sample per invocation) which is fine here since we call this
// for each channel with a separate pair of uniforms.
fn gaussianFromUniform(u1: f32, u2: f32) -> f32 {
    // Nudge u1 off zero so log() stays finite.
    let safeU1 = max(u1, 1.0e-6);
    // Scale down so +-3 sigma maps to +-0.5 amplitude (matches uniform range).
    return sqrt(-2.0 * log(safeU1)) * cos(6.28318530718 * u2) * (1.0 / 6.0);
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let c = textureSample(u_tex, u_tex_sampler, uv);
    let coord = position.xy;
    let n1 = hash3(coord);
    let isMonochrome = params.u_monochrome != 0;
    var rgb = c.rgb;
    if (params.u_gaussian != 0) {
        // Need a second batch of uniforms for the sin/cos pair.
        let n2 = hash3(coord + vec2<f32>(37.0, 71.0));
        if (isMonochrome) {
            let g = gaussianFromUniform(n1.x, n2.x);
            rgb += vec3<f32>(g) * params.u_amount;
        } else {
            rgb.r += gaussianFromUniform(n1.x, n2.x) * params.u_amount;
            rgb.g += gaussianFromUniform(n1.y, n2.y) * params.u_amount;
            rgb.b += gaussianFromUniform(n1.z, n2.z) * params.u_amount;
        }
    } else {
        if (isMonochrome) {
            rgb += (n1.x - 0.5) * params.u_amount;
        } else {
            rgb += (n1 - 0.5) * params.u_amount;
        }
    }
    return vec4<f32>(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)), c.a);
}
