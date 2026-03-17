#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_center;
uniform float u_radius;
uniform vec4 u_stops[16];
uniform float u_stopPositions[16];
uniform int u_stopCount;
uniform vec2 u_texSize;
out vec4 fragColor;
void main() {
    vec2 pos = v_uv * u_texSize;
    float t = clamp(length(pos - u_center) / u_radius, 0.0, 1.0);
    vec4 color = u_stops[0];
    for (int i = 1; i < 16; i++) {
        if (i >= u_stopCount) break;
        if (t >= u_stopPositions[i-1]) {
            float seg = (t - u_stopPositions[i-1]) / max(u_stopPositions[i] - u_stopPositions[i-1], 0.001);
            color = mix(u_stops[i-1], u_stops[i], clamp(seg, 0.0, 1.0));
        }
    }
    fragColor = color;
}
