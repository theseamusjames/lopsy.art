// Pixelate pass 2: every pixel takes its block's averaged colour and alpha
// (from pixelate_blocks.glsl), but only where the source pixel had any
// coverage (#1167). Point-sampling the block centre used to delete a
// partial block whose centre fell outside the content and grow one whose
// centre fell inside it; keeping the source footprint does neither.
struct Params {
    u_blockSize: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_blocks: texture_2d<f32>;

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let p = vec2<i32>(position.xy);
    if (textureLoad(u_tex, p, 0).a <= 0.0) {
        return vec4<f32>(0.0);
    }
    return textureLoad(u_blocks, p / params.u_blockSize, 0);
}
