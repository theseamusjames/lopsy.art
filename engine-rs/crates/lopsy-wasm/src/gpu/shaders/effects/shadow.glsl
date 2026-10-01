#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_srcTex;
uniform vec4 u_shadowColor;
uniform vec2 u_offset;     // shadow offset in pixels
uniform float u_spread;    // 0-100: choke/expand the shadow edge
uniform float u_opacity;
uniform vec2 u_texelSize;  // 1/layerWidth, 1/layerHeight
uniform vec2 u_srcOffset;  // layer position in document pixels
uniform vec2 u_srcSize;    // layer texture size in pixels
uniform vec2 u_docSize;    // document size in pixels
uniform int u_knockout;    // 1 = apply knockout
uniform float u_layerOpacity; // opacity the layer itself is composited with
uniform int u_rawAlpha;    // 1 = output raw alpha only (pre-blur extraction)
out vec4 fragColor;
void main() {
    vec2 docPos = v_uv * u_docSize;
    vec2 layerUV = (docPos - u_srcOffset - u_offset) / u_srcSize;

    float alpha = 0.0;
    if (layerUV.x >= 0.0 && layerUV.x <= 1.0 && layerUV.y >= 0.0 && layerUV.y <= 1.0) {
        alpha = texture(u_srcTex, layerUV).a;
    }

    if (u_rawAlpha == 1) {
        fragColor = vec4(0.0, 0.0, 0.0, alpha);
        return;
    }

    if (u_spread > 0.5) {
        float t = u_spread * 0.01;
        float exponent = max(1.0 - t, 0.001);
        alpha = alpha > 0.001 ? pow(alpha, exponent) : 0.0;
    }

    if (u_knockout == 1) {
        vec2 knockoutUV = (docPos - u_srcOffset) / u_srcSize;
        float knockoutAlpha = 0.0;
        if (knockoutUV.x >= 0.0 && knockoutUV.x <= 1.0 && knockoutUV.y >= 0.0 && knockoutUV.y <= 1.0) {
            knockoutAlpha = texture(u_srcTex, knockoutUV).a;
        }
        // The layer is composited over this shadow with coverage a·o, so a
        // plain (1 − a) knockout double-counts a's edge: a + (1 − a)² leaks
        // backdrop through anti-aliased pixels (#1089). Scaling by
        // (1 − a) / (1 − a·o) makes the result the layer replacing the shadow
        // by its coverage, a·o + (1 − a)·shadow: no seam at full opacity, and
        // still no shadow showing through an opaque but faded layer.
        float knockoutCoverage = knockoutAlpha * u_layerOpacity;
        alpha *= (1.0 - knockoutAlpha) / max(1.0 - knockoutCoverage, 1e-4);
    }

    fragColor = vec4(u_shadowColor.rgb, alpha * u_shadowColor.a * u_opacity);
}
