struct Params {
    u_floatSize: vec2<f32>,
    // Document position of the float texture's origin. The Move tool's float
    // shares the layer's rect; a multi-layer transform's source does not.
    u_floatOffset: vec2<f32>,
    u_layerOffset: vec2<f32>,
    u_layerSize: vec2<f32>,
    // x, y, w, h
    u_origRect: vec4<f32>,
    // Doc space -> unit square. A projective (homography) map, not an inverse
    // bilinear one: bilinear keeps equal spacing along each edge, so a
    // Perspective drag never foreshortened (#927).
    u_quadToSquare: mat3x3<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_floatTex: texture_2d<f32>;

//#include premul_sample

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let docPos = uv * params.u_layerSize + params.u_layerOffset;

    let h = params.u_quadToSquare * vec3<f32>(docPos, 1.0);
    if (h.z <= 1e-9) {
        return vec4<f32>(0.0);
    }
    let unit = h.xy / h.z;
    if (unit.x < 0.0 || unit.x > 1.0 || unit.y < 0.0 || unit.y > 1.0) {
        return vec4<f32>(0.0);
    }

    let srcDoc = params.u_origRect.xy + unit * params.u_origRect.zw;
    let floatUV = (srcDoc - params.u_floatOffset) / params.u_floatSize;

    if (floatUV.x < 0.0 || floatUV.x > 1.0 || floatUV.y < 0.0 || floatUV.y > 1.0) {
        return vec4<f32>(0.0);
    }
    return samplePremulBilinear(u_floatTex, floatUV);
}
