#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_radius;
uniform float u_sharpness;

out vec4 fragColor;

void main() {
    vec2 texSize = vec2(textureSize(u_tex, 0));
    vec2 texel = 1.0 / texSize;
    int r = int(u_radius);

    // Kuwahara filter: divide neighborhood into 4 overlapping quadrants,
    // compute mean & variance of each, then weight by inverse variance.
    vec3 mean[4];
    vec3 var_sum[4];
    float count[4];

    for (int i = 0; i < 4; i++) {
        mean[i] = vec3(0.0);
        var_sum[i] = vec3(0.0);
        count[i] = 0.0;
    }

    // Quadrant 0: top-left (-r..0, -r..0)
    // Quadrant 1: top-right (0..+r, -r..0)
    // Quadrant 2: bottom-left (-r..0, 0..+r)
    // Quadrant 3: bottom-right (0..+r, 0..+r)
    for (int dy = -r; dy <= r; dy++) {
        for (int dx = -r; dx <= r; dx++) {
            vec2 offset = vec2(float(dx), float(dy)) * texel;
            vec3 s = texture(u_tex, v_uv + offset).rgb;

            if (dx <= 0 && dy <= 0) { mean[0] += s; var_sum[0] += s * s; count[0] += 1.0; }
            if (dx >= 0 && dy <= 0) { mean[1] += s; var_sum[1] += s * s; count[1] += 1.0; }
            if (dx <= 0 && dy >= 0) { mean[2] += s; var_sum[2] += s * s; count[2] += 1.0; }
            if (dx >= 0 && dy >= 0) { mean[3] += s; var_sum[3] += s * s; count[3] += 1.0; }
        }
    }

    vec3 result = vec3(0.0);
    float totalWeight = 0.0;

    for (int i = 0; i < 4; i++) {
        vec3 m = mean[i] / count[i];
        vec3 v = var_sum[i] / count[i] - m * m;
        float variance = dot(v, vec3(1.0));

        // Weight inversely by variance raised to sharpness power
        float w = 1.0 / (1.0 + pow(variance * 1000.0, u_sharpness));
        result += m * w;
        totalWeight += w;
    }

    vec4 orig = texture(u_tex, v_uv);
    fragColor = vec4(result / totalWeight, orig.a);
}
