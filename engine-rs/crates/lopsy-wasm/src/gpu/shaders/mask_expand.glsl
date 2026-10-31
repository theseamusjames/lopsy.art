#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 fragColor;
// Expands a single-channel R8 mask into the (v, v, v, 1) layout every mask
// sampler and mask-paint pass expects.
void main() {
    fragColor = vec4(vec3(texture(u_tex, v_uv).r), 1.0);
}
