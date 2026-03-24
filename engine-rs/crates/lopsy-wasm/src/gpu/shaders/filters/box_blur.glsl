#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_direction;
uniform int u_radius;
out vec4 fragColor;
void main() {
    vec2 texelSize = 1.0 / vec2(textureSize(u_tex, 0));
    vec4 sum = vec4(0.0);
    float count = 0.0;
    for (int i = -63; i <= 63; i++) {
        if (i < -u_radius || i > u_radius) continue;
        sum += texture(u_tex, v_uv + u_direction * float(i) * texelSize);
        count += 1.0;
    }
    fragColor = sum / count;
}
