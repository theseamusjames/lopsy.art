struct Params {
    u_hasMask: i32,
    // 1 for the Move tool's float: a selection reaching a canvas edge carries on
    // past it, so content hanging off that edge moves with the rest (#1131).
    // 0 elsewhere: off-canvas texels are outside the selection (#1033).
    u_extendPastCanvas: i32,
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
    var color = textureSample(u_layerTex, u_layerTex_sampler, uv);

    // No selection: clear everything
    if (params.u_hasMask != 1) {
        return vec4<f32>(0.0);
    }

    // Convert layer UV to document-space, then to mask UV
    let docPos = params.u_layerOffset + uv * params.u_layerSize;
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
    // Subtract the mask as coverage: anti-aliased and feathered selections
    // on opaque pixels leave a soft 1 - mask edge, while a selection loaded
    // from the layer's own alpha (mask == alpha) clears the pixel instead of
    // leaving an alpha * (1 - alpha) ghost. The one-step slack absorbs the
    // 8-bit mask quantizing a 16-bit float alpha.
    let remaining = color.a - maskVal;
    if (maskVal <= 0.0) {
        // Outside the selection: untouched.
    } else if (remaining <= 1.0 / 255.0) {
        color = vec4<f32>(0.0);
    } else {
        color.a = remaining;
    }
    return color;
}
