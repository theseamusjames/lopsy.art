#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_direction;  // (1,0) horizontal or (0,1) vertical
uniform int u_radius;
uniform int u_mode;        // 0 = max (dilate), 1 = min (erode)
out vec4 fragColor;
void main() {
    vec2 texelSize = 1.0 / vec2(textureSize(u_tex, 0));
    float result = texture(u_tex, v_uv).a;
    for (int i = 1; i <= 100; i++) {
        if (i > u_radius) break;
        vec2 offset = u_direction * float(i) * texelSize;
        float s1 = texture(u_tex, v_uv + offset).a;
        float s2 = texture(u_tex, v_uv - offset).a;
        if (u_mode == 0) {
            result = max(result, max(s1, s2));
        } else {
            result = min(result, min(s1, s2));
        }
    }
    fragColor = vec4(0.0, 0.0, 0.0, result);
}
