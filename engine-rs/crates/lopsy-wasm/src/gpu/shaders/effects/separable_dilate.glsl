#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_direction;  // (1,0) horizontal or (0,1) vertical
uniform int u_radius;
uniform int u_mode;        // 0 = max (dilate), 1 = min (erode)
uniform float u_oobAlpha;  // alpha for samples beyond the buffer edge
out vec4 fragColor;
float sampleAlpha(vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return u_oobAlpha;
    return texture(u_tex, uv).a;
}
void main() {
    vec2 texelSize = 1.0 / vec2(textureSize(u_tex, 0));
    float result = texture(u_tex, v_uv).a;
    for (int i = 1; i <= 100; i++) {
        if (i > u_radius) break;
        vec2 offset = u_direction * float(i) * texelSize;
        float s1 = sampleAlpha(v_uv + offset);
        float s2 = sampleAlpha(v_uv - offset);
        if (u_mode == 0) {
            result = max(result, max(s1, s2));
        } else {
            result = min(result, min(s1, s2));
        }
    }
    fragColor = vec4(0.0, 0.0, 0.0, result);
}
