#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_bloomTex;
uniform float u_intensity;
out vec4 fragColor;
void main() {
    vec4 original = texture(u_tex, v_uv);
    vec4 bloom = texture(u_bloomTex, v_uv);
    fragColor = vec4(original.rgb + bloom.rgb * u_intensity, original.a);
}
