#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_disp;
uniform vec2 u_center;
uniform float u_radius;
uniform float u_pressure;
uniform vec2 u_drag;
uniform int u_mode;
uniform vec2 u_size;

out vec4 fragColor;

const float MAX_DISP = 2048.0;
const float BLOAT_STRENGTH = 0.5;

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

vec4 encodeDisp(vec2 d) {
    vec2 steps = d / MAX_DISP * DISP_SCALE;
    vec2 code = clamp(
        sign(steps) * floor(abs(steps) + 0.5) + DISP_CENTER,
        DISP_CENTER - DISP_SCALE,
        DISP_CENTER + DISP_SCALE
    );
    vec2 hi = floor(code / 256.0);
    vec2 lo = code - hi * 256.0;
    return vec4(hi.x, lo.x, hi.y, lo.y) / 255.0;
}

float brushWeight(float distSq, float radiusSq) {
    float t = 1.0 - distSq / radiusSq;
    return t * t * t;
}

void main() {
    vec2 pixel = v_uv * u_size;
    float dx = pixel.x - u_center.x;
    float dy = pixel.y - u_center.y;
    float distSq = dx * dx + dy * dy;
    float radiusSq = u_radius * u_radius;

    ivec2 texel = ivec2(floor(pixel));

    if (distSq >= radiusSq) {
        fragColor = texelFetch(u_disp, texel, 0);
        return;
    }

    float w = brushWeight(distSq, radiusSq) * u_pressure;
    vec2 disp = fetchDisp(texel) * MAX_DISP;

    if (u_mode == 0) {
        // liquify_warp.glsl resamples with srcUv = v_uv + disp (backward/pull
        // mapping), so a pixel that should visually move along +drag needs
        // disp = -drag: the output at p then pulls source content from
        // p - drag, i.e. from where that content used to sit before the
        // drag carried it forward to p. Storing +drag here samples from
        // p + drag instead, which pulls in whatever was ahead of the drag
        // (e.g. transparent pixels past an edge) and reads as a notch
        // opening backward instead of a bulge pushed forward.
        disp -= u_drag * w;
    } else if (u_mode == 1 || u_mode == 2) {
        float angle = (u_mode == 1) ? 0.05 : -0.05;
        float a = angle * w;
        float cs = cos(a);
        float sn = sin(a);
        float ndx = dx * cs - dy * sn - dx;
        float ndy = dx * sn + dy * cs - dy;
        vec2 prev = disp;
        disp.x = ndx + prev.x * cs - prev.y * sn;
        disp.y = ndy + prev.x * sn + prev.y * cs;
    } else if (u_mode == 3 || u_mode == 4) {
        // #945: the per-dab offset is proportional to the distance from the
        // centre (a radial scale), not a constant-length unit vector — a
        // constant magnitude doesn't vanish at the centre, so pixels nearer
        // than that magnitude sample from the opposite side and the image
        // folds. With k * pressure < 1 the radial map stays monotonic.
        // The new offset is composed with the existing field (sampled at
        // the displaced point) rather than added, so repeated dabs keep
        // magnifying smoothly instead of accumulating past the fold.
        float k = (u_mode == 3) ? -BLOAT_STRENGTH : BLOAT_STRENGTH;
        vec2 delta = vec2(dx, dy) * (k * w);
        vec2 prev = sampleDisp(pixel + delta) * MAX_DISP;
        disp = delta + prev;
    }

    fragColor = encodeDisp(disp);
}
