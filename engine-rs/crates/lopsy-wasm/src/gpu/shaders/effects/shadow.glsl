#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_srcTex;
uniform vec4 u_shadowColor;
uniform vec2 u_offset;
uniform float u_blur;
uniform float u_opacity;
uniform vec2 u_texelSize;
out vec4 fragColor;
void main() {
    vec2 shadowUV = v_uv - u_offset * u_texelSize;
    float alpha = 0.0;
    float total = 0.0;
    int radius = int(u_blur);
    for (int y = -radius; y <= radius; y++) {
        for (int x = -radius; x <= radius; x++) {
            alpha += texture(u_srcTex, shadowUV + vec2(float(x), float(y)) * u_texelSize).a;
            total += 1.0;
        }
    }
    alpha = alpha / max(total, 1.0);
    // Output shadow only (no source compositing — compositor handles order)
    fragColor = vec4(u_shadowColor.rgb, alpha * u_shadowColor.a * u_opacity);
}
