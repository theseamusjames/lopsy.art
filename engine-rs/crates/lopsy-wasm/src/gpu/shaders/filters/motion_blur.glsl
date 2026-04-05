#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform float u_angle;    // radians
uniform int u_distance;   // number of samples

void main() {
    vec2 texSize = vec2(textureSize(u_tex, 0));
    vec2 dir = vec2(cos(u_angle), sin(u_angle)) / texSize;

    vec4 color = vec4(0.0);
    int samples = max(1, u_distance);
    float halfDist = float(samples) * 0.5;

    for (int i = 0; i < samples; i++) {
        float offset = float(i) - halfDist;
        vec2 sampleUV = v_uv + dir * offset;
        color += texture(u_tex, sampleUV);
    }

    fragColor = color / float(samples);
}
