struct Params {
    u_scale: f32,
    u_seed: f32,
    u_turbulence: f32,
}
@group(0) @binding(0) var<uniform> params: Params;

fn hash(p: vec2<f32>) -> f32 {
    var p3 = fract(p.xyx * 0.1031 + params.u_seed * 0.01);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    let a = hash(i);
    let b = hash(i + vec2<f32>(1.0, 0.0));
    let c = hash(i + vec2<f32>(0.0, 1.0));
    let d = hash(i + vec2<f32>(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn fbm(p: vec2<f32>) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;

    for (var i: i32 = 0; i < 8; i++) {
        value += amplitude * noise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let p = uv * params.u_scale;

    // Turbulent displacement for smoke-like swirling
    let dx = fbm(p + vec2<f32>(3.7, 1.2)) * params.u_turbulence;
    let dy = fbm(p + vec2<f32>(8.3, 2.8)) * params.u_turbulence;
    var smoke = fbm(p + vec2<f32>(dx, dy));

    // Smoother, more wispy look
    smoke = smoothstep(0.2, 0.8, smoke);
    smoke *= smoke;

    // #766: smoke is a generator — write full alpha so it produces
    // visible output on a transparent layer instead of only recoloring
    // whatever alpha was already there.
    return vec4<f32>(vec3<f32>(smoke), 1.0);
}
