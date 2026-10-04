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
    // Add the glow as premultiplied light and let its coverage extend the
    // layer's alpha, so the halo shows on transparent pixels (#1027).
    // Opaque pixels reduce to original.rgb + glow, as before.
    vec3 glow = bloom.rgb * bloom.a * u_intensity;
    float glowAlpha = clamp(bloom.a * u_intensity, 0.0, 1.0);
    float a = original.a + glowAlpha * (1.0 - original.a);
    vec3 premul = original.rgb * original.a + glow;
    // Where the added light exceeds the coverage (soft edges), straight
    // colour would go above 1.0: live/export show an over-white rim that
    // the 8-bit project encode then clamps away (#1181). Grow coverage to
    // hold that light instead, then cap at 1.0 so every path agrees.
    a = min(max(a, max(premul.r, max(premul.g, premul.b))), 1.0);
    premul = min(premul, vec3(a));
    fragColor = a > 0.0 ? vec4(premul / a, a) : vec4(0.0);
}
