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
out vec4 fragColor;

void main() {
    vec2 fragPos = v_uv * u_texSize;
    float radius = u_size * 0.5;
    float dist = length(fragPos - u_center);

    if (dist > radius) discard;

    // Quadratic falloff matching lopsy_core::brush::generate_brush_stamp
    float t = clamp(dist / radius, 0.0, 1.0);
    float soft = 1.0 - t * t;
    float stamp = u_hardness + (1.0 - u_hardness) * soft;

    // Smooth antialiasing at circle edge (1px feather)
    float edge = 1.0 - smoothstep(radius - 1.0, radius, dist);
    stamp *= edge;

    float a = stamp * u_opacity * u_flow;
    // Premultiplied alpha output for (ONE, ONE_MINUS_SRC_ALPHA) blending
    fragColor = vec4(u_brushColor.rgb * a, u_brushColor.a * a);
}
