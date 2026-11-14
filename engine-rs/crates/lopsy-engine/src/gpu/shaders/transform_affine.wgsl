struct Params {
    u_floatSize: vec2<f32>,
    // Document position of the float texture's origin. The Move tool's float
    // shares the layer's rect; a multi-layer transform's source does not.
    u_floatOffset: vec2<f32>,
    u_layerOffset: vec2<f32>,
    u_layerSize: vec2<f32>,
    u_invMatrix: mat3x3<f32>,
    // original bounds center (where source pixels are)
    u_srcCenter: vec2<f32>,
    // srcCenter + translate (where output should appear)
    u_dstCenter: vec2<f32>,
    // Document rect (x, y, w, h) of the source pixels; w <= 0 when unknown.
    u_srcRect: vec4<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_floatTex: texture_2d<f32>;

//#include premul_sample

// Fraction of the pixel span [p - 0.5, p + 0.5] inside [e0, e1].
fn spanCoverage(p: f32, e0: f32, e1: f32) -> f32 {
    return clamp(min(p + 0.5, e1) - max(p - 0.5, e0), 0.0, 1.0);
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let layerPos = uv * params.u_layerSize;
    let docPos = layerPos + params.u_layerOffset;

    // Inverse: input = srcCenter + M^-1 * (output - dstCenter)
    let rel = docPos - params.u_dstCenter;
    let srcRel = params.u_invMatrix * vec3<f32>(rel, 1.0);
    var srcDoc = srcRel.xy + params.u_srcCenter;

    let a = params.u_invMatrix[0][0];
    let d = params.u_invMatrix[1][1];
    let isAxisAligned = params.u_srcRect.z > 0.0 && params.u_srcRect.w > 0.0
        && abs(params.u_invMatrix[1][0]) < 1e-6 && abs(params.u_invMatrix[0][1]) < 1e-6
        && abs(a) > 1e-6 && abs(d) > 1e-6;

    // An axis-aligned scale maps the source rect onto a destination rect.
    // Bilinear taps across its edge would blend in the transparent texels
    // outside the source, so an edge on a whole pixel (a pinned side) came
    // out at 75% alpha and the far edge bled half a pixel (#1466). Instead,
    // keep the taps inside the source and weight by exact edge coverage.
    var coverage = 1.0;
    if (isAxisAligned) {
        let s0 = params.u_srcRect.xy;
        let s1 = params.u_srcRect.xy + params.u_srcRect.zw;
        let t = params.u_invMatrix[2].xy;
        let scale = vec2<f32>(a, d);
        let e0 = params.u_dstCenter + (s0 - params.u_srcCenter - t) / scale;
        let e1 = params.u_dstCenter + (s1 - params.u_srcCenter - t) / scale;
        let lo = min(e0, e1);
        let hi = max(e0, e1);
        coverage = spanCoverage(docPos.x, lo.x, hi.x) * spanCoverage(docPos.y, lo.y, hi.y);
        if (coverage <= 0.0) {
            return vec4<f32>(0.0);
        }
        let inLo = s0 + 0.5;
        let inHi = max(inLo, s1 - 0.5);
        srcDoc = clamp(srcDoc, inLo, inHi);
    }

    let floatUV = (srcDoc - params.u_floatOffset) / params.u_floatSize;

    if (floatUV.x < 0.0 || floatUV.x > 1.0 || floatUV.y < 0.0 || floatUV.y > 1.0) {
        return vec4<f32>(0.0);
    }
    let c = samplePremulBilinear(u_floatTex, floatUV);
    return vec4<f32>(c.rgb, c.a * coverage);
}
