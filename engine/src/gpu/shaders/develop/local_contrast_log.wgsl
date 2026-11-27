// Large and small details on rendered linear Rec. 2020: the detail of log
// luminance at two radii, each shrunk by its neighbourhood's variance (a
// Wiener filter), scaled by its slider, and applied as one gain on all
// three channels. CPU reference:
// lopsy_core::linear_detail::local_contrast_log_reference, whose notes give
// the maths. Straight alpha, untouched; nothing clamped.
struct Params {
    u_luma: vec3<f32>,
    // The sliders' factors on the detail (linear_detail::detail_gain).
    u_largeGain: f32,
    u_smallGain: f32,
    // The variance scales, stops squared.
    u_largeEpsilon: f32,
    u_smallEpsilon: f32,
    u_floor: f32,
    u_centre: f32,
    // How u_small and u_large are read (include/region.wgsl, blurUv).
    u_smallGrid: vec4<f32>,
    u_largeGrid: vec4<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
// The log moments (luminance_stats.wgsl, mode 0) blurred at each radius;
// either may be a downscaled copy, read with bilinear filtering.
@group(0) @binding(2) var u_small: texture_2d<f32>;
@group(0) @binding(3) var u_small_sampler: sampler;
@group(0) @binding(4) var u_large: texture_2d<f32>;
@group(0) @binding(5) var u_large_sampler: sampler;

fn wienerDetail(x: f32, m: vec2<f32>, epsilon: f32) -> f32 {
    let variance = max(m.y - m.x * m.x, 0.0);
    return (x - m.x) * epsilon / (variance + epsilon);
}

//#include region

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<f32>(textureDimensions(u_tex, 0));
    let src = textureLoad(u_tex, vec2<i32>(position.xy), 0);
    let uvSmall = blurUv(position.xy, params.u_smallGrid, size);
    let uvLarge = blurUv(position.xy, params.u_largeGrid, size);
    let ms = textureSampleLevel(u_small, u_small_sampler, uvSmall, 0.0).rg;
    let ml = textureSampleLevel(u_large, u_large_sampler, uvLarge, 0.0).rg;
    let x = log2(max(dot(params.u_luma, src.rgb), 0.0) + params.u_floor) - params.u_centre;
    let dl = wienerDetail(x, ml, params.u_largeEpsilon);
    let ds = wienerDetail(x, ms, params.u_smallEpsilon);
    let gain = exp2(params.u_largeGain * dl + params.u_smallGain * ds);
    return vec4<f32>(src.rgb * gain, src.a);
}
