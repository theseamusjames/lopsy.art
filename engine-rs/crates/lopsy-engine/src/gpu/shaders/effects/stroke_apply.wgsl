struct Params {
    u_strokeColor: vec4<f32>,
    u_opacity: f32,
    // 0=outside (band around orig), 1=inside (band around inverted)
    u_position: i32,
    // original layer position in document pixels
    u_origOffset: vec2<f32>,
    // original layer texture size
    u_origSize: vec2<f32>,
    u_docSize: vec2<f32>,
    // 1 = output the layer's silhouette grown by the stroke (alpha only), which
    // the drop shadow and outer glow are cast from.
    u_silhouette: i32,
    // 1 = outside stroke drawn behind the layer
    u_knockout: i32,
    // opacity the layer itself is composited with
    u_layerOpacity: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
// alpha 1 within the stroke reach of the seeds (separable_edt)
@group(0) @binding(1) var u_bandTex: texture_2d<f32>;
@group(0) @binding(2) var u_bandTex_sampler: sampler;
// original layer texture
@group(0) @binding(3) var u_origTex: texture_2d<f32>;
@group(0) @binding(4) var u_origTex_sampler: sampler;

fn origAlphaAt(uv: vec2<f32>) -> f32 {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 0.0; }
    return textureSampleLevel(u_origTex, u_origTex_sampler, uv, 0.0).a;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let bandA = textureSample(u_bandTex, u_bandTex_sampler, uv).a;

    let docPos = uv * params.u_docSize;
    let origUV = (docPos - params.u_origOffset) / params.u_origSize;
    let origA = origAlphaAt(origUV);

    let isOpaque = origA >= 0.5;
    let isInBand = bandA >= 0.5;

    var isStroke: bool;
    if (params.u_position == 0) {
        // Outside: band around the opaque pixels, less the pixels themselves
        isStroke = isInBand && !isOpaque;
    } else {
        // Inside: band around the transparent pixels, within the opaque area
        isStroke = isInBand && isOpaque;
    }

    var coverage = 1.0;
    if (params.u_knockout == 1) {
        // Behind the layer: also under its partly covered edge pixels, and
        // knocked out by its coverage, as the hard drop shadow is.
        var isEdge = false;
        if (isOpaque && origA < 0.999) {
            let texel = 1.0 / params.u_origSize;
            for (var y: i32 = -1; y <= 1; y++) {
                for (var x: i32 = -1; x <= 1; x++) {
                    if (origAlphaAt(origUV + vec2<f32>(f32(x), f32(y)) * texel) < 0.5) { isEdge = true; }
                }
            }
        }
        isStroke = isStroke || isEdge;
        coverage = (1.0 - origA) / max(1.0 - origA * params.u_layerOpacity, 1e-4);
    }

    // Inside: the shape's faint edge pixels (alpha below 0.5) beside the
    // ring are seeds of the inverted band, so they are in it but not opaque.
    // Drawn over the layer, they would keep the fill colour as a fringe
    // outside the ring; they take the stroke, ramped by their coverage so
    // the ring's outer edge stays anti-aliased.
    var isFaintEdge = false;
    if (params.u_position == 1 && params.u_knockout == 0 && !isOpaque && origA > 0.0) {
        let texel = 1.0 / params.u_origSize;
        for (var y: i32 = -1; y <= 1; y++) {
            for (var x: i32 = -1; x <= 1; x++) {
                if (origAlphaAt(origUV + vec2<f32>(f32(x), f32(y)) * texel) >= 0.5) { isFaintEdge = true; }
            }
        }
    }

    let strokeA = params.u_strokeColor.a * params.u_opacity;
    if (params.u_silhouette == 1) {
        // Stroke and layer combine source-over whichever is in front, so the
        // silhouette is their alpha union; the knockout coverage only shapes
        // the drawn stroke.
        var a = origA;
        if (isStroke) { a = strokeA + origA * (1.0 - strokeA); }
        return vec4<f32>(0.0, 0.0, 0.0, a);
    }
    if (isStroke) {
        return vec4<f32>(params.u_strokeColor.rgb, strokeA * coverage);
    }
    if (isFaintEdge) {
        return vec4<f32>(params.u_strokeColor.rgb, strokeA * min(origA * 2.0, 1.0));
    }
    return vec4<f32>(0.0);
}
