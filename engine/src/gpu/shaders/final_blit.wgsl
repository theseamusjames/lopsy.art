struct Params {
    u_resolution: vec2<f32>,
    u_zoom: f32,
    u_pan: vec2<f32>,
    u_docSize: vec2<f32>,
    u_bgAlpha: f32,
    u_seamlessEnabled: f32,
    u_seamlessDim: f32,
    u_channelMask: vec4<f32>,
    // Document color mode: 0 = sRGB-backed (RGB, grayscale, indexed, CMYK), 1 = Lab.
    u_docColorMode: i32,
    // 1 for an 8-bit screen, where the dither hides banding; 0 for a float
    // one (HDR), which has the precision and would only show the noise.
    u_dither: f32,
    // A document that is a tile of a larger picture, drawn at its own size
    // (an export's draw): (x, y, 1, 0), the whole picture's pixel, counted
    // from the bottom, at this canvas's pixel (0, 0). All zeros otherwise.
    u_ditherRegion: vec4<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_compositeTex: texture_2d<f32>;
@group(0) @binding(2) var u_compositeTex_sampler: sampler;

// Lab documents store encoded CIELAB in the composite, so the screen needs
// the inverse transform.
//#include lab

// Zoomed out, a single bilinear tap only sees a 2x2 patch of the many texels
// under each screen pixel, so fine detail (thin text strokes, hairlines)
// aliases and shimmers while panning. Average a grid of bilinear taps spread
// at most one texel apart over the pixel's footprint instead. The tap count
// grows as 1/zoom^2 but the document's on-screen area shrinks as zoom^2, so
// the total cost stays roughly one fetch per document pixel.
const MAX_MINIFY_TAPS: i32 = 8;

fn sampleMinified(texelPos: vec2<f32>, isSeamless: bool) -> vec4<f32> {
    let footprint = 1.0 / params.u_zoom;
    let taps = i32(min(ceil(footprint), f32(MAX_MINIFY_TAPS)));
    let spacing = footprint / f32(taps);
    let origin = texelPos - footprint * 0.5;
    // Composite colour is straight alpha: weight by alpha so transparent
    // texels don't darken the edges they're averaged with.
    var sum = vec4<f32>(0.0);
    for (var y: i32 = 0; y < MAX_MINIFY_TAPS; y++) {
        if (y >= taps) { break; }
        for (var x: i32 = 0; x < MAX_MINIFY_TAPS; x++) {
            if (x >= taps) { break; }
            var tapUV = (origin + (vec2<f32>(f32(x), f32(y)) + 0.5) * spacing) / params.u_docSize;
            if (isSeamless) { tapUV = fract(tapUV); }
            let c = textureSampleLevel(u_compositeTex, u_compositeTex_sampler, tapUV, 0.0);
            sum += vec4<f32>(c.rgb * c.a, c.a);
        }
    }
    sum /= f32(taps * taps);
    if (sum.a > 0.0) {
        return vec4<f32>(sum.rgb / sum.a, sum.a);
    }
    return vec4<f32>(0.0);
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    // The centre of this screen pixel, exactly, counted up from the bottom as
    // WebGL's fragment position is. `uv` is interpolated, and its rounding
    // error differs from one GPU to the next and between WebGL and WebGPU:
    // where a pixel centre lands on a texel boundary (the document's edge, at
    // many zooms) that error would decide which texel the pixel shows.
    let pixel = floor(uv * params.u_resolution) + 0.5;
    let screenPos = vec2<f32>(pixel.x, params.u_resolution.y - pixel.y);

    let center = params.u_resolution * 0.5;
    var canvasPos = (screenPos - center - params.u_pan) / params.u_zoom + params.u_docSize * 0.5;

    // At integer zoom levels, snap to texel centers so linear filtering doesn't
    // interpolate between adjacent composited pixels. Without this, fractional
    // pan offsets cause visible artifacts on anti-aliased edges (text curves).
    let nearestIntZoom = floor(params.u_zoom + 0.5);
    if (abs(params.u_zoom - nearestIntZoom) < 0.01) {
        canvasPos = floor(canvasPos) + 0.5;
    }

    let docUV = canvasPos / params.u_docSize;

    let isSeamless = params.u_seamlessEnabled > 0.5;

    if (!isSeamless && (docUV.x < 0.0 || docUV.x > 1.0 || docUV.y < 0.0 || docUV.y > 1.0)) {
        return vec4<f32>(0.18, 0.18, 0.18, 1.0);
    }

    let isCenterTile = docUV.x >= 0.0 && docUV.x <= 1.0 && docUV.y >= 0.0 && docUV.y <= 1.0;
    var sampleUV = docUV;
    if (isSeamless) { sampleUV = fract(docUV); }

    // Zoomed in, plain linear filtering smears each document pixel into a
    // gradient, which turns anti-aliased edges into a blurry staircase. Hold
    // each texel flat and only blend across the one screen pixel where two
    // texels meet, so pixels read as crisp squares at any zoom — including
    // fractional ones like 130% where nearest-neighbour would make them
    // uneven sizes.
    if (params.u_zoom > 1.0) {
        let texelPos = sampleUV * params.u_docSize - 0.5;
        let texelBase = floor(texelPos);
        let edgeBlend = clamp(
            (texelPos - texelBase - 0.5) * params.u_zoom + 0.5,
            vec2<f32>(0.0),
            vec2<f32>(1.0),
        );
        sampleUV = (texelBase + edgeBlend + 0.5) / params.u_docSize;
    }

    var color: vec4<f32>;
    if (params.u_zoom < 1.0) {
        color = sampleMinified(docUV * params.u_docSize, isSeamless);
    } else {
        color = textureSampleLevel(u_compositeTex, u_compositeTex_sampler, sampleUV, 0.0);
    }

    // Native color modes store encoded values in the composite; decode to sRGB
    // before the RGB-assuming steps below (channel mask, checkerboard, dither).
    if (params.u_docColorMode == 1) {
        color = vec4<f32>(labToSrgb(color.rgb), color.a);
    }

    color = vec4<f32>(color.rgb * params.u_channelMask.rgb, color.a * params.u_channelMask.a);

    let isTransparentDoc = params.u_bgAlpha < 0.999;
    var tileCanvasPos = canvasPos;
    if (isSeamless) { tileCanvasPos = sampleUV * params.u_docSize; }
    if (isTransparentDoc && color.a < 1.0 - 1.0 / 256.0) {
        let checker = floor(tileCanvasPos / 8.0);
        let cellSum = checker.x + checker.y;
        let check = cellSum - 2.0 * floor(cellSum / 2.0);
        let bg = mix(vec3<f32>(0.8), vec3<f32>(0.9), check);
        color = vec4<f32>(color.rgb * color.a + bg * (1.0 - color.a), 1.0);
    }

    if (isSeamless && !isCenterTile && params.u_seamlessDim > 0.5) {
        color = mix(vec4<f32>(0.18, 0.18, 0.18, 1.0), color, 0.75);
    }

    // Seeded by the pixel, so the dither is the same pattern on both
    // backends: WebGPU's own fragment position counts rows down. A tile is
    // seeded by its pixel's place in the whole picture, a sum of whole
    // numbers and a half that is exact, so tiles dither as the whole does.
    var seed = pixel;
    if (params.u_ditherRegion.z > 0.5) {
        seed = pixel + params.u_ditherRegion.xy;
    }
    let n0 = fract(sin(dot(seed, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    let n1 = fract(sin(dot(seed, vec2<f32>(63.7264, 10.873))) * 28637.1136);
    let dither = (n0 + n1 - 1.0) / 255.0 * params.u_dither;

    return vec4<f32>(color.rgb + dither, color.a);
}
