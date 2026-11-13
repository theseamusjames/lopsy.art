#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 fragColor;

//#include premul_sample

void main() {
    fragColor = samplePremulBilinear(u_tex, v_uv);
}
