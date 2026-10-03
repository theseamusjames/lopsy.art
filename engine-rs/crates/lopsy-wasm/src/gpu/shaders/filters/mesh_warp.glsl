#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform sampler2D u_grid;
uniform vec2 u_gridSize;
// Bounds in texture UV coordinates (0..1). Pixels outside the bounds
// pass through unchanged. When bounds = (0,0,1,1) the warp covers the
// whole image.
uniform vec2 u_boundsMin;
uniform vec2 u_boundsMax;

// Each grid texel holds one point's offset from its identity position in
// bounds-local units, 16 bits per axis: (R, G) = high and low byte of X,
// (B, A) = high and low byte of Y. Must match DISPLACEMENT_CENTER /
// DISPLACEMENT_SCALE in src/filters/mesh-warp.ts; 32768 is an exact zero.
// A single byte per axis moved content in steps of 1/127 of the bounds
// (#1160).
const float DISP_CENTER = 32768.0;
const float DISP_SCALE = 32767.0;

// Newton steps on the piecewise-bilinear forward map, each backed off until
// it lowers the residual. Converges for any non-folding mesh, however hard
// a cell is squashed or stretched; the damped fixed-point iteration this
// replaces crawled under strong compression and broke thin lines into
// dashes.
const int INVERSE_ITERATIONS = 12;
const int MAX_BACKTRACKS = 4;

vec2 gridPoint(ivec2 p) {
    // The pool may store the bytes as RGBA16F; rounding recovers them.
    vec4 b = floor(texelFetch(u_grid, p, 0) * 255.0 + 0.5);
    return (vec2(b.r * 256.0 + b.g, b.b * 256.0 + b.a) - DISP_CENTER) / DISP_SCALE;
}

// Forward displacement at `uv` in texture UV, bilinear between grid
// points, and its Jacobian. Outside the bounds the displacement holds its
// edge value, so the derivative across that axis is zero.
vec2 displacementAt(vec2 uv, vec2 boundsSize, out mat2 jacobian) {
    vec2 localUv = (uv - u_boundsMin) / boundsSize;
    vec2 cells = u_gridSize - 1.0;
    vec2 g = clamp(localUv, 0.0, 1.0) * cells;
    ivec2 i0 = ivec2(clamp(floor(g), vec2(0.0), cells - 1.0));
    vec2 f = g - vec2(i0);

    vec2 d00 = gridPoint(i0);
    vec2 d10 = gridPoint(i0 + ivec2(1, 0));
    vec2 d01 = gridPoint(i0 + ivec2(0, 1));
    vec2 d11 = gridPoint(i0 + ivec2(1, 1));

    vec2 inside = step(0.0, localUv) * step(localUv, vec2(1.0));
    vec2 dX = mix(d10 - d00, d11 - d01, f.y) * boundsSize * (cells.x / boundsSize.x) * inside.x;
    vec2 dY = mix(d01 - d00, d11 - d10, f.x) * boundsSize * (cells.y / boundsSize.y) * inside.y;
    jacobian = mat2(dX, dY);
    return mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y) * boundsSize;
}

vec2 residualAt(vec2 srcUv, vec2 boundsSize) {
    mat2 unused;
    return srcUv + displacementAt(srcUv, boundsSize, unused) - v_uv;
}

void main() {
    vec2 boundsSize = u_boundsMax - u_boundsMin;

    // Pixels outside the bounds rect pass through with no warp.
    if (v_uv.x < u_boundsMin.x || v_uv.x > u_boundsMax.x
     || v_uv.y < u_boundsMin.y || v_uv.y > u_boundsMax.y
     || boundsSize.x <= 0.0 || boundsSize.y <= 0.0) {
        fragColor = texture(u_tex, v_uv);
        return;
    }

    // The grid stores a forward map: content at identity position p moves
    // to p + D(p), so dragged content follows its handle. Rendering needs
    // the inverse — find src with src + D(src) = v_uv.
    vec2 srcUv = v_uv;
    for (int i = 0; i < INVERSE_ITERATIONS; i++) {
        mat2 jacobian;
        vec2 residual = srcUv + displacementAt(srcUv, boundsSize, jacobian) - v_uv;
        float err2 = dot(residual, residual);
        if (err2 < 1e-14) break;
        mat2 forward = mat2(1.0) + jacobian;
        float det = determinant(forward);
        // A folded or degenerate cell has no usable Jacobian: fall back to
        // a damped fixed-point step.
        vec2 stepUv = det > 1e-6 ? inverse(forward) * residual : residual * 0.5;
        float t = 1.0;
        for (int k = 0; k < MAX_BACKTRACKS; k++) {
            vec2 r = residualAt(srcUv - stepUv * t, boundsSize);
            if (dot(r, r) < err2) break;
            t *= 0.5;
        }
        srcUv -= stepUv * t;
    }

    if (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = texture(u_tex, srcUv);
    }
}
