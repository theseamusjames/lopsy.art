struct Params {
    u_threshold: f32, // 0.0 - 1.0
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let c = textureSample(u_tex, u_tex_sampler, uv);
    // Classic darkroom solarize: invert pixels brighter than threshold
    let inverted = 1.0 - c.rgb;
    let result = select(inverted, c.rgb, c.rgb < vec3<f32>(params.u_threshold));
    return vec4<f32>(result, c.a);
}
