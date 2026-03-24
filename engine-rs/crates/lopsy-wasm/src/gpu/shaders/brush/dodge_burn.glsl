#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_layerTex;
uniform sampler2D u_stampTex;
uniform int u_mode;
uniform float u_exposure;
out vec4 fragColor;
void main() {
    vec4 c = texture(u_layerTex, v_uv);
    float stamp = texture(u_stampTex, v_uv).r;
    float strength = stamp * u_exposure;
    if (u_mode == 0) c.rgb += (1.0 - c.rgb) * strength;
    else c.rgb *= (1.0 - strength);
    fragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
}
