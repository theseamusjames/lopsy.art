#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_srcTex;
uniform vec4 u_overlayColor;
uniform float u_opacity;
out vec4 fragColor;
void main() {
    vec4 src = texture(u_srcTex, v_uv);
    fragColor = vec4(mix(src.rgb, u_overlayColor.rgb, u_opacity), src.a);
}
