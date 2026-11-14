// #667 — Non-contiguous ("fill by color") bucket fill implemented entirely on
// the GPU. Compares each texel against a reference color and mixes the fill
// color over the layer wherever `|texel - reference| <= tolerance`. Optionally
// masked by a selection texture.
struct Params {
    // 1 if u_selMaskTex is valid, else 0
    u_hasSelMask: i32,
    // uv coord of the sample point (already resolved on JS side to layer-local UV).
    u_sampleUv: vec2<f32>,
    // final color (straight alpha)
    u_fillColor: vec4<f32>,
    // 0..1 (normalized 0..255 / 255)
    u_tolerance: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_layerTex: texture_2d<f32>;
@group(0) @binding(2) var u_layerTex_sampler: sampler;
// 0 = outside selection, 1 = inside
@group(0) @binding(3) var u_selMaskTex: texture_2d<f32>;
@group(0) @binding(4) var u_selMaskTex_sampler: sampler;

// Match distance mirrors lopsy_core::flood_fill: max channel delta over rgba.
fn channelDelta(a: vec4<f32>, b: vec4<f32>) -> f32 {
    let d = abs(a - b);
    return max(max(d.r, d.g), max(d.b, d.a));
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let existing = textureSample(u_layerTex, u_layerTex_sampler, uv);
    let sampled = textureSample(u_layerTex, u_layerTex_sampler, params.u_sampleUv);

    let delta = channelDelta(existing, sampled);
    var coverage = 0.0;
    if (delta <= params.u_tolerance) { coverage = 1.0; }

    // Constrain to the selection mask when one is provided.
    if (params.u_hasSelMask == 1) {
        coverage *= textureSample(u_selMaskTex, u_selMaskTex_sampler, uv).r;
    }

    // "Over" compositing with the fill color scaled by the hit mask.
    let fill = vec4<f32>(params.u_fillColor.rgb, params.u_fillColor.a * coverage);
    let outA = fill.a + existing.a * (1.0 - fill.a);
    let outRGB = (fill.rgb * fill.a + existing.rgb * existing.a * (1.0 - fill.a)) / max(outA, 0.001);
    return vec4<f32>(outRGB, outA);
}
