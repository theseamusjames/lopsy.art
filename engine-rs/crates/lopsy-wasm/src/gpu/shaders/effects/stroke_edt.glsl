#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_seedTex;
uniform float u_stepSize;
uniform vec2 u_texSize;
out vec4 fragColor;
void main() {
    vec2 texel = 1.0 / u_texSize;
    vec2 bestSeed = texture(u_seedTex, v_uv).rg;
    float bestDist = length(bestSeed - v_uv * u_texSize);
    if (bestSeed.x < 0.0) bestDist = 99999.0;
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) continue;
            vec2 offset = vec2(float(dx), float(dy)) * u_stepSize * texel;
            vec2 neighbor = texture(u_seedTex, v_uv + offset).rg;
            if (neighbor.x < 0.0) continue;
            float d = length(neighbor - v_uv * u_texSize);
            if (d < bestDist) { bestDist = d; bestSeed = neighbor; }
        }
    }
    fragColor = vec4(bestSeed, bestDist, 1.0);
}
