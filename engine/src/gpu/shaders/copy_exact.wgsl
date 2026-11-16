// Copies a texture texel for texel into a target of the same size. Unlike
// blit.wgsl it never samples: an interpolated UV lands a hair off the texel
// centre on a large target, and a filtered sample there mixes in a sliver
// of the neighbouring texel, so an undo snapshot taken and restored that way
// drifts by a step on antialiased edges.
@group(0) @binding(0) var u_tex: texture_2d<f32>;

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    return textureLoad(u_tex, vec2<i32>(position.xy), 0);
}
