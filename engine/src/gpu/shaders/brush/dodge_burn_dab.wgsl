struct Params {
    u_center: vec2<f32>,
    u_size: f32,
    u_hardness: f32,
    u_texSize: vec2<f32>,
    u_exposure: f32,
    u_hasSelection: i32,
    u_docSize: vec2<f32>,
    u_layerOffset: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_selectionMask: texture_2d<f32>;
@group(0) @binding(2) var u_selectionMask_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let fragPos = uv * params.u_texSize;
    let radius = params.u_size * 0.5;
    let dist = length(fragPos - params.u_center);
    if (dist > radius) { discard; }

    let t = clamp(dist / radius, 0.0, 1.0);
    let soft = 1.0 - t * t;
    var stamp = params.u_hardness + (1.0 - params.u_hardness) * soft;
    let edge = 1.0 - smoothstep(radius - 1.0, radius, dist);
    stamp *= edge;

    if (params.u_hasSelection == 1) {
        let docPos = fragPos + params.u_layerOffset;
        let selUV = docPos / params.u_docSize;
        if (selUV.x < 0.0 || selUV.x > 1.0 || selUV.y < 0.0 || selUV.y > 1.0) { discard; }
        let selMask = textureSampleLevel(u_selectionMask, u_selectionMask_sampler, selUV, 0.0).r;
        if (selMask < 0.004) { discard; }
        stamp *= selMask;
    }

    let strength = clamp(stamp * params.u_exposure, 0.0, 1.0);
    // Write same value to all channels so MAX blend keeps the highest
    // dab strength at each pixel — overlapping dabs within one stroke
    // don't compound.
    return vec4<f32>(strength, strength, strength, strength);
}
