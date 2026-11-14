struct Params {
    // Map output UV [0,1] to source UV via: srcUV = uv * u_scale + u_offset
    u_scale: vec2<f32>,
    u_offset: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let srcUV = uv * params.u_scale + params.u_offset;
    // Sampled before the test: WebGPU allows an implicit-derivative sample
    // only where control flow does not depend on a varying.
    let c = textureSample(u_tex, u_tex_sampler, srcUV);
    if (srcUV.x < 0.0 || srcUV.x > 1.0 || srcUV.y < 0.0 || srcUV.y > 1.0) {
        return vec4<f32>(0.0);
    }
    return c;
}
