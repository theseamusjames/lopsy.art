#version 300 es
precision highp float;

// #667 — Non-contiguous ("fill by color") bucket fill implemented entirely on
// the GPU. Compares each texel against a reference color and mixes the fill
// color over the layer wherever `|texel - reference| < tolerance`. Optionally
// masked by a selection texture.

in vec2 v_uv;

uniform sampler2D u_layerTex;
uniform sampler2D u_selMaskTex;   // 0 = outside selection, 1 = inside
uniform int u_hasSelMask;         // 1 if u_selMaskTex is valid, else 0

// v_uv coord of the sample point (already resolved on JS side to layer-local UV).
uniform vec2 u_sampleUv;

uniform vec4 u_fillColor;         // final color (straight alpha)
uniform float u_tolerance;        // 0..1 (normalized 0..255 / 255)

out vec4 fragColor;

// Match distance mirrors lopsy_core::flood_fill: max channel delta over rgba.
float channelDelta(vec4 a, vec4 b) {
    vec4 d = abs(a - b);
    return max(max(d.r, d.g), max(d.b, d.a));
}

void main() {
    vec4 existing = texture(u_layerTex, v_uv);
    vec4 reference = texture(u_layerTex, u_sampleUv);

    float delta = channelDelta(existing, reference);
    float hit = delta <= u_tolerance ? 1.0 : 0.0;

    // Constrain to the selection mask when one is provided.
    if (u_hasSelMask == 1) {
        float sel = texture(u_selMaskTex, v_uv).r;
        hit *= sel;
    }

    // "Over" compositing with the fill color scaled by the hit mask.
    vec4 fill = vec4(u_fillColor.rgb, u_fillColor.a * hit);
    float outA = fill.a + existing.a * (1.0 - fill.a);
    vec3 outRGB = (fill.rgb * fill.a + existing.rgb * existing.a * (1.0 - fill.a)) / max(outA, 0.001);
    fragColor = vec4(outRGB, outA);
}
