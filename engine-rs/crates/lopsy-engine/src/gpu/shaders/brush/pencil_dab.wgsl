struct Params {
    u_color: vec4<f32>,
    u_center: vec2<f32>,
    u_size: f32,
    u_texSize: vec2<f32>,
    u_hasSelection: i32,
    u_docSize: vec2<f32>,
    u_layerOffset: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_selectionMask: texture_2d<f32>;
@group(0) @binding(2) var u_selectionMask_sampler: sampler;

// Pencil renders hard, aliased square pixel blocks — no edge feathering.
// The block geometry mirrors the former CPU path: an integer cell centered
// on floor(center), spanning `floor(size/2)` on each side for `ceil(size)`
// pixels total, so the on-screen result is pixel-identical to before but
// computed on the GPU.
@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let fragPos = uv * params.u_texSize;
    let p = floor(fragPos);
    let c = floor(params.u_center);
    let halfSize = floor(params.u_size * 0.5);
    let block = ceil(params.u_size);
    let lo = c - halfSize;
    let hi = lo + block;
    if (p.x < lo.x || p.x >= hi.x || p.y < lo.y || p.y >= hi.y) { discard; }

    var a = params.u_color.a;
    if (params.u_hasSelection == 1) {
        let docPos = fragPos + params.u_layerOffset;
        let selUV = docPos / params.u_docSize;
        if (selUV.x < 0.0 || selUV.x > 1.0 || selUV.y < 0.0 || selUV.y > 1.0) { discard; }
        let selMask = textureSampleLevel(u_selectionMask, u_selectionMask_sampler, selUV, 0.0).r;
        if (selMask < 0.004) { discard; }
        a *= selMask;
    }

    return vec4<f32>(params.u_color.rgb * a, a);
}
