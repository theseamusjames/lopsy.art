#version 300 es
precision highp float;
in vec2 v_uv;
in float v_alpha;
uniform sampler2D u_stampTex;
uniform vec4 u_brushColor;
uniform float u_opacity;
uniform float u_flow;
out vec4 fragColor;
void main() {
    float stamp = texture(u_stampTex, v_uv).r;
    float a = stamp * v_alpha * u_opacity * u_flow;
    fragColor = vec4(u_brushColor.rgb, u_brushColor.a * a);
}
