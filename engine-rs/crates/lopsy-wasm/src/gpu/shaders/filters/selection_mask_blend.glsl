#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_filtered;
uniform sampler2D u_original;
uniform sampler2D u_selMask;
out vec4 fragColor;
void main() {
    vec4 filtered = texture(u_filtered, v_uv);
    vec4 original = texture(u_original, v_uv);
    float mask = texture(u_selMask, v_uv).r;
    fragColor = mix(original, filtered, mask);
}
