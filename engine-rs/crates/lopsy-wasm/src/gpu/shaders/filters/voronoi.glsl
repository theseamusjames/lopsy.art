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

// Seed jitter from an integer hash (PCG2D, Jarzynski & Olano 2020) of the
// integer cell index (#1271). Integer arithmetic is exact on every backend,
// so a cell's seed is bit-identical in every evaluation. The old
// `fract(sin(q) * 43758.5453)` hash amplified a one-ulp difference in `q`
// (from FMA contraction or Metal's fast-math sin) into an unrelated value,
// so the two passes below disagreed about where a seed was.
uvec2 pcg2d(uvec2 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;
    v ^= v >> 16u;
    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;
    v ^= v >> 16u;
    return v;
}

// Jitter in [0, 1): the top 24 bits convert to float exactly.
vec2 cellJitter(ivec2 cell, uint seed) {
    uvec2 h = pcg2d(uvec2(cell) + seed * uvec2(0x9E3779B9u, 0x85EBCA6Bu));
    return vec2(h >> 8u) * (1.0 / 16777216.0);
}

void main() {
    vec2 texSize = vec2(textureSize(u_tex, 0));
    float aspect = texSize.x / texSize.y;

    vec2 uv = v_uv;
    vec2 scaledUV = vec2(uv.x * aspect, uv.y) * u_cellCount;
    vec2 cellBase = floor(scaledUV);
    ivec2 cellIdx = ivec2(cellBase);
    vec2 cellFrac = scaledUV - cellBase;
    uint seed = uint(u_seed + 0.5);

    // Pass 1: nearest seed (each seed is jittered inside its own cell).
    float minDist = 1e10;
    vec2 nearestOffset = vec2(0.0);
    vec2 nearestJitter = vec2(0.0);
    ivec2 nearestCell = ivec2(0);
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            ivec2 neighbor = ivec2(x, y);
            vec2 jitter = cellJitter(cellIdx + neighbor, seed);
            vec2 offset = vec2(neighbor) + jitter - cellFrac;
            float d = dot(offset, offset);
            if (d < minDist) {
                minDist = d;
                nearestOffset = offset;
                nearestJitter = jitter;
                nearestCell = neighbor;
            }
        }
    }

    // Pass 2 (#1171): true distance to the cell boundary — the distance to
    // the nearest bisector between the nearest seed and each neighbouring
    // seed. F2 - F1 (used before) only equals twice that distance on the
    // line joining the two seeds; away from it the gap shrinks, so edges
    // flared into wide dark wedges near short borders. The neighbours that
    // can share a border with the nearest seed lie within a 5x5 block
    // centred on its cell. The nearest seed is skipped by its cell index,
    // not by comparing recomputed positions (#1271): every other cell's
    // seed lies in a different unit square, so `between` is never zero.
    float edgeDist = 1e10;
    for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
            if (x == 0 && y == 0) {
                continue;
            }
            ivec2 neighbor = nearestCell + ivec2(x, y);
            vec2 offset = vec2(neighbor) + cellJitter(cellIdx + neighbor, seed) - cellFrac;
            vec2 between = offset - nearestOffset;
            edgeDist = min(edgeDist, dot(0.5 * (nearestOffset + offset), normalize(between)));
        }
    }

    // Sample image color at the Voronoi cell center found in pass 1.
    vec2 closestCenter = vec2(cellIdx + nearestCell) + nearestJitter;
    vec2 sampleUV = closestCenter / (u_cellCount * vec2(aspect, 1.0));
    sampleUV = clamp(sampleUV, vec2(0.0), vec2(1.0));
    vec4 cellColor = texture(u_tex, sampleUV);

    // #936: one cell unit spans height / cellCount px (scaledUV scales the
    // short axis by cellCount), so the px → cell-unit conversion must use
    // the same side. Dividing by the long side thinned edges by the aspect.
    float edgePx = u_edgeWidth / texSize.y * u_cellCount;
    // The line is centred on the boundary, Edge Width px across in total.
    float edge = 1.0 - smoothstep(0.0, max(edgePx, 0.001), 2.0 * edgeDist);

    vec3 edgeColor = vec3(u_edgeR, u_edgeG, u_edgeB);
    vec3 finalColor = mix(cellColor.rgb, edgeColor, edge);
    // #916: voronoi is a Stylize filter, not a generator (unlike Clouds /
    // Smoke / Fibers) — it samples the source image via u_tex, so it must
    // preserve the sampled cell's alpha to keep the layer's silhouette on
    // transparent areas. The #766 fix forced alpha to 1.0 here too, which
    // flooded every transparent region with opaque black.
    fragColor = vec4(finalColor, cellColor.a);
}
