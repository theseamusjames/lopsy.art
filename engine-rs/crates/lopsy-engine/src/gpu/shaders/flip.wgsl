struct Params {
    u_flipH: i32,
    u_flipV: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    var srcUV = uv;
    if (params.u_flipH == 1) { srcUV.x = 1.0 - srcUV.x; }
    if (params.u_flipV == 1) { srcUV.y = 1.0 - srcUV.y; }
    return textureSample(u_tex, u_tex_sampler, srcUV);
}
