#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_center;
uniform float u_radius;
uniform vec2 u_texSize;
out vec4 fragColor;

// Poisson disk samples in unit circle (32 taps for good coverage)
const int NUM_SAMPLES = 32;
const vec2 SAMPLES[32] = vec2[32](
    vec2(-0.613, 0.617), vec2(0.170, -0.040), vec2(-0.299, -0.294),
    vec2(0.525, 0.529), vec2(-0.840, -0.138), vec2(0.149, -0.600),
    vec2(0.700, -0.497), vec2(-0.228, 0.318), vec2(0.471, 0.062),
    vec2(-0.516, -0.693), vec2(0.862, 0.170), vec2(-0.100, 0.888),
    vec2(0.354, -0.916), vec2(-0.689, 0.224), vec2(0.063, 0.372),
    vec2(-0.448, 0.947), vec2(0.940, -0.224), vec2(-0.919, 0.373),
    vec2(0.273, 0.838), vec2(-0.135, -0.879), vec2(0.657, -0.783),
    vec2(-0.752, -0.465), vec2(0.410, -0.367), vec2(-0.316, 0.645),
    vec2(0.820, 0.698), vec2(-0.582, 0.015), vec2(0.098, -0.295),
    vec2(-0.017, 0.142), vec2(0.574, 0.302), vec2(-0.423, -0.087),
    vec2(0.186, 0.568), vec2(-0.732, 0.791)
);

void main() {
    vec3 sum = vec3(0.0);
    float count = 0.0;

    for (int i = 0; i < NUM_SAMPLES; i++) {
        vec2 offset = SAMPLES[i] * u_radius;
        vec2 samplePos = u_center + offset;
        vec2 sampleUV = samplePos / u_texSize;

        if (sampleUV.x >= 0.0 && sampleUV.x <= 1.0 &&
            sampleUV.y >= 0.0 && sampleUV.y <= 1.0) {
            vec4 s = texture(u_tex, sampleUV);
            if (s.a > 0.0) {
                sum += s.rgb;
                count += 1.0;
            }
        }
    }

    if (count > 0.0) {
        fragColor = vec4(sum / count, 1.0);
    } else {
        fragColor = vec4(0.0);
    }
}
