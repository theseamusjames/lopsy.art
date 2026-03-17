#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_levels;
out vec4 fragColor;
void main() {
    vec4 c = texture(u_tex, v_uv);
    float l = u_levels - 1.0;
    fragColor = vec4(floor(c.rgb * l + 0.5) / l, c.a);
}
