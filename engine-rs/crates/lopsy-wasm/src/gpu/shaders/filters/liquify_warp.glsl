#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform sampler2D u_disp;
uniform float u_maxDisp;
uniform vec2 u_texelSize;

void main() {
    vec4 d = texture(u_disp, v_uv);

    float ndx = (d.r * 256.0 + d.g) / 257.0;
    float ndy = (d.b * 256.0 + d.a) / 257.0;

    vec2 dispPx = (vec2(ndx, ndy) * 2.0 - 1.0) * u_maxDisp;
    vec2 srcUv = v_uv - dispPx * u_texelSize;

    if (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = texture(u_tex, srcUv);
    }
}
