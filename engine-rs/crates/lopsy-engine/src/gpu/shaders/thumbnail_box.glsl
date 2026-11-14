#version 300 es
precision highp float;
uniform sampler2D u_tex;
layout(std140) uniform Params {
    vec2 u_dstSize;
    // -1 = colour, averaged in premultiplied space. 0..3 = that channel's
    // straight value averaged, as grey.
    int u_channel;
};
out vec4 fragColor;

const int MAX_TAPS = 64;

// One output pixel is the box average of its whole source footprint. A
// single LINEAR tap only sees the 2x2 texels at the footprint's centre, so a
// pattern finer than the footprint aliases (a grid shows only its lines).
// Each tap here is a 2x2 bilinear read at a texel corner and the taps step
// 2 texels apart, so up to MAX_TAPS * 2 texels per axis every texel counts
// once; larger footprints are evenly subsampled. texelFetch keeps the
// result independent of the texture's own filter mode.
void main() {
    ivec2 size = textureSize(u_tex, 0);
    ivec2 maxP = size - 1;
    vec2 footprint = vec2(size) / u_dstSize;
    vec2 lo = floor(gl_FragCoord.xy) * footprint;
    ivec2 n = clamp(ivec2(ceil(footprint * 0.5)), ivec2(1), ivec2(MAX_TAPS));
    vec2 stepPx = footprint / vec2(n);

    vec4 premul = vec4(0.0);
    vec4 straight = vec4(0.0);
    for (int j = 0; j < MAX_TAPS; j++) {
        if (j >= n.y) break;
        for (int i = 0; i < MAX_TAPS; i++) {
            if (i >= n.x) break;
            vec2 q = lo + (vec2(float(i), float(j)) + 0.5) * stepPx - 0.5;
            vec2 qf = floor(q);
            ivec2 p0 = ivec2(qf);
            vec2 f = q - qf;
            vec4 c00 = texelFetch(u_tex, clamp(p0, ivec2(0), maxP), 0);
            vec4 c10 = texelFetch(u_tex, clamp(p0 + ivec2(1, 0), ivec2(0), maxP), 0);
            vec4 c01 = texelFetch(u_tex, clamp(p0 + ivec2(0, 1), ivec2(0), maxP), 0);
            vec4 c11 = texelFetch(u_tex, clamp(p0 + ivec2(1, 1), ivec2(0), maxP), 0);
            straight += mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
            premul += mix(
                mix(vec4(c00.rgb * c00.a, c00.a), vec4(c10.rgb * c10.a, c10.a), f.x),
                mix(vec4(c01.rgb * c01.a, c01.a), vec4(c11.rgb * c11.a, c11.a), f.x),
                f.y);
        }
    }
    float count = float(n.x * n.y);

    if (u_channel >= 0) {
        vec4 avg = straight / count;
        float v = u_channel == 0 ? avg.r : u_channel == 1 ? avg.g : u_channel == 2 ? avg.b : avg.a;
        fragColor = vec4(v, v, v, 1.0);
        return;
    }
    if (premul.a < 1e-6) {
        fragColor = vec4(0.0);
        return;
    }
    fragColor = vec4(premul.rgb / premul.a, premul.a / count);
}
