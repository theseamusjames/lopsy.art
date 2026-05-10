#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_cellCount;
uniform float u_edgeWidth;
uniform float u_edgeR;
uniform float u_edgeG;
uniform float u_edgeB;
uniform float u_seed;

out vec4 fragColor;

// Hash function for pseudo-random Voronoi cell centers
vec2 hash2(vec2 p, float seed) {
    vec3 q = vec3(
        dot(p, vec2(127.1 + seed, 311.7)),
        dot(p, vec2(269.5, 183.3 + seed)),
        dot(p, vec2(419.2 + seed, 371.9))
    );
    return fract(sin(q.xy) * 43758.5453);
}

void main() {
    vec2 texSize = vec2(textureSize(u_tex, 0));
    float aspect = texSize.x / texSize.y;

    vec2 uv = v_uv;
    vec2 scaledUV = vec2(uv.x * aspect, uv.y) * u_cellCount;
    vec2 cellIdx = floor(scaledUV);
    vec2 cellFrac = fract(scaledUV);

    float minDist = 1e10;
    float secondDist = 1e10;
    vec2 closestCenter = vec2(0.0);
    vec2 closestCellIdx = vec2(0.0);

    // Search 3x3 neighbourhood
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 point = hash2(cellIdx + neighbor, u_seed);
            vec2 diff = neighbor + point - cellFrac;
            float d = dot(diff, diff);

            if (d < minDist) {
                secondDist = minDist;
                minDist = d;
                closestCenter = cellIdx + neighbor + point;
                closestCellIdx = cellIdx + neighbor;
            } else if (d < secondDist) {
                secondDist = d;
            }
        }
    }

    minDist = sqrt(minDist);
    secondDist = sqrt(secondDist);

    // Sample image color at the Voronoi cell center
    vec2 sampleUV = closestCenter / (u_cellCount * vec2(aspect, 1.0));
    sampleUV = clamp(sampleUV, vec2(0.0), vec2(1.0));
    vec4 cellColor = texture(u_tex, sampleUV);

    // Compute edge factor from distance to cell boundary
    float edgeDist = secondDist - minDist;
    float edgePx = u_edgeWidth / max(texSize.x, texSize.y) * u_cellCount;
    float edge = 1.0 - smoothstep(0.0, max(edgePx, 0.001), edgeDist);

    vec3 edgeColor = vec3(u_edgeR, u_edgeG, u_edgeB);
    vec3 finalColor = mix(cellColor.rgb, edgeColor, edge);
    fragColor = vec4(finalColor, cellColor.a);
}
