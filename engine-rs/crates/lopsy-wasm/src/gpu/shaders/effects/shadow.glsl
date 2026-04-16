#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_srcTex;
uniform vec4 u_shadowColor;
uniform vec2 u_offset;     // shadow offset in pixels
uniform float u_blur;      // blur radius in pixels
uniform float u_spread;    // 0-100: choke/expand the shadow edge
uniform float u_opacity;
uniform vec2 u_texelSize;  // 1/layerWidth, 1/layerHeight
uniform vec2 u_srcOffset;  // layer position in document pixels
uniform vec2 u_srcSize;    // layer texture size in pixels
uniform vec2 u_docSize;    // document size in pixels
out vec4 fragColor;
void main() {
    // Map document UV to layer-local UV, applying shadow offset
    vec2 docPos = v_uv * u_docSize;
    vec2 layerUV = (docPos - u_srcOffset - u_offset) / u_srcSize;
    // Layer-local UV WITHOUT shadow offset — used to knock the shadow out
    // from behind the layer's opaque pixels so the layer's blend mode operates
    // against the original background, not the shadow color.
    vec2 knockoutUV = (docPos - u_srcOffset) / u_srcSize;
    // Early out if far from layer bounds (with blur margin)
    vec2 marginUV = (u_blur + 1.0) * u_texelSize;
    if (layerUV.x < -marginUV.x || layerUV.x > 1.0 + marginUV.x ||
        layerUV.y < -marginUV.y || layerUV.y > 1.0 + marginUV.y) {
        fragColor = vec4(0.0);
        return;
    }

    ivec2 texSize = textureSize(u_srcTex, 0);
    float alpha = 0.0;

    if (u_blur < 0.5) {
        if (layerUV.x >= 0.0 && layerUV.x <= 1.0 && layerUV.y >= 0.0 && layerUV.y <= 1.0) {
            alpha = texture(u_srcTex, layerUV).a;
        }
    } else {
        float total = 0.0;
        int maxRadius = int(ceil(u_blur));
        // Adaptive step: finer grid for smoother blur. Max grid ~41x41 = 1681.
        int step = max(1, maxRadius / 20);
        int halfSteps = (maxRadius + step - 1) / step; // ceiling division
        float blurSq = u_blur * u_blur;

        for (int iy = -halfSteps; iy <= halfSteps; iy++) {
            for (int ix = -halfSteps; ix <= halfSteps; ix++) {
                int x = ix * step;
                int y = iy * step;
                float dSq = float(x * x + y * y);
                if (dSq > blurSq) continue;

                vec2 sampleUV = layerUV + vec2(float(x), float(y)) * u_texelSize;
                float sampleA = 0.0;
                if (sampleUV.x >= 0.0 && sampleUV.x <= 1.0 &&
                    sampleUV.y >= 0.0 && sampleUV.y <= 1.0) {
                    sampleA = texture(u_srcTex, sampleUV).a;
                }
                alpha += sampleA;
                total += 1.0;
            }
        }
        alpha = alpha / max(total, 1.0);
    }

    // Spread: gamma curve to expand the shadow toward a hard edge.
    // spread=0 → no change. spread=50 → sqrt(alpha), edges harden.
    // spread=100 → fully hard silhouette (all visible alpha → 1).
    if (u_spread > 0.5) {
        float t = u_spread * 0.01; // normalize 0-100 → 0-1
        // pow(alpha, 1-t): as t→1, exponent→0, alpha→1 for any non-zero input.
        // Avoids the division-by-near-zero artifact of the linear boost.
        float exponent = max(1.0 - t, 0.001);
        alpha = alpha > 0.001 ? pow(alpha, exponent) : 0.0;
    }

    // Knock out the shadow behind the layer — Photoshop "Layer Knocks Out
    // Drop Shadow" behavior. This ensures blend modes on the layer operate
    // against the original background, not the shadow.
    float knockoutAlpha = 0.0;
    if (knockoutUV.x >= 0.0 && knockoutUV.x <= 1.0 && knockoutUV.y >= 0.0 && knockoutUV.y <= 1.0) {
        knockoutAlpha = texture(u_srcTex, knockoutUV).a;
    }

    fragColor = vec4(u_shadowColor.rgb, alpha * u_shadowColor.a * u_opacity * (1.0 - knockoutAlpha));
}
