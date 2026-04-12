#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_offsetR; // red channel offset in pixels
uniform float u_offsetB; // blue channel offset in pixels
uniform float u_angle;   // direction angle in radians
out vec4 fragColor;
void main() {
    vec2 texSize = vec2(textureSize(u_tex, 0));
    vec2 dir = vec2(cos(u_angle), sin(u_angle)) / texSize;
    vec4 center = texture(u_tex, v_uv);
    float r = texture(u_tex, v_uv + dir * u_offsetR).r;
    float b = texture(u_tex, v_uv - dir * u_offsetB).b;
    fragColor = vec4(r, center.g, b, center.a);
}
