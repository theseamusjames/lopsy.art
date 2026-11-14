struct Params {
    u_shadowColor: vec4<f32>,
    // shadow offset in pixels
    u_offset: vec2<f32>,
    // 0-100: choke/expand the shadow edge
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
    // 1 = apply knockout
    u_knockout: i32,
    // opacity the layer itself is composited with
    u_layerOpacity: f32,
    // 1 = output raw alpha only (pre-blur extraction)
    u_rawAlpha: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_srcTex: texture_2d<f32>;
@group(0) @binding(2) var u_srcTex_sampler: sampler;

fn srcAlphaAt(uv: vec2<f32>) -> f32 {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 0.0; }
    return textureSampleLevel(u_srcTex, u_srcTex_sampler, uv, 0.0).a;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let docPos = uv * params.u_docSize;
    let layerUV = (docPos - params.u_srcOffset - params.u_offset) / params.u_srcSize;

    var alpha = srcAlphaAt(layerUV);

    if (params.u_rawAlpha == 1) {
        return vec4<f32>(0.0, 0.0, 0.0, alpha);
    }

    if (params.u_spread > 0.5) {
        let t = params.u_spread * 0.01;
        let exponent = max(1.0 - t, 0.001);
        if (alpha > 0.001) {
            alpha = pow(alpha, exponent);
        } else {
            alpha = 0.0;
        }
    }

    if (params.u_knockout == 1) {
        let knockoutUV = (docPos - params.u_srcOffset) / params.u_srcSize;
        let knockoutAlpha = srcAlphaAt(knockoutUV);
        // The layer is composited over this shadow with coverage a*o, so a
        // plain (1 - a) knockout double-counts a's edge: a + (1 - a)^2 leaks
        // backdrop through anti-aliased pixels (#1089). Scaling by
        // (1 - a) / (1 - a*o) makes the result the layer replacing the shadow
        // by its coverage, a*o + (1 - a)*shadow: no seam at full opacity, and
        // still no shadow showing through an opaque but faded layer.
        let knockoutCoverage = knockoutAlpha * params.u_layerOpacity;
        alpha *= (1.0 - knockoutAlpha) / max(1.0 - knockoutCoverage, 1e-4);
    }

    return vec4<f32>(params.u_shadowColor.rgb, alpha * params.u_shadowColor.a * params.u_opacity);
}
