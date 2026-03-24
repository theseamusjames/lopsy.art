#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_compositeTex;
uniform sampler2D u_selectionMask;
uniform float u_time;
uniform vec2 u_texSize;
out vec4 fragColor;
void main() {
    vec4 color = texture(u_compositeTex, v_uv);
    float mask = texture(u_selectionMask, v_uv).r;
    vec2 texel = 1.0 / u_texSize;
    float l = texture(u_selectionMask, v_uv + vec2(-texel.x, 0.0)).r;
    float r = texture(u_selectionMask, v_uv + vec2(texel.x, 0.0)).r;
    float t = texture(u_selectionMask, v_uv + vec2(0.0, -texel.y)).r;
    float b = texture(u_selectionMask, v_uv + vec2(0.0, texel.y)).r;
    float edge = abs(mask - l) + abs(mask - r) + abs(mask - t) + abs(mask - b);
    if (edge > 0.1) {
        vec2 pos = v_uv * u_texSize;
        float dash = sin((pos.x + pos.y) * 0.5 + u_time * 4.0);
        color.rgb = mix(color.rgb, vec3(step(0.0, dash)), 0.8);
    }
    fragColor = color;
}
