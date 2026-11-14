struct Params {
    u_curve: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

fn pqOETF(c: vec3<f32>) -> vec3<f32> {
    let m1 = 0.1593017578125;
    let m2 = 78.84375;
    let c1 = 0.8359375;
    let c2 = 18.8515625;
    let c3 = 18.6875;
    let ym1 = pow(max(c, vec3<f32>(0.0)), vec3<f32>(m1));
    return pow((c1 + c2 * ym1) / (1.0 + c3 * ym1), vec3<f32>(m2));
}

fn hlgOETF(c: vec3<f32>) -> vec3<f32> {
    let a = 0.17883277;
    let b = 0.28466892;
    let cc = 0.55991073;
    return mix(
        sqrt(3.0 * max(c, vec3<f32>(0.0))),
        a * log(max(12.0 * c - b, vec3<f32>(0.001))) + cc,
        step(vec3<f32>(1.0 / 12.0), c),
    );
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let c = textureSample(u_tex, u_tex_sampler, uv);
    if (params.u_curve == 0) {
        return vec4<f32>(pqOETF(c.rgb), c.a);
    }
    return vec4<f32>(hlgOETF(c.rgb), c.a);
}
