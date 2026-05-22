#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform int u_channel; // 0=R, 1=G, 2=B, 3=A
out vec4 fragColor;
void main() {
    vec4 c = texture(u_tex, v_uv);
    float v = u_channel == 0 ? c.r : u_channel == 1 ? c.g : u_channel == 2 ? c.b : c.a;
    fragColor = vec4(v, v, v, 1.0);
}
