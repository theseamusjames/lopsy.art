#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_srcTex;
uniform vec4 u_glowColor;
uniform float u_size;
uniform float u_spread;
uniform float u_opacity;
uniform vec2 u_texelSize;
// u_mode: 0 = outer glow (subtract source alpha), 1 = inner glow (multiply by source alpha, invert)
uniform int u_mode;
out vec4 fragColor;
void main() {
    float alpha = 0.0;
    float total = 0.0;
    int radius = int(u_size);
    for (int y = -radius; y <= radius; y++) {
        for (int x = -radius; x <= radius; x++) {
            float d = length(vec2(float(x), float(y)));
            if (d > u_size) continue;
            float w = 1.0 - d / u_size;
            w = pow(w, 2.0 - u_spread);
            alpha += texture(u_srcTex, v_uv + vec2(float(x), float(y)) * u_texelSize).a * w;
            total += w;
        }
    }
    alpha = alpha / max(total, 1.0);
    float srcA = texture(u_srcTex, v_uv).a;
    if (u_mode == 0) {
        // Outer glow: only outside the shape
        alpha = alpha * (1.0 - srcA);
    } else {
        // Inner glow: only inside the shape, at edges
        alpha = srcA * (1.0 - min(alpha / max(srcA, 0.001), 1.0));
    }
    fragColor = vec4(u_glowColor.rgb, alpha * u_glowColor.a * u_opacity);
}
