#version 300 es
precision highp float;

in vec2 v_uv;

// R8 glyph atlas — single-channel coverage.
uniform sampler2D u_atlas;
layout(std140) uniform Params {
    // Premultiplied RGBA text color.
    vec4 u_color;
    // Layer texture dimensions in pixels.
    vec2 u_texSize;
    // Glyph top-left position in layer pixels.
    vec2 u_glyphPos;
    // Glyph size in layer pixels.
    vec2 u_glyphSize;
    // Atlas UV rect (u0, v0, u1, v1).
    vec4 u_glyphUv;
};

out vec4 fragColor;

void main() {
    vec2 px = v_uv * u_texSize;
    vec2 local = (px - u_glyphPos) / u_glyphSize;
    if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) {
        discard;
    }
    vec2 atlasUV = mix(u_glyphUv.xy, u_glyphUv.zw, local);
    float coverage = texture(u_atlas, atlasUV).r;
    float a = coverage * u_color.a;
    // Premultiplied alpha output.
    fragColor = vec4(u_color.rgb * a, a);
}
