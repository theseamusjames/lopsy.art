#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform float u_amount;   // pixel displacement strength
uniform float u_angle;    // direction angle in radians

void main() {
    vec2 texSize = vec2(textureSize(u_tex, 0));
    vec2 dir = vec2(cos(u_angle), sin(u_angle)) / texSize * u_amount;

    float r = texture(u_tex, v_uv + dir).r;
    vec4  g = texture(u_tex, v_uv);
    float b = texture(u_tex, v_uv - dir).b;

    fragColor = vec4(r, g.g, b, g.a);
}
