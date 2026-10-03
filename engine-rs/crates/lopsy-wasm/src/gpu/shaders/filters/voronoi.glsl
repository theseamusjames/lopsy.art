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

    // Pass 1: nearest seed (each seed is jittered inside its own cell).
    float minDist = 1e10;
    vec2 nearestOffset = vec2(0.0);
    vec2 nearestCell = vec2(0.0);
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 offset = neighbor + hash2(cellIdx + neighbor, u_seed) - cellFrac;
            float d = dot(offset, offset);
            if (d < minDist) {
                minDist = d;
                nearestOffset = offset;
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
    // centred on its cell.
    float edgeDist = 1e10;
    for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
            vec2 neighbor = nearestCell + vec2(float(x), float(y));
            vec2 offset = neighbor + hash2(cellIdx + neighbor, u_seed) - cellFrac;
            vec2 between = offset - nearestOffset;
            if (dot(between, between) < 1e-8) {
                continue;
            }
            edgeDist = min(edgeDist, dot(0.5 * (nearestOffset + offset), normalize(between)));
        }
    }

    // Sample image color at the Voronoi cell center
    vec2 closestCell = cellIdx + nearestCell;
    vec2 closestCenter = closestCell + hash2(closestCell, u_seed);
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
