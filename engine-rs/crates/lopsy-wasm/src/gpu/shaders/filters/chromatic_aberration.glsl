#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_amount;    // pixel offset magnitude
uniform float u_angle;     // direction in radians
out vec4 fragColor;
void main() {
    vec2 texSize = vec2(textureSize(u_tex, 0));
    vec2 texel = 1.0 / texSize;
    vec2 dir = vec2(cos(u_angle), sin(u_angle));
    vec2 offset = u_amount * texel * dir;
    float r = texture(u_tex, v_uv + offset).r;
    vec4 center = texture(u_tex, v_uv);
    float b = texture(u_tex, v_uv - offset).b;
    fragColor = vec4(r, center.g, b, center.a);
}
