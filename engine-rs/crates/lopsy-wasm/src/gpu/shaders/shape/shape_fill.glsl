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
    if (min(r.x, r.y) < 0.5) return 1e6;
    vec2 q = abs(p) / r;
    return (length(q) - 1.0) * min(r.x, r.y);
}
float sdRect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float sdPolygon(vec2 p, vec2 halfSize, int n, float cr) {
    if (min(halfSize.x, halfSize.y) < 0.5) return 1e6;

    float scale = min(halfSize.x, halfSize.y);
    float an = PI / float(n);
    float cosAn = cos(an);
    float maxCr = scale * cosAn * 0.99;
    float clampedCr = min(cr, maxCr);

    // Inset the polygon by cr so rounding stays within the original bounds.
    // The inscribed radius is cosAn * scale; shrinking it by cr means
    // reducing scale by cr / cosAn, then the Minkowski offset (-cr)
    // grows edges back to their original position while rounding corners.
    float insetScale = scale - clampedCr / cosAn;
    vec2 insetHalfSize = halfSize * (insetScale / scale);

    vec2 q = p / insetHalfSize;
    // Rotate so even-sided polygons have flat top edges,
    // odd-sided polygons have vertex pointing up
    float rotOffset = (n / 2 * 2 == n) ? an : 0.0;
    float a = atan(q.x, q.y) + rotOffset;
    a = mod(a + PI, 2.0 * an) - an;
    float r = length(q);
    float d = (r * cos(a) - cosAn) * insetScale;
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
