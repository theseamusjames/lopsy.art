struct Params {
    u_variance: f32,
    u_strength: f32,
    u_seed: f32,
}
@group(0) @binding(0) var<uniform> params: Params;

//#include lattice_hash

fn hash(value: f32) -> f32 {
    return lattice_hash(vec2<f32>(value, -1.0), params.u_seed);
}

fn hash2(p: vec2<f32>) -> f32 {
    return lattice_hash(p, params.u_seed);
}

fn noise1d(x: f32) -> f32 {
    let i = floor(x);
    var f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), f);
}

fn noise2d(p: vec2<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    let a = hash2(i);
    let b = hash2(i + vec2<f32>(1.0, 0.0));
    let c = hash2(i + vec2<f32>(0.0, 1.0));
    let d = hash2(i + vec2<f32>(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let strengthNorm = params.u_strength / 64.0;
    let varianceNorm = params.u_variance / 64.0;

    let verticalFreq = 80.0 + strengthNorm * 320.0;
    let horizontalWander = (1.0 - strengthNorm) * 0.15;

    var fiber = 0.0;
    var totalWeight = 0.0;

    for (var i: i32 = 0; i < 5; i++) {
        let fi = f32(i);
        let freq = verticalFreq * pow(1.8, fi);
        let amp = 1.0 / pow(1.6, fi);

        let wander = horizontalWander * noise2d(vec2<f32>(uv.x * 20.0 + fi * 7.3, uv.y * 3.0 + params.u_seed));
        let xCoord = uv.x + wander;

        let n = noise1d(xCoord * freq + fi * 100.0 + params.u_seed * 13.7);
        fiber += n * amp;
        totalWeight += amp;
    }
    fiber /= totalWeight;

    let detail = noise2d(vec2<f32>(uv.x * 200.0, uv.y * 8.0) + params.u_seed * 5.0);
    fiber = mix(fiber, detail, 0.15);

    let colorVariation = noise1d(uv.x * 30.0 + params.u_seed * 7.0) * varianceNorm;
    fiber = mix(0.5, fiber, 0.5 + varianceNorm * 0.5);
    fiber += (colorVariation - varianceNorm * 0.5) * 0.6;

    fiber = clamp(fiber, 0.0, 1.0);

    // #766: fibers is a generator — write full alpha so the pattern
    // shows on a transparent layer, not just where alpha was already
    // opaque.
    return vec4<f32>(vec3<f32>(fiber), 1.0);
}
