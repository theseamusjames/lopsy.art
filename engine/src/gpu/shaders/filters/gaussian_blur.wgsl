struct Params {
    u_direction: vec2<f32>,
    // Kernel weights, four to a vector: weight i is u_weights[i / 4][i % 4].
    // A WGSL uniform struct cannot hold array<f32, 64>.
    u_weights: array<vec4<f32>, 16>,
    u_radius: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

fn weightAt(i: i32) -> f32 {
    return params.u_weights[i / 4][i % 4];
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let texelSize = 1.0 / vec2<f32>(textureDimensions(u_tex, 0));
    // The layer texture is straight alpha, so premultiply each tap before
    // the weighted sum — otherwise a transparent tap's RGB (typically 0)
    // drags the blurred edge color toward black/grey, then the blend
    // composites that as straight alpha and doubles the darkening (#919).
    let c0 = textureSample(u_tex, u_tex_sampler, uv);
    var result = vec4<f32>(c0.rgb * c0.a, c0.a) * weightAt(0);
    for (var i: i32 = 1; i <= 63; i++) {
        if (i > params.u_radius) { break; }
        let offset = params.u_direction * f32(i) * texelSize;
        let cp = textureSample(u_tex, u_tex_sampler, uv + offset);
        let cn = textureSample(u_tex, u_tex_sampler, uv - offset);
        result += vec4<f32>(cp.rgb * cp.a, cp.a) * weightAt(i);
        result += vec4<f32>(cn.rgb * cn.a, cn.a) * weightAt(i);
    }
    if (result.a > 1e-6) {
        return vec4<f32>(result.rgb / result.a, result.a);
    }
    return vec4<f32>(0.0);
}
