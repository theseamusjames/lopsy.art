// Bilinear sample of a straight-alpha texture, interpolated in
// premultiplied space and un-premultiplied on return. Hardware LINEAR
// filtering of straight alpha averages the RGB of transparent (black)
// texels into anti-aliased edges and leaves a dark fringe (#815).
// Uses texelFetch, so the texture's own filter mode is irrelevant.
vec4 fetchPremul(sampler2D tex, ivec2 p, ivec2 maxP) {
    vec4 c = texelFetch(tex, clamp(p, ivec2(0), maxP), 0);
    return vec4(c.rgb * c.a, c.a);
}

vec4 samplePremulBilinear(sampler2D tex, vec2 uv) {
    ivec2 size = textureSize(tex, 0);
    ivec2 maxP = size - 1;
    vec2 p = uv * vec2(size) - 0.5;
    vec2 f = fract(p);
    ivec2 i0 = ivec2(floor(p));
    vec4 c00 = fetchPremul(tex, i0, maxP);
    vec4 c10 = fetchPremul(tex, i0 + ivec2(1, 0), maxP);
    vec4 c01 = fetchPremul(tex, i0 + ivec2(0, 1), maxP);
    vec4 c11 = fetchPremul(tex, i0 + ivec2(1, 1), maxP);
    vec4 m = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
    if (m.a < 1e-6) return vec4(0.0);
    return vec4(m.rgb / m.a, m.a);
}
