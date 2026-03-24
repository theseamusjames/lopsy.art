#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_direction;
uniform float u_weights[64];
uniform int u_radius;
out vec4 fragColor;
void main() {
    vec2 texelSize = 1.0 / vec2(textureSize(u_tex, 0));
    vec4 result = texture(u_tex, v_uv) * u_weights[0];
    for (int i = 1; i <= 63; i++) {
        if (i > u_radius) break;
        vec2 offset = u_direction * float(i) * texelSize;
        result += texture(u_tex, v_uv + offset) * u_weights[i];
        result += texture(u_tex, v_uv - offset) * u_weights[i];
    }
    fragColor = result;
}
