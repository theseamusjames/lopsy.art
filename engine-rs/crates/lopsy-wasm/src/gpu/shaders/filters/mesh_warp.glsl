#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform sampler2D u_grid;
uniform vec2 u_gridSize;

void main() {
    float gw = u_gridSize.x;
    float gh = u_gridSize.y;
    vec2 gridUv = v_uv * (u_gridSize - 1.0) / u_gridSize + 0.5 / u_gridSize;
    vec4 disp = texture(u_grid, gridUv);
    vec2 offset = (disp.rg - 0.5) * 2.0;

    vec2 srcUv = v_uv + offset;

    if (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = texture(u_tex, srcUv);
    }
}
