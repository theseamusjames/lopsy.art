#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 fragColor;
// A layer mask is grey with alpha 1 and the compositor reads only .r, so a
// filter run on a mask is folded back to Rec. 709 luminance; transparent
// output counts as black (hidden).
void main() {
    vec4 c = texture(u_tex, v_uv);
    float v = clamp(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)) * c.a, 0.0, 1.0);
    fragColor = vec4(v, v, v, 1.0);
}
