// Copy a layer texture with its layer mask multiplied into alpha, in the
// layer's own texture space. Effects (glow, shadow, stroke) sample this copy
// so they follow the visible, masked silhouette.
struct Params {
    // The layer texture covers [layerOffset .. layerOffset+layerSize] in document
    // space; the mask covers [maskOffset .. maskOffset+maskSize].
    u_layerOffset: vec2<f32>,
    u_layerSize: vec2<f32>,
    u_maskOffset: vec2<f32>,
    u_maskSize: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_srcTex: texture_2d<f32>;
@group(0) @binding(2) var u_srcTex_sampler: sampler;
@group(0) @binding(3) var u_maskTex: texture_2d<f32>;
@group(0) @binding(4) var u_maskTex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    var color = textureSample(u_srcTex, u_srcTex_sampler, uv);
    let docPos = params.u_layerOffset + uv * params.u_layerSize;
    let maskUV = (docPos - params.u_maskOffset) / params.u_maskSize;
    let mask = textureSample(u_maskTex, u_maskTex_sampler, maskUV).r;
    // Matches the blend shader: outside the mask's extent the layer is hidden.
    if (maskUV.x >= 0.0 && maskUV.x <= 1.0 && maskUV.y >= 0.0 && maskUV.y <= 1.0) {
        color.a *= mask;
    } else {
        color.a = 0.0;
    }
    return color;
}
