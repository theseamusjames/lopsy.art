struct Params {
    u_dstSize: vec2<f32>,
    u_srcSize: vec2<f32>,
    // Inverse map in pixel space: srcPos = u_linear * dstPos + u_offset.
    u_linear: mat2x2<f32>,
    u_offset: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let srcUV = (params.u_linear * (uv * params.u_dstSize) + params.u_offset) / params.u_srcSize;
    // Sampled before the test: WebGPU allows an implicit-derivative sample
    // only where control flow does not depend on a varying.
    let c = textureSample(u_tex, u_tex_sampler, srcUV);
    // Outside a mask's texture the compositor applies no mask, i.e. the
    // layer shows — so area the old mask never covered stays revealed.
    if (srcUV.x < 0.0 || srcUV.x > 1.0 || srcUV.y < 0.0 || srcUV.y > 1.0) {
        return vec4<f32>(1.0);
    }
    return c;
}
