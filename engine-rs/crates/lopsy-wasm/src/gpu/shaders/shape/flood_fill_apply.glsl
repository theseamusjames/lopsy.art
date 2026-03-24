#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_layerTex;
uniform sampler2D u_maskTex;
uniform vec4 u_fillColor;
out vec4 fragColor;
void main() {
    vec4 existing = texture(u_layerTex, v_uv);
    float mask = texture(u_maskTex, v_uv).r;
    vec4 fill = vec4(u_fillColor.rgb, u_fillColor.a * mask);
    float outA = fill.a + existing.a * (1.0 - fill.a);
    vec3 outRGB = (fill.rgb * fill.a + existing.rgb * existing.a * (1.0 - fill.a)) / max(outA, 0.001);
    fragColor = vec4(outRGB, outA);
}
