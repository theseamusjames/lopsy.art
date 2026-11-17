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
    var inLo = vec2<f32>(-1e30);
    var inHi = vec2<f32>(1e30);
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
        inLo = s0 + 0.5;
        inHi = max(inLo, s1 - 0.5);
    }

    // Minification (#1748): one output pixel covers the parallelogram
    // spanned by the inverse map's columns in the source. A single bilinear
    // tap reads only 2x2 texels of it, so below 50% whole rows and columns
    // were skipped and thin slanted lines broke into dashes. Average a grid
    // of taps across the footprint instead (a box filter), about one tap
    // per source texel along each axis, capped at 16. Above ~67% one
    // bilinear tap already reads every texel, and is kept.
    let stepX = vec2<f32>(params.u_invMatrix[0][0], params.u_invMatrix[0][1]);
    let stepY = vec2<f32>(params.u_invMatrix[1][0], params.u_invMatrix[1][1]);
    let tapsX = i32(clamp(floor(length(stepX) + 0.5), 1.0, 16.0));
    let tapsY = i32(clamp(floor(length(stepY) + 0.5), 1.0, 16.0));

    if (tapsX == 1 && tapsY == 1) {
        let floatUV = (clamp(srcDoc, inLo, inHi) - params.u_floatOffset) / params.u_floatSize;
        if (floatUV.x < 0.0 || floatUV.x > 1.0 || floatUV.y < 0.0 || floatUV.y > 1.0) {
            return vec4<f32>(0.0);
        }
        let c = samplePremulBilinear(u_floatTex, floatUV);
        return vec4<f32>(c.rgb, c.a * coverage);
    }

    // Skip pixels whose whole footprint misses the source pixels, so the
    // tap grid only runs where there is content.
    if (params.u_srcRect.z > 0.0 && params.u_srcRect.w > 0.0) {
        let reach = 0.5 * (abs(stepX) + abs(stepY)) + 1.0;
        let r0 = params.u_srcRect.xy;
        let r1 = params.u_srcRect.xy + params.u_srcRect.zw;
        if (any(srcDoc + reach < r0) || any(srcDoc - reach > r1)) {
            return vec4<f32>(0.0);
        }
    }

    var sum = vec4<f32>(0.0);
    for (var iy: i32 = 0; iy < tapsY; iy++) {
        let fy = (f32(iy) + 0.5) / f32(tapsY) - 0.5;
        for (var ix: i32 = 0; ix < tapsX; ix++) {
            let fx = (f32(ix) + 0.5) / f32(tapsX) - 0.5;
            let tap = clamp(srcDoc + fx * stepX + fy * stepY, inLo, inHi);
            let tapUV = (tap - params.u_floatOffset) / params.u_floatSize;
            if (tapUV.x < 0.0 || tapUV.x > 1.0 || tapUV.y < 0.0 || tapUV.y > 1.0) {
                continue;
            }
            sum += bilinearPremul(u_floatTex, tapUV);
        }
    }
    let m = sum / f32(tapsX * tapsY);
    if (m.a < 1e-6) {
        return vec4<f32>(0.0);
    }
    return vec4<f32>(m.rgb / m.a, m.a * coverage);
}
