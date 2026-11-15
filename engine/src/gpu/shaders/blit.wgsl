@group(0) @binding(0) var u_tex: texture_2d<f32>;
@group(0) @binding(1) var u_tex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    return textureSample(u_tex, u_tex_sampler, uv);
}
