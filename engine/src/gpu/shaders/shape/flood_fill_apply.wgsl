struct Params {
    u_fillColor: vec4<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_layerTex: texture_2d<f32>;
@group(0) @binding(2) var u_layerTex_sampler: sampler;
@group(0) @binding(3) var u_maskTex: texture_2d<f32>;
@group(0) @binding(4) var u_maskTex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let existing = textureSample(u_layerTex, u_layerTex_sampler, uv);
    let mask = textureSample(u_maskTex, u_maskTex_sampler, uv).r;
    let fill = vec4<f32>(params.u_fillColor.rgb, params.u_fillColor.a * mask);
    let outA = fill.a + existing.a * (1.0 - fill.a);
    let outRGB = (fill.rgb * fill.a + existing.rgb * existing.a * (1.0 - fill.a)) / max(outA, 0.001);
    return vec4<f32>(outRGB, outA);
}
