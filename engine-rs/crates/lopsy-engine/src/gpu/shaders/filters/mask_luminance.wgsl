@group(0) @binding(0) var u_tex: texture_2d<f32>;
@group(0) @binding(1) var u_tex_sampler: sampler;

// A layer mask is grey with alpha 1 and the compositor reads only .r, so a
// filter run on a mask is folded back to Rec. 709 luminance; transparent
// output counts as black (hidden).
@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let c = textureSample(u_tex, u_tex_sampler, uv);
    let v = clamp(dot(c.rgb, vec3<f32>(0.2126, 0.7152, 0.0722)) * c.a, 0.0, 1.0);
    return vec4<f32>(v, v, v, 1.0);
}
