#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_srcTex;
uniform vec4 u_glowColor;
uniform float u_size;
uniform float u_spread;
uniform float u_opacity;
uniform vec2 u_texelSize;
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
    vec4 glow = vec4(u_glowColor.rgb, alpha * u_glowColor.a * u_opacity);
    vec4 src = texture(u_srcTex, v_uv);
    float outA = src.a + glow.a * (1.0 - src.a);
    vec3 outRGB = (src.rgb * src.a + glow.rgb * glow.a * (1.0 - src.a)) / max(outA, 0.001);
    fragColor = vec4(outRGB, outA);
}
