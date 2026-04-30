#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_rr, u_rg, u_rb;
uniform float u_gr, u_gg, u_gb;
uniform float u_br, u_bg, u_bb;
uniform float u_cr;
uniform float u_cg;
uniform float u_cb;
out vec4 fragColor;
void main() {
    vec4 c = texture(u_tex, v_uv);
    float r = c.r * u_rr + c.g * u_rg + c.b * u_rb + u_cr;
    float g = c.r * u_gr + c.g * u_gg + c.b * u_gb + u_cg;
    float b = c.r * u_br + c.g * u_bg + c.b * u_bb + u_cb;
    fragColor = vec4(clamp(r, 0.0, 1.0), clamp(g, 0.0, 1.0), clamp(b, 0.0, 1.0), c.a);
}
