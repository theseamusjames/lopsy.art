#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_sourceTex;
uniform sampler2D u_stampTex;
uniform vec2 u_sourceOffset;
out vec4 fragColor;
void main() {
    float stamp = texture(u_stampTex, v_uv).r;
    vec4 source = texture(u_sourceTex, v_uv + u_sourceOffset);
    fragColor = vec4(source.rgb, source.a * stamp);
}
