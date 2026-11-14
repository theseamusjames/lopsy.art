struct Params {
    // 1 = use u_origTex for masking instead of u_srcTex
    u_hasOrigTex: i32,
    u_glowColor: vec4<f32>,
    u_size: f32,
    u_spread: f32,
    u_opacity: f32,
    // 1/layerWidth, 1/layerHeight
    u_texelSize: vec2<f32>,
    // layer position in document pixels
    u_srcOffset: vec2<f32>,
    // layer texture size in pixels
    u_srcSize: vec2<f32>,
    // document size in pixels
    u_docSize: vec2<f32>,
    // 0 = outer glow, 1 = inner glow
    u_mode: i32,
    // 1 = output raw alpha only (pre-blur extraction)
    u_rawAlpha: i32,
    // original layer position/size for post-blur masking lookups
    u_origOffset: vec2<f32>,
    u_origSize: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_srcTex: texture_2d<f32>;
@group(0) @binding(2) var u_srcTex_sampler: sampler;
// original layer texture (for post-blur masking)
@group(0) @binding(3) var u_origTex: texture_2d<f32>;
@group(0) @binding(4) var u_origTex_sampler: sampler;

fn isInside(uv: vec2<f32>) -> bool {
    return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
}

fn srcAlphaAt(uv: vec2<f32>) -> f32 {
    if (!isInside(uv)) { return 0.0; }
    return textureSampleLevel(u_srcTex, u_srcTex_sampler, uv, 0.0).a;
}

fn origAlphaAt(uv: vec2<f32>) -> f32 {
    if (!isInside(uv)) { return 0.0; }
    return textureSampleLevel(u_origTex, u_origTex_sampler, uv, 0.0).a;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let docPos = uv * params.u_docSize;
    let layerUV = (docPos - params.u_srcOffset) / params.u_srcSize;

    if (params.u_rawAlpha == 1) {
        // Pre-blur: extract raw alpha for outer glow, or inverted alpha for inner glow
        let rawA = srcAlphaAt(layerUV);
        var extracted = rawA;
        if (params.u_mode == 1) { extracted = 1.0 - rawA; }
        return vec4<f32>(0.0, 0.0, 0.0, extracted);
    }

    // Post-blur or no-blur path: apply spread, masking, color
    var blurredAlpha = srcAlphaAt(layerUV);

    // Apply spread as a gamma curve (same approach as shadow spread)
    if (params.u_spread > 0.5) {
        let t = params.u_spread * 0.01;
        let exponent = max(1.0 - t, 0.001);
        if (blurredAlpha > 0.001) {
            blurredAlpha = pow(blurredAlpha, exponent);
        } else {
            blurredAlpha = 0.0;
        }
    }

    // Get original layer alpha for masking
    var srcA: f32;
    if (params.u_hasOrigTex == 1) {
        srcA = origAlphaAt((docPos - params.u_origOffset) / params.u_origSize);
    } else {
        srcA = srcAlphaAt(layerUV);
    }

    var alpha: f32;
    if (params.u_mode == 0) {
        alpha = blurredAlpha * (1.0 - srcA);
    } else {
        alpha = srcA * blurredAlpha;
    }
    return vec4<f32>(params.u_glowColor.rgb, alpha * params.u_glowColor.a * params.u_opacity);
}
