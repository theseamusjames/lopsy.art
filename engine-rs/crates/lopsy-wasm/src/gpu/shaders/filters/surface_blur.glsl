#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform int u_radius;
uniform float u_threshold;
out vec4 fragColor;

void main() {
    vec2 texelSize = 1.0 / vec2(textureSize(u_tex, 0));
    vec4 center = texture(u_tex, v_uv);

    vec4 weightedSum = vec4(0.0);
    float totalWeight = 0.0;

    int r = u_radius;
    for (int dy = -r; dy <= r; dy++) {
        for (int dx = -r; dx <= r; dx++) {
            vec2 offset = vec2(float(dx), float(dy)) * texelSize;
            vec4 neighborColor = texture(u_tex, v_uv + offset);

            // Color distance between neighbor and center pixel (RGB channels)
            float dist = length(neighborColor.rgb - center.rgb);

            // Spatial weight: linear falloff within radius
            float spatialDist = length(vec2(float(dx), float(dy)));
            float spatialWeight = max(0.0, 1.0 - spatialDist / (float(r) + 1.0));

            // Range weight: exclude pixels beyond threshold
            float rangeWeight = 1.0 - smoothstep(u_threshold * 0.95, u_threshold, dist);

            float weight = spatialWeight * rangeWeight;
            weightedSum += neighborColor * weight;
            totalWeight += weight;
        }
    }

    if (totalWeight > 0.0) {
        fragColor = weightedSum / totalWeight;
    } else {
        fragColor = center;
    }
    // Preserve original alpha
    fragColor.a = center.a;
}
