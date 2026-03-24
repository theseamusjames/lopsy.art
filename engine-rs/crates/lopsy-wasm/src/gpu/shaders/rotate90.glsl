#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform int u_clockwise;
out vec4 fragColor;
void main() {
    vec2 uv;
    if (u_clockwise == 1) {
        // CW: (x, y) → (1-y, x)
        uv = vec2(1.0 - v_uv.y, v_uv.x);
    } else {
        // CCW: (x, y) → (y, 1-x)
        uv = vec2(v_uv.y, 1.0 - v_uv.x);
    }
    fragColor = texture(u_tex, uv);
}
