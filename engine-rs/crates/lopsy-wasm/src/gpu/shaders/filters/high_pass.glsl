#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_blurredTex;
uniform float u_strength;
out vec4 fragColor;
void main() {
    vec4 orig = texture(u_tex, v_uv);
    vec4 blur = texture(u_blurredTex, v_uv);
    vec3 diff = (orig.rgb - blur.rgb) * u_strength + 0.5;
    fragColor = vec4(clamp(diff, 0.0, 1.0), orig.a);
}
