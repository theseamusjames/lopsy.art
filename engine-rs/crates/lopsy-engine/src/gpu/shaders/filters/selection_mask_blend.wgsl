struct Params {
    u_docSize: vec2<f32>,
    u_layerOffset: vec2<f32>,
    u_layerSize: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_filtered: texture_2d<f32>;
@group(0) @binding(2) var u_filtered_sampler: sampler;
@group(0) @binding(3) var u_original: texture_2d<f32>;
@group(0) @binding(4) var u_original_sampler: sampler;
@group(0) @binding(5) var u_selMask: texture_2d<f32>;
@group(0) @binding(6) var u_selMask_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let filtered = textureSample(u_filtered, u_filtered_sampler, uv);
    let original = textureSample(u_original, u_original_sampler, uv);
    // The selection mask is document-sized; the layer texture may be offset
    // from the document or extend past it (#1033).
    let maskUV = (params.u_layerOffset + uv * params.u_layerSize) / params.u_docSize;
    let isOffCanvas = any(maskUV < vec2<f32>(0.0)) || any(maskUV > vec2<f32>(1.0));
    // Sampled before it is chosen: WebGPU allows an implicit-derivative
    // sample only where control flow does not depend on a varying.
    let selected = textureSample(u_selMask, u_selMask_sampler, maskUV).r;
    let mask = select(selected, 0.0, isOffCanvas);
    return mix(original, filtered, mask);
}
