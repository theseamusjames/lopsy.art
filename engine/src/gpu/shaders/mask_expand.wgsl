@group(0) @binding(0) var u_tex: texture_2d<f32>;
@group(0) @binding(1) var u_tex_sampler: sampler;

// Expands a single-channel R8 mask into the (v, v, v, 1) layout every mask
// sampler and mask-paint pass expects.
@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    return vec4<f32>(vec3<f32>(textureSample(u_tex, u_tex_sampler, uv).r), 1.0);
}
