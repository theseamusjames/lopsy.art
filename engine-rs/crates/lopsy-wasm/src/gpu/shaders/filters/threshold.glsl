#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_level;
out vec4 fragColor;
void main() {
    vec4 c = texture(u_tex, v_uv);
    float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    float v = step(u_level, lum);
    fragColor = vec4(vec3(v), c.a);
}
