struct Params {
    u_hasMask: i32,
    // 1 for the Move tool's float: a selection reaching a canvas edge carries on
    // past it, so content hanging off that edge moves with the rest (#1131).
    // 0 elsewhere: off-canvas texels are outside the selection (#1033).
    u_extendPastCanvas: i32,
    // Layer texture covers [layerOffset .. layerOffset+layerSize] in document space.
    // The output covers [boundsOffset .. boundsOffset+boundsSize] in document space.
    u_layerOffset: vec2<f32>,
    u_layerSize: vec2<f32>,
    u_boundsOffset: vec2<f32>,
    u_boundsSize: vec2<f32>,
    u_docSize: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_layerTex: texture_2d<f32>;
@group(0) @binding(2) var u_layerTex_sampler: sampler;
@group(0) @binding(3) var u_maskTex: texture_2d<f32>;
@group(0) @binding(4) var u_maskTex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    // Document-space coordinate for this output pixel
    let docPos = params.u_boundsOffset + uv * params.u_boundsSize;

    let layerUV = (docPos - params.u_layerOffset) / params.u_layerSize;
    let sampled = textureSample(u_layerTex, u_layerTex_sampler, layerUV);
    var color = vec4<f32>(0.0);
    if (layerUV.x >= 0.0 && layerUV.x <= 1.0 && layerUV.y >= 0.0 && layerUV.y <= 1.0) {
        color = sampled;
    }

    // Apply selection mask if present
    if (params.u_hasMask == 1) {
        let maskUV = docPos / params.u_docSize;
        let halfTexel = 0.5 / params.u_docSize;
        let isOffCanvas = any(maskUV < vec2<f32>(0.0)) || any(maskUV > vec2<f32>(1.0));
        var maskVal: f32;
        if (params.u_extendPastCanvas == 1) {
            maskVal = textureSample(u_maskTex, u_maskTex_sampler, clamp(maskUV, halfTexel, 1.0 - halfTexel)).r;
        } else {
            let inCanvas = textureSample(u_maskTex, u_maskTex_sampler, maskUV).r;
            maskVal = select(inCanvas, 0.0, isOffCanvas);
        }
        // Take the mask as coverage, min(alpha, mask), mirroring
        // clipboard_clear's alpha - mask so copy + clear conserve the pixel.
        // A product would square alpha for a selection built from the
        // layer's own alpha (#1009). The mask is 8-bit while the layer may be
        // RGBA16F, so a mask within one 8-bit step of alpha covers it whole.
        if (maskVal <= 0.0) {
            color.a = 0.0;
        } else if (maskVal < color.a - 1.0 / 255.0) {
            color.a = maskVal;
        }
    }

    return color;
}
