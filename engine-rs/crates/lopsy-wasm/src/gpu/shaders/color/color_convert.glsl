#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform mat3 u_colorMatrix;
out vec4 fragColor;
void main() {
    vec4 c = texture(u_tex, v_uv);
    c.rgb = clamp(u_colorMatrix * c.rgb, 0.0, 1.0);
    fragColor = c;
}
