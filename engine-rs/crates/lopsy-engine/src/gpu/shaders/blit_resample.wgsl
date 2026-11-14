@group(0) @binding(0) var u_tex: texture_2d<f32>;

//#include premul_sample

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    return samplePremulBilinear(u_tex, uv);
}
