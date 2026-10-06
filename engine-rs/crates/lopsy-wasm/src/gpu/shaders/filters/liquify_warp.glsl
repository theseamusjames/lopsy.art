#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform sampler2D u_disp;
uniform float u_maxDisp;
uniform vec2 u_texelSize;

// 16 bits per axis: (R, G) = high and low byte of the X code, (B, A) those
// of Y. The code is an exact integer and 32768 is an exact zero, so the
// carry between the bytes never splits one value two ways. A fractional
// code put zero displacement on the 127|255 / 128|0 carry, where backends
// that evaluate floor() and mod() with different precision tore the field
// along every zero-crossing (#1212). Must match DISP_CENTER / DISP_SCALE in
// src/tools/liquify/liquify.ts.
const float DISP_CENTER = 32768.0;
const float DISP_SCALE = 32767.0;

// Decoded offsets are in units of MAX_DISP.
vec2 fetchDisp(ivec2 p) {
    // The pool may store the bytes as RGBA16F; rounding recovers them.
    vec4 b = floor(texelFetch(u_disp, p, 0) * 255.0 + 0.5);
    return (vec2(b.r * 256.0 + b.g, b.b * 256.0 + b.a) - DISP_CENTER) / DISP_SCALE;
}

// Bilinear between decoded texels at `pixel` (texel space, centres at
// k + 0.5). Hardware filtering would blend the high and low bytes
// separately at the texture's own precision.
vec2 sampleDisp(vec2 pixel) {
    ivec2 size = textureSize(u_disp, 0);
    vec2 g = clamp(pixel - 0.5, vec2(0.0), vec2(size - 1));
    ivec2 i0 = ivec2(floor(g));
    ivec2 i1 = min(i0 + 1, size - 1);
    vec2 f = g - vec2(i0);
    vec2 d00 = fetchDisp(i0);
    vec2 d10 = fetchDisp(ivec2(i1.x, i0.y));
    vec2 d01 = fetchDisp(ivec2(i0.x, i1.y));
    vec2 d11 = fetchDisp(i1);
    return mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y);
}

void main() {
    vec2 dispPx = sampleDisp(v_uv * vec2(textureSize(u_disp, 0))) * u_maxDisp;
    vec2 srcUv = v_uv + dispPx * u_texelSize;

    if (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = texture(u_tex, srcUv);
    }
}
