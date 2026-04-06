#version 300 es
precision highp float;
in vec2 v_uv;
uniform int u_shapeType;
uniform vec2 u_center;
uniform vec2 u_size;
uniform vec4 u_fillColor;
uniform vec4 u_strokeColor;
uniform float u_strokeWidth;
uniform float u_cornerRadius;
uniform int u_sides;
uniform vec2 u_texSize;
out vec4 fragColor;

const float PI = 3.14159265359;

float sdEllipse(vec2 p, vec2 r) {
    vec2 q = abs(p) / r;
    return (length(q) - 1.0) * min(r.x, r.y);
}
float sdRect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float sdPolygon(vec2 p, vec2 halfSize, int n, float cr) {
    // Scale to unit circle space, compute polygon SDF, scale back
    float scale = min(halfSize.x, halfSize.y);
    vec2 q = p / halfSize;
    float an = PI / float(n);
    // Rotate so even-sided polygons have flat top edges,
    // odd-sided polygons have vertex pointing up
    float rotOffset = (n / 2 * 2 == n) ? an : 0.0;
    float a = atan(q.x, q.y) + rotOffset;
    a = mod(a + PI, 2.0 * an) - an;
    float r = length(q);
    float d = (r * cos(a) - cos(an)) * scale;
    // Apply corner rounding
    float maxR = scale * cos(an);
    float clampedCr = min(cr, maxR * 0.99);
    return d - clampedCr;
}
void main() {
    vec2 pos = v_uv * u_texSize;
    vec2 p = pos - u_center;
    float d;
    if (u_shapeType == 0) {
        d = sdEllipse(p, u_size * 0.5);
    } else if (u_sides >= 3) {
        d = sdPolygon(p, u_size * 0.5, u_sides, u_cornerRadius);
    } else {
        d = sdRect(p, u_size * 0.5, u_cornerRadius);
    }
    float fill = 1.0 - smoothstep(-0.5, 0.5, d);
    float stroke = 1.0 - smoothstep(u_strokeWidth - 0.5, u_strokeWidth + 0.5, abs(d));
    vec4 color = u_fillColor * fill;
    if (u_strokeWidth > 0.0) color = mix(color, u_strokeColor, stroke * u_strokeColor.a);
    fragColor = color;
}
