// Haze on scene linear Rec. 2020, before the tone pass: the veil (the
// blurred darkest channel) taken away with exposure compensation, or a
// veil of the neighbourhood's light added. CPU reference:
// lopsy_core::linear_detail::haze_reference, whose notes give the maths.
// Straight alpha, untouched.
struct Params {
    // The slider over 100, -1..1.
    u_haze: f32,
    // linear_detail::HAZE_REMOVE, HAZE_ADD and scene_tone::MIDDLE_GREY.
    u_remove: f32,
    u_add: f32,
    u_middleGrey: f32,
    // How u_veil is read (include/region.wgsl, blurUv).
    u_veilGrid: vec4<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
// luminance_stats.wgsl's mode 1, blurred: the veil in R, the
// neighbourhood's luminance in G; a downscaled copy, read bilinearly.
@group(0) @binding(2) var u_veil: texture_2d<f32>;
@group(0) @binding(3) var u_veil_sampler: sampler;

//#include region

fn removeVeil(c: f32, v: f32) -> f32 {
    if (c > 0.0 && v > 0.0) {
        return c - v * (1.0 - exp(-c / v));
    }
    return c;
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<f32>(textureDimensions(u_tex, 0));
    let src = textureLoad(u_tex, vec2<i32>(position.xy), 0);
    let veil = textureSampleLevel(u_veil, u_veil_sampler, blurUv(position.xy, params.u_veilGrid, size), 0.0).rg;
    let h = params.u_haze;
    if (h > 0.0) {
        let v = params.u_remove * h * veil.x;
        let pivot = veil.x + params.u_middleGrey;
        let gain = pivot / removeVeil(pivot, v);
        let rgb = vec3<f32>(removeVeil(src.r, v), removeVeil(src.g, v), removeVeil(src.b, v));
        // Never brighter than it was: no glow where the veil is low.
        return vec4<f32>(min(src.rgb, rgb * gain), src.a);
    }
    let v = params.u_add * -h * veil.y;
    let gain = 1.0 / (1.0 + v / (veil.y + params.u_middleGrey));
    // Never darker than it was.
    return vec4<f32>(max(src.rgb, (src.rgb + vec3<f32>(v)) * gain), src.a);
}
