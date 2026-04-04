#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_maxOpacity;
out vec4 fragColor;

void main() {
    vec4 c = texture(u_tex, v_uv);
    // Clamp alpha to the brush opacity ceiling.
    // Scale RGB proportionally to maintain premultiplied alpha.
    if (c.a > u_maxOpacity && c.a > 0.001) {
        float scale = u_maxOpacity / c.a;
        fragColor = vec4(c.rgb * scale, u_maxOpacity);
    } else {
        fragColor = c;
    }
}
