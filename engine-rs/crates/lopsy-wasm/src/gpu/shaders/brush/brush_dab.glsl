#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec4 u_brushColor;
uniform float u_opacity;
uniform float u_flow;
uniform float u_hardness;
uniform vec2 u_center;
uniform float u_size;
uniform vec2 u_texSize;
uniform sampler2D u_selectionMask;
uniform int u_hasSelection;
uniform vec2 u_docSize;
uniform vec2 u_layerOffset;
out vec4 fragColor;

void main() {
    vec2 fragPos = v_uv * u_texSize;
    float radius = u_size * 0.5;
    float dist = length(fragPos - u_center);

    if (dist > radius) discard;

    // Selection mask constraint
    if (u_hasSelection == 1) {
        vec2 docPos = fragPos + u_layerOffset;
        vec2 selUV = docPos / u_docSize;
        if (selUV.x < 0.0 || selUV.x > 1.0 || selUV.y < 0.0 || selUV.y > 1.0) discard;
        float selMask = texture(u_selectionMask, selUV).r;
        if (selMask < 0.004) discard;
    }

    // Quadratic falloff matching lopsy_core::brush::generate_brush_stamp
    float t = clamp(dist / radius, 0.0, 1.0);
    float soft = 1.0 - t * t;
    float stamp = u_hardness + (1.0 - u_hardness) * soft;

    // Smooth antialiasing at circle edge (1px feather)
    float edge = 1.0 - smoothstep(radius - 1.0, radius, dist);
    stamp *= edge;

    float a = stamp * u_opacity * u_flow;

    // Modulate by selection mask for soft edges
    if (u_hasSelection == 1) {
        vec2 docPos = fragPos + u_layerOffset;
        vec2 selUV = docPos / u_docSize;
        float selMask = texture(u_selectionMask, selUV).r;
        a *= selMask;
    }

    // Premultiplied alpha output for (ONE, ONE_MINUS_SRC_ALPHA) blending
    // during dab accumulation on the stroke texture.
    fragColor = vec4(u_brushColor.rgb * a, a);
}
