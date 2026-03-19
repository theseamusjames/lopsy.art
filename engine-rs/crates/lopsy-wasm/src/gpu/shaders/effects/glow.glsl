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
uniform int u_mode;        // 0 = outer glow, 1 = inner glow
out vec4 fragColor;

void main() {
    vec2 docPos = v_uv * u_docSize;
    vec2 layerUV = (docPos - u_srcOffset) / u_srcSize;
    ivec2 texSize = textureSize(u_srcTex, 0);

    // Early out if far from layer bounds
    vec2 marginUV = u_size * u_texelSize;
    if (layerUV.x < -marginUV.x || layerUV.x > 1.0 + marginUV.x ||
        layerUV.y < -marginUV.y || layerUV.y > 1.0 + marginUV.y) {
        fragColor = vec4(0.0);
        return;
    }

    // Use texelFetch for exact sampling
    ivec2 pixelCoord = ivec2(layerUV * vec2(texSize));

    float alpha = 0.0;
    float total = 0.0;
    int radius = min(int(ceil(u_size)), 20); // Cap to avoid GPU timeout

    for (int y = -radius; y <= radius; y++) {
        for (int x = -radius; x <= radius; x++) {
            float d = length(vec2(float(x), float(y)));
            if (d > u_size) continue;
            float w = 1.0 - d / u_size;
            w = pow(w, 2.0 - u_spread);

            ivec2 sCoord = pixelCoord + ivec2(x, y);
            float sampleA = 0.0;
            if (sCoord.x >= 0 && sCoord.x < texSize.x &&
                sCoord.y >= 0 && sCoord.y < texSize.y) {
                sampleA = texelFetch(u_srcTex, sCoord, 0).a;
            }
            alpha += sampleA * w;
            total += w;
        }
    }
    alpha = alpha / max(total, 1.0);

    float srcA = 0.0;
    if (pixelCoord.x >= 0 && pixelCoord.x < texSize.x &&
        pixelCoord.y >= 0 && pixelCoord.y < texSize.y) {
        srcA = texelFetch(u_srcTex, pixelCoord, 0).a;
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
