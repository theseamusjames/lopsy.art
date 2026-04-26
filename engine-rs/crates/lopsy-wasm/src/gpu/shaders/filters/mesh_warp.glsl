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

void main() {
    vec2 boundsSize = u_boundsMax - u_boundsMin;

    // Pixels outside the bounds rect pass through with no warp.
    if (v_uv.x < u_boundsMin.x || v_uv.x > u_boundsMax.x
     || v_uv.y < u_boundsMin.y || v_uv.y > u_boundsMax.y
     || boundsSize.x <= 0.0 || boundsSize.y <= 0.0) {
        fragColor = texture(u_tex, v_uv);
        return;
    }

    // Map v_uv into bounds-local 0..1 space, then sample the grid.
    vec2 localUv = (v_uv - u_boundsMin) / boundsSize;
    vec2 gridUv = localUv * (u_gridSize - 1.0) / u_gridSize + 0.5 / u_gridSize;
    vec4 disp = texture(u_grid, gridUv);
    vec2 offset = (disp.rg - 0.5) * 2.0;

    vec2 srcUv = v_uv + offset;

    if (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = texture(u_tex, srcUv);
    }
}
