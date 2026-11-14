struct Params {
    u_hasMask: i32,
    u_fillColor: vec4<f32>,
    u_docSize: vec2<f32>,
    u_layerOffset: vec2<f32>,
    u_layerSize: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_layerTex: texture_2d<f32>;
@group(0) @binding(2) var u_layerTex_sampler: sampler;
@group(0) @binding(3) var u_maskTex: texture_2d<f32>;
@group(0) @binding(4) var u_maskTex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let existing = textureSample(u_layerTex, u_layerTex_sampler, uv);

    var maskVal = 1.0;
    if (params.u_hasMask == 1) {
        let docPos = params.u_layerOffset + uv * params.u_layerSize;
        let maskUV = docPos / params.u_docSize;
        let sampled = textureSample(u_maskTex, u_maskTex_sampler, maskUV).r;
        // Off-canvas texels are outside the selection; clamp-to-edge would
        // smear the edge row/column across them (#1033).
        let isOffCanvas = any(maskUV < vec2<f32>(0.0)) || any(maskUV > vec2<f32>(1.0));
        maskVal = select(sampled, 0.0, isOffCanvas);
    }

    // Blend fill color over existing using standard alpha compositing
    let fill = vec4<f32>(params.u_fillColor.rgb, params.u_fillColor.a * maskVal);
    let outA = fill.a + existing.a * (1.0 - fill.a);
    var outRGB = vec3<f32>(0.0);
    if (outA > 0.0) {
        outRGB = (fill.rgb * fill.a + existing.rgb * existing.a * (1.0 - fill.a)) / outA;
    }
    return vec4<f32>(outRGB, outA);
}
