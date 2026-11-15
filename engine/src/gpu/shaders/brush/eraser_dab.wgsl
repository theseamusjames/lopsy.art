struct Params {
    u_opacity: f32,
    u_center: vec2<f32>,
    u_size: f32,
    u_texSize: vec2<f32>,
    u_hasSelection: i32,
    u_docSize: vec2<f32>,
    u_layerOffset: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_stampTex: texture_2d<f32>;
@group(0) @binding(2) var u_stampTex_sampler: sampler;
@group(0) @binding(3) var u_layerTex: texture_2d<f32>;
@group(0) @binding(4) var u_layerTex_sampler: sampler;
@group(0) @binding(5) var u_selectionMask: texture_2d<f32>;
@group(0) @binding(6) var u_selectionMask_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let fragPos = uv * params.u_texSize;
    let existing = textureSample(u_layerTex, u_layerTex_sampler, uv);

    let dabMin = params.u_center - params.u_size * 0.5;
    let dabMax = params.u_center + params.u_size * 0.5;

    if (fragPos.x < dabMin.x || fragPos.x > dabMax.x ||
        fragPos.y < dabMin.y || fragPos.y > dabMax.y) {
        return existing;
    }

    // Outside the selection nothing is erased; inside, the mask's value
    // scales the erase so a soft selection edge stays soft.
    var selMask = 1.0;
    if (params.u_hasSelection == 1) {
        let docPos = fragPos + params.u_layerOffset;
        let selUV = docPos / params.u_docSize;
        if (selUV.x < 0.0 || selUV.x > 1.0 || selUV.y < 0.0 || selUV.y > 1.0) {
            return existing;
        }
        selMask = textureSampleLevel(u_selectionMask, u_selectionMask_sampler, selUV, 0.0).r;
        if (selMask < 0.004) {
            return existing;
        }
    }

    let stampUV = (fragPos - dabMin) / params.u_size;
    let stamp = textureSampleLevel(u_stampTex, u_stampTex_sampler, stampUV, 0.0).r;
    var eraseAmount = stamp * params.u_opacity;
    if (params.u_hasSelection == 1) {
        eraseAmount *= selMask;
    }

    return vec4<f32>(existing.rgb, existing.a * (1.0 - eraseAmount));
}
