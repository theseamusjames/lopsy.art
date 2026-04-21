#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_srcTex;
uniform sampler2D u_origTex;   // original layer texture (for post-blur masking)
uniform int u_hasOrigTex;      // 1 = use u_origTex for masking instead of u_srcTex
uniform vec4 u_glowColor;
uniform float u_size;
uniform float u_spread;
uniform float u_opacity;
uniform vec2 u_texelSize;  // 1/layerWidth, 1/layerHeight
uniform vec2 u_srcOffset;  // layer position in document pixels
uniform vec2 u_srcSize;    // layer texture size in pixels
uniform vec2 u_docSize;    // document size in pixels
uniform int u_mode;        // 0 = outer glow, 1 = inner glow
uniform int u_rawAlpha;    // 1 = output raw alpha only (pre-blur extraction)
// original layer position/size for post-blur masking lookups
uniform vec2 u_origOffset;
uniform vec2 u_origSize;
out vec4 fragColor;

void main() {
    vec2 docPos = v_uv * u_docSize;
    vec2 layerUV = (docPos - u_srcOffset) / u_srcSize;

    if (u_rawAlpha == 1) {
        // Pre-blur: extract raw alpha for outer glow, or inverted alpha for inner glow
        float srcA = 0.0;
        if (layerUV.x >= 0.0 && layerUV.x <= 1.0 && layerUV.y >= 0.0 && layerUV.y <= 1.0) {
            srcA = texture(u_srcTex, layerUV).a;
        }
        float alpha = (u_mode == 1) ? (1.0 - srcA) : srcA;
        fragColor = vec4(0.0, 0.0, 0.0, alpha);
        return;
    }

    // Post-blur or no-blur path: apply spread, masking, color
    float blurredAlpha = 0.0;
    if (layerUV.x >= 0.0 && layerUV.x <= 1.0 && layerUV.y >= 0.0 && layerUV.y <= 1.0) {
        blurredAlpha = texture(u_srcTex, layerUV).a;
    }

    // Apply spread as a gamma curve (same approach as shadow spread)
    if (u_spread > 0.5) {
        float t = u_spread * 0.01;
        float exponent = max(1.0 - t, 0.001);
        blurredAlpha = blurredAlpha > 0.001 ? pow(blurredAlpha, exponent) : 0.0;
    }

    // Get original layer alpha for masking
    float srcA = 0.0;
    if (u_hasOrigTex == 1) {
        vec2 origUV = (docPos - u_origOffset) / u_origSize;
        if (origUV.x >= 0.0 && origUV.x <= 1.0 && origUV.y >= 0.0 && origUV.y <= 1.0) {
            srcA = texture(u_origTex, origUV).a;
        }
    } else {
        if (layerUV.x >= 0.0 && layerUV.x <= 1.0 && layerUV.y >= 0.0 && layerUV.y <= 1.0) {
            srcA = texture(u_srcTex, layerUV).a;
        }
    }

    float alpha;
    if (u_mode == 0) {
        alpha = blurredAlpha * (1.0 - srcA);
    } else {
        alpha = srcA * blurredAlpha;
    }
    fragColor = vec4(u_glowColor.rgb, alpha * u_glowColor.a * u_opacity);
}
