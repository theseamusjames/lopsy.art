#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform vec2 u_center;    // normalized center (0.5, 0.5 = image center)
uniform int u_amount;     // number of samples / strength

void main() {
    vec2 dir = u_center - v_uv;
    int samples = max(1, u_amount);
    float invSamples = 1.0 / float(samples);

    vec4 color = vec4(0.0);
    for (int i = 0; i < samples; i++) {
        float t = float(i) * invSamples;
        vec2 offset = dir * t * 0.1;
        color += texture(u_tex, v_uv + offset);
    }

    fragColor = color * invSamples;
}
