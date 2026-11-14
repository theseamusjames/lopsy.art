// Pixelate pass 1: one fragment per block. Rendered into a
// ceil(w / block) x ceil(h / block) viewport, so the pass reads each layer
// texel exactly once however large the block is.
//
// Output: rgb = alpha-weighted mean colour of the block (transparent texels
// don't darken it), a = mean alpha of the block's non-transparent texels.
// Blocks clipped by the texture edge average only the texels inside it.
struct Params {
    u_blockSize: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let texSize = vec2<i32>(textureDimensions(u_tex, 0));
    let origin = vec2<i32>(position.xy) * params.u_blockSize;
    let end = min(origin + vec2<i32>(params.u_blockSize), texSize);

    var colorSum = vec3<f32>(0.0);
    var alphaSum = 0.0;
    var covered = 0.0;
    for (var y: i32 = origin.y; y < end.y; y++) {
        for (var x: i32 = origin.x; x < end.x; x++) {
            let c = textureLoad(u_tex, vec2<i32>(x, y), 0);
            colorSum += c.rgb * c.a;
            alphaSum += c.a;
            if (c.a > 0.0) { covered += 1.0; }
        }
    }

    if (alphaSum <= 0.0) {
        return vec4<f32>(0.0);
    }
    return vec4<f32>(colorSum / alphaSum, alphaSum / covered);
}
