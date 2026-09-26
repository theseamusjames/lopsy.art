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

// Must match DISPLACEMENT_CENTER / DISPLACEMENT_SCALE in
// src/filters/mesh-warp.ts. Byte 128 is an exact zero so an untouched
// grid point never shifts content.
const float DISP_CENTER = 128.0;
const float DISP_SCALE = 127.0;

// Damped (0.5) fixed-point steps converge for any non-folding mesh that
// stretches a cell by less than 4x; plain undamped steps diverge once a
// cell is stretched past 2x. Each step is one grid texture fetch.
const int INVERSE_ITERATIONS = 16;
const float INVERSE_DAMPING = 0.5;

vec2 displacementAt(vec2 uv, vec2 boundsSize) {
    vec2 localUv = clamp((uv - u_boundsMin) / boundsSize, 0.0, 1.0);
    vec2 gridUv = localUv * (u_gridSize - 1.0) / u_gridSize + 0.5 / u_gridSize;
    vec2 disp = texture(u_grid, gridUv).rg;
    return (disp * 255.0 - DISP_CENTER) / DISP_SCALE;
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
    // the inverse — find src with src + D(src) = v_uv — which we solve by
    // damped fixed-point iteration starting from the undisplaced position.
    vec2 srcUv = v_uv;
    for (int i = 0; i < INVERSE_ITERATIONS; i++) {
        vec2 target = v_uv - displacementAt(srcUv, boundsSize);
        srcUv += (target - srcUv) * INVERSE_DAMPING;
    }

    if (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = texture(u_tex, srcUv);
    }
}
