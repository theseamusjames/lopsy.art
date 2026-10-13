#version 300 es
// Wide Stroke band as an exact Euclidean distance test, in two separable
// passes (CPU statement and tests: lopsy-core/src/stroke_band.rs).
// Pass 0 (rows): seeds are texels with alpha >= 0.5; writes the distance to
// the nearest seed in the texel's row, split over R (high byte) and G (low
// byte) so it survives an RGBA8 target exactly.
// Pass 1 (columns): reads those row distances and writes alpha 1 where
// dy² + row(dy)² <= u_reachSq for some dy — a disc, not a square, so the
// band is the same width on diagonal and curved edges as on straight ones.
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform int u_pass;         // 0 = rows, 1 = columns
uniform int u_radius;       // ceil(reach): texels searched on each side
uniform float u_reachSq;    // reach², the band's squared half-width
uniform int u_oobSeed;      // 1 = texels beyond the buffer edge are seeds
out vec4 fragColor;

const float NO_SEED = 65535.0;

vec4 encodeDistance(float d) {
    return vec4(floor(d / 256.0) / 255.0, mod(d, 256.0) / 255.0, 0.0, 1.0);
}

float decodeDistance(vec4 t) {
    vec2 b = floor(t.rg * 255.0 + 0.5);
    return b.x * 256.0 + b.y;
}

bool isSeed(ivec2 p, ivec2 size) {
    if (p.x < 0 || p.y < 0 || p.x >= size.x || p.y >= size.y) return u_oobSeed == 1;
    return texelFetch(u_tex, p, 0).a >= 0.5;
}

float rowDistance(ivec2 p, ivec2 size) {
    if (p.y < 0 || p.y >= size.y) return u_oobSeed == 1 ? 0.0 : NO_SEED;
    return decodeDistance(texelFetch(u_tex, p, 0));
}

void main() {
    ivec2 size = textureSize(u_tex, 0);
    ivec2 p = ivec2(floor(v_uv * vec2(size)));

    if (u_pass == 0) {
        float d = NO_SEED;
        for (int i = 0; i <= 8192; i++) {
            if (i > u_radius) break;
            if (isSeed(p + ivec2(i, 0), size) || isSeed(p - ivec2(i, 0), size)) {
                d = float(i);
                break;
            }
        }
        fragColor = encodeDistance(d);
        return;
    }

    float radius = float(u_radius);
    float best = NO_SEED * NO_SEED;
    for (int i = 0; i <= 8192; i++) {
        if (i > u_radius) break;
        float dySq = float(i * i);
        // Rows further away can only be further: stop once past the best.
        if (dySq >= best) break;
        float h = min(rowDistance(p + ivec2(0, i), size), rowDistance(p - ivec2(0, i), size));
        if (h <= radius) best = min(best, dySq + h * h);
    }
    fragColor = vec4(0.0, 0.0, 0.0, best <= u_reachSq ? 1.0 : 0.0);
}
