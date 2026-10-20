#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_amount;
// Document color mode: 1 = Lab, whose textures hold encoded CIELAB. Scaling
// the encoded a/b channels would push them toward -128 (blue), so the pass
// darkens decoded sRGB and re-encodes it.
uniform int u_docColorMode;
out vec4 fragColor;

//#include lab

void main() {
    vec4 c = texture(u_tex, v_uv);
    bool isLab = u_docColorMode == 1;
    if (isLab) c.rgb = labToSrgb(c.rgb);
    float dist = length(v_uv - 0.5) * 1.414;
    float vig = 1.0 - smoothstep(0.5, 1.2, dist) * u_amount * 0.01;
    c.rgb *= vig;
    if (isLab) c.rgb = srgbToLab(c.rgb);
    fragColor = vec4(c.rgb, c.a);
}
