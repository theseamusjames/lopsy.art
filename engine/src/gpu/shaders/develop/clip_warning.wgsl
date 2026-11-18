// The clipping warning on the live frame (never in exports): highlights
// (any channel at or above 1) in red, shadows (any channel at or below 0)
// in blue.
struct Params {
    u_shadows: i32,
    u_highlights: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let src = textureLoad(u_tex, vec2<i32>(position.xy), 0);
    if (params.u_highlights == 1 && max(max(src.r, src.g), src.b) >= 1.0) {
        return vec4<f32>(1.0, 0.0, 0.0, src.a);
    }
    if (params.u_shadows == 1 && min(min(src.r, src.g), src.b) <= 0.0) {
        return vec4<f32>(0.0, 0.0, 1.0, src.a);
    }
    return src;
}
