#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_srcTex;
uniform vec4 u_glowColor;
uniform float u_size;
uniform float u_spread;
uniform float u_opacity;
uniform vec2 u_texelSize;  // 1/layerWidth, 1/layerHeight
uniform vec2 u_srcOffset;  // layer position in document pixels
uniform vec2 u_srcSize;    // layer texture size in pixels
uniform vec2 u_docSize;    // document size in pixels
// u_mode: 0 = outer glow, 1 = inner glow
uniform int u_mode;
out vec4 fragColor;

void main() {
    // Map document UV to layer-local UV
    vec2 docPos = v_uv * u_docSize;
    vec2 layerUV = (docPos - u_srcOffset) / u_srcSize;

    // Early out if far from layer bounds (with glow radius margin)
    vec2 marginUV = u_size * u_texelSize;
    if (layerUV.x < -marginUV.x || layerUV.x > 1.0 + marginUV.x ||
        layerUV.y < -marginUV.y || layerUV.y > 1.0 + marginUV.y) {
        fragColor = vec4(0.0);
        return;
    }

    float alpha = 0.0;
    float total = 0.0;
    int radius = int(ceil(u_size));
    for (int y = -radius; y <= radius; y++) {
        for (int x = -radius; x <= radius; x++) {
            float d = length(vec2(float(x), float(y)));
            if (d > u_size) continue;
            float w = 1.0 - d / u_size;
            w = pow(w, 2.0 - u_spread);
            vec2 sampleUV = layerUV + vec2(float(x), float(y)) * u_texelSize;
            // Clamp to texture bounds — outside is alpha 0
            float sampleA = 0.0;
            if (sampleUV.x >= 0.0 && sampleUV.x <= 1.0 && sampleUV.y >= 0.0 && sampleUV.y <= 1.0) {
                sampleA = texture(u_srcTex, sampleUV).a;
            }
            alpha += sampleA * w;
            total += w;
        }
    }
    alpha = alpha / max(total, 1.0);

    float srcA = 0.0;
    if (layerUV.x >= 0.0 && layerUV.x <= 1.0 && layerUV.y >= 0.0 && layerUV.y <= 1.0) {
        srcA = texture(u_srcTex, layerUV).a;
    }

    if (u_mode == 0) {
        // Outer glow: only outside the shape
        alpha = alpha * (1.0 - srcA);
    } else {
        // Inner glow: only inside the shape, at edges
        alpha = srcA * (1.0 - min(alpha / max(srcA, 0.001), 1.0));
    }
    fragColor = vec4(u_glowColor.rgb, alpha * u_glowColor.a * u_opacity);
}
