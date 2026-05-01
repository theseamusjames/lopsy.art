#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_offsetX;
uniform float u_offsetY;

out vec4 fragColor;

void main() {
    vec2 uv = fract(v_uv + vec2(u_offsetX, u_offsetY));
    fragColor = texture(u_tex, uv);
}
