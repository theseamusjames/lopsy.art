struct Params {
    u_clockwise: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    var srcUV: vec2<f32>;
    if (params.u_clockwise == 1) {
        // CW: (x, y) → (y, 1-x)
        srcUV = vec2<f32>(uv.y, 1.0 - uv.x);
    } else {
        // CCW: (x, y) → (1-y, x)
        srcUV = vec2<f32>(1.0 - uv.y, uv.x);
    }
    return textureSample(u_tex, u_tex_sampler, srcUV);
}
