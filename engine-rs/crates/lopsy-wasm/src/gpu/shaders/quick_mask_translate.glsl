#version 300 es
precision highp float;
uniform sampler2D u_base;
uniform sampler2D u_marquee;
layout(std140) uniform Params {
    ivec2 u_offset;
};
out vec4 fragColor;
// Moves the quick-mask content under the marquee by u_offset texels: the
// marquee's original area is cleared and the moved content max-blends onto
// what it lands on. Mirrors translateQuickMaskContent in quick-mask-move.ts.
// Texel rows match document rows, so the offset needs no flip.
float marqueeAt(ivec2 p) {
    ivec2 size = textureSize(u_marquee, 0);
    if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, size))) return 0.0;
    return texelFetch(u_marquee, p, 0).r;
}
void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 size = textureSize(u_base, 0);
    float v = marqueeAt(p) > 0.0 ? 0.0 : texelFetch(u_base, p, 0).r;
    ivec2 s = p - u_offset;
    if (all(greaterThanEqual(s, ivec2(0))) && all(lessThan(s, size)) && marqueeAt(s) > 0.0) {
        v = max(v, texelFetch(u_base, s, 0).r);
    }
    fragColor = vec4(vec3(v), 1.0);
}
