#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec4 u_stops[16];
uniform float u_stopPositions[16];
uniform int u_stopCount;
uniform float u_mix;
out vec4 fragColor;
void main() {
    vec4 color = texture(u_tex, v_uv);
    float lum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    float t = clamp(lum, 0.0, 1.0);
    vec4 gradColor = u_stops[0];
    for (int i = 1; i < 16; i++) {
        if (i >= u_stopCount) break;
        if (t >= u_stopPositions[i-1]) {
            float seg = (t - u_stopPositions[i-1]) / max(u_stopPositions[i] - u_stopPositions[i-1], 0.001);
            gradColor = mix(u_stops[i-1], u_stops[i], clamp(seg, 0.0, 1.0));
        }
    }
    // Triangular dither to reduce banding
    vec2 seed = gl_FragCoord.xy;
    float n0 = fract(sin(dot(seed, vec2(12.9898, 78.233))) * 43758.5453);
    float n1 = fract(sin(dot(seed, vec2(63.7264, 10.873))) * 28637.1136);
    float dither = (n0 + n1 - 1.0) / 255.0;
    gradColor.rgb += dither;
    vec3 result = mix(color.rgb, gradColor.rgb, u_mix);
    fragColor = vec4(result, color.a);
}
