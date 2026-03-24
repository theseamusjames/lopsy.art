#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform int u_flipH;
uniform int u_flipV;
out vec4 fragColor;
void main() {
    vec2 uv = v_uv;
    if (u_flipH == 1) uv.x = 1.0 - uv.x;
    if (u_flipV == 1) uv.y = 1.0 - uv.y;
    fragColor = texture(u_tex, uv);
}
