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

    ivec2 pixelCoord = ivec2(floor(layerUV * vec2(texSize)));

    // Spread is 0-100 from the UI. Normalize to [0, 2] for the exponent.
    // 0 = softest (quadratic falloff), 100 = hardest (flat weight).
    // Values < 2 (from old tests using raw 0-2 range) still work fine.
    float normalizedSpread = clamp(u_spread * 0.02, 0.0, 2.0);

    int maxRadius = int(ceil(u_size));

    // Adaptive step: finer grid now that pow() is eliminated for the common case.
    // step=1 up to size 20, step=2 up to 40, etc. Max grid ~41x41 = 1681 samples.
    int step = max(1, maxRadius / 20);

    float srcA = 0.0;
    if (pixelCoord.x >= 0 && pixelCoord.x < texSize.x &&
        pixelCoord.y >= 0 && pixelCoord.y < texSize.y) {
        srcA = texelFetch(u_srcTex, pixelCoord, 0).a;
    }

    float alpha = 0.0;
    float total = 0.0;

    // Center the grid on 0 so the pixel's own value is always sampled.
    int halfSteps = (maxRadius + step - 1) / step; // ceiling division
    float sizeSq = u_size * u_size;
    float invSize = 1.0 / max(u_size, 0.001);
    // Pre-compute the exponent. For spread=0 (most common), exponent=2.0.
    float exponent = 2.0 - normalizedSpread;
    // Use fast path (multiply) for integer exponents to avoid pow() per sample.
    bool useFastQuadratic = abs(exponent - 2.0) < 0.01;
    bool useFastLinear = abs(exponent - 1.0) < 0.01;

    for (int iy = -halfSteps; iy <= halfSteps; iy++) {
        for (int ix = -halfSteps; ix <= halfSteps; ix++) {
            int x = ix * step;
            int y = iy * step;
            // Use integer distance squared — avoids sqrt() per sample
            float dSq = float(x * x + y * y);
            if (dSq > sizeSq) continue;
            float d = sqrt(dSq);
            float w = 1.0 - d * invSize;
            // Fast path for common exponents avoids expensive pow()
            if (useFastQuadratic) { w = w * w; }
            else if (useFastLinear) { /* w = w; no-op */ }
            else { w = pow(max(w, 0.0), exponent); }

            ivec2 sCoord = pixelCoord + ivec2(x, y);
            float sampleA = 0.0;
            if (sCoord.x >= 0 && sCoord.x < texSize.x &&
                sCoord.y >= 0 && sCoord.y < texSize.y) {
                sampleA = texelFetch(u_srcTex, sCoord, 0).a;
            }

            if (u_mode == 1) {
                // Inner glow: blur the inverted alpha (1 outside, 0 inside).
                // Result is high near edges, low deep inside — a smooth
                // distance-field-like falloff that works at all blur radii.
                alpha += (1.0 - sampleA) * w;
            } else {
                alpha += sampleA * w;
            }
            total += w;
        }
    }
    alpha = alpha / max(total, 1.0);

    if (u_mode == 0) {
        // Outer glow: only outside the shape
        alpha = alpha * (1.0 - srcA);
    } else {
        // Inner glow: mask the blurred inverted-alpha to the shape interior
        alpha = srcA * alpha;
    }
    fragColor = vec4(u_glowColor.rgb, alpha * u_glowColor.a * u_opacity);
}
