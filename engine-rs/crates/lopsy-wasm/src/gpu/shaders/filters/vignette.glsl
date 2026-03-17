#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_amount;
out vec4 fragColor;
void main() {
    vec4 c = texture(u_tex, v_uv);
    float dist = length(v_uv - 0.5) * 1.414;
    float vig = 1.0 - smoothstep(0.5, 1.2, dist) * u_amount * 0.01;
    fragColor = vec4(c.rgb * vig, c.a);
}
