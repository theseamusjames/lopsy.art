struct Params {
    u_layerSize: vec2<f32>,
    u_patternSize: vec2<f32>,
    u_scale: f32,
    // Brick / half-drop stagger as a fraction of one tile: x shifts each row by
    // row * u_stagger.x, y shifts each column by col * u_stagger.y.
    u_stagger: vec2<f32>,
    // Tiling-origin shift as a fraction of one tile; moves the whole grid.
    u_origin: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;
@group(0) @binding(3) var u_pattern: texture_2d<f32>;
@group(0) @binding(4) var u_pattern_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    var tileCoord = uv * params.u_layerSize / (params.u_patternSize * params.u_scale) - params.u_origin;
    let col = floor(tileCoord.x);
    let row = floor(tileCoord.y);
    tileCoord.x += row * params.u_stagger.x;
    tileCoord.y += col * params.u_stagger.y;
    let src = textureSample(u_pattern, u_pattern_sampler, fract(tileCoord));
    let dst = textureSample(u_tex, u_tex_sampler, uv);
    // #942: composite the tile "over" the existing pixels (straight alpha)
    // instead of replacing them, so transparent tile areas keep the layer.
    let outA = src.a + dst.a * (1.0 - src.a);
    if (outA < 1e-6) {
        return vec4<f32>(0.0);
    }
    let rgb = (src.rgb * src.a + dst.rgb * dst.a * (1.0 - src.a)) / outA;
    return vec4<f32>(rgb, outA);
}
