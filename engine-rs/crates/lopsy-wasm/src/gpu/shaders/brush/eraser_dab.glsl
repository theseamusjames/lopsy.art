#version 300 es
precision highp float;
in vec2 v_uv;
in float v_alpha;
uniform sampler2D u_stampTex;
uniform sampler2D u_layerTex;
uniform float u_opacity;
out vec4 fragColor;
void main() {
    float stamp = texture(u_stampTex, v_uv).r;
    vec4 existing = texture(u_layerTex, v_uv);
    float eraseAmount = stamp * v_alpha * u_opacity;
    fragColor = vec4(existing.rgb, existing.a * (1.0 - eraseAmount));
}
