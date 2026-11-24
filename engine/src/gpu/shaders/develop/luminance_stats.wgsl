// The statistics image the linear local contrast and haze passes blur
// (engine/src/develop/detail.rs). CPU reference:
// lopsy_core::linear_detail::statistics. Two values in R and G, 0 in B,
// alpha 1 so the premultiplied box downscale reads them unchanged.
//   u_mode 0: x = log2(max(Y, 0) + u_floor) - u_centre, and x * x.
//   u_mode 1: the darkest channel and the luminance, each at least 0.
struct Params {
    // Luminance weights of the image's primaries.
    u_luma: vec3<f32>,
    u_mode: i32,
    u_floor: f32,
    u_centre: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let c = textureLoad(u_tex, vec2<i32>(position.xy), 0).rgb;
    let y = dot(params.u_luma, c);
    if (params.u_mode == 0) {
        let x = log2(max(y, 0.0) + params.u_floor) - params.u_centre;
        return vec4<f32>(x, x * x, 0.0, 1.0);
    }
    return vec4<f32>(max(min(min(c.r, c.g), c.b), 0.0), max(y, 0.0), 0.0, 1.0);
}
