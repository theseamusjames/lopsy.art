// The develop chain's conversions in and out of the working space (linear
// Rec. 2020): engine/src/develop/working_space.rs. lopsy_core::working_space
// is the CPU reference. Straight alpha, untouched; nothing clamped.
//   u_mode 0: decode the extended sRGB curve, then u_matrix. The input step
//             of a photo that is not RAW (sRGB or Display P3 to Rec. 2020),
//             and the way back from the display encoding (sRGB to Rec. 2020).
//   u_mode 1: u_matrix, then encode the extended sRGB curve. Into the display
//             encoding the stages written for sRGB values work in.
struct Params {
    u_matrix: mat3x3<f32>,
    u_mode: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;

//#include working_space

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let c = textureLoad(u_tex, vec2<i32>(position.xy), 0);
    if (params.u_mode == 0) {
        let lin = vec3<f32>(srgbDecodeExt(c.r), srgbDecodeExt(c.g), srgbDecodeExt(c.b));
        return vec4<f32>(params.u_matrix * lin, c.a);
    }
    let m = params.u_matrix * c.rgb;
    return vec4<f32>(srgbEncodeExt(m.r), srgbEncodeExt(m.g), srgbEncodeExt(m.b), c.a);
}
