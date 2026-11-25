// An area's layer for the develop view: the composite with the area's own
// further adjustments applied to all of it (u_adjusted), laid over the
// composite (u_tex) with the area's mask as its opacity. CPU reference:
// lopsy_core::areas::area_layer_reference; change the two together.
struct Params {
    // The area's 16 floats, as in areas.wgsl.
    u_area: array<vec4<f32>, 4>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_adjusted: texture_2d<f32>;

//#include area_mask

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let texel = vec2<i32>(position.xy);
    let src = textureLoad(u_tex, texel, 0);
    let adjusted = textureLoad(u_adjusted, texel, 0);
    var area = params.u_area;
    let m = areaMask(area[0], area[1], area[2], position.xy);
    return vec4<f32>(src.rgb + m * (adjusted.rgb - src.rgb), src.a);
}
