#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform sampler2D u_lut;
uniform float u_lutSize;
uniform float u_intensity;

void main() {
    vec4 color = texture(u_tex, v_uv);

    float N = u_lutSize;
    float maxIdx = N - 1.0;

    float blueScaled = color.b * maxIdx;
    float slice0 = floor(blueScaled);
    float slice1 = min(slice0 + 1.0, maxIdx);
    float blueFrac = blueScaled - slice0;

    float v_coord = (color.g * maxIdx + 0.5) / N;

    float u0 = (slice0 * N + color.r * maxIdx + 0.5) / (N * N);
    float u1 = (slice1 * N + color.r * maxIdx + 0.5) / (N * N);

    vec3 lut0 = texture(u_lut, vec2(u0, v_coord)).rgb;
    vec3 lut1 = texture(u_lut, vec2(u1, v_coord)).rgb;
    vec3 lutColor = mix(lut0, lut1, blueFrac);

    vec3 result = mix(color.rgb, lutColor, u_intensity);
    fragColor = vec4(result, color.a);
}
