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
// Signed distance to a convex polygon with N vertices, sized so the
// polygon's vertex bounding box fits inside `halfSize`. Uses an explicit
// per-edge loop so that visual rotation (flat-top vs pointy-top) works
// correctly — the symmetry-based folding trick can't distinguish rotations
// that are multiples of π/N.
//
// After computing the inset polygon's SDF, subtracts `cr` to round
// the corners outward.
float sdPolygon(vec2 p, vec2 halfSize, int n, float cr) {
    if (min(halfSize.x, halfSize.y) < 0.5) return 1e6;

    float an = PI / float(n);
    float cosAn = cos(an);

    // Rotation: even-sided polygons get +an so flat edges face up/down.
    // Odd-sided polygons stay at the natural orientation (vertex up).
    // The rotation uses the atan(x,y) convention where angle 0 = +y.
    float rot = (n / 2 * 2 == n) ? an : 0.0;

    // Measure natural polygon extents at unit circumradius. For odd n the
    // polygon is not symmetric vertically (pointy top, flat bottom), so we
    // also need a vertical centering offset.
    float xMaxUnit = 0.0;
    float yMaxUnit = -1.0;
    float yMinUnit = 1.0;
    for (int i = 0; i < 64; i++) {
        if (i >= n) break;
        float a = rot + 2.0 * PI * float(i) / float(n);
        xMaxUnit = max(xMaxUnit, abs(sin(a)));
        yMaxUnit = max(yMaxUnit, cos(a));
        yMinUnit = min(yMinUnit, cos(a));
    }

    // Pick circumR so the polygon fits inside (2*halfSize.x, 2*halfSize.y).
    // For even n this preserves the prior apothem-fit behavior (n=4 square
    // touches all four bbox edges). For odd n it shrinks the polygon so the
    // top vertex no longer extends past the bbox top — the previous
    // apothem-only fit put the top vertex at 2× the bbox height for n=3.
    float scaleX = halfSize.x / max(xMaxUnit, 1e-6);
    float scaleY = (2.0 * halfSize.y) / max(yMaxUnit - yMinUnit, 1e-6);
    float circumR = min(scaleX, scaleY);
    float faceR = circumR * cosAn;

    float maxCr = faceR * 0.99;
    float clampedCr = min(cr, maxCr);

    // Inset the polygon by cr along the face normal.
    float insetFaceR = faceR - clampedCr;
    float insetCircumR = insetFaceR / cosAn;

    // Shift the test point so the polygon's bbox center maps to (0, 0).
    // The polygon centroid is at the origin; its bbox center sits at
    // (yMaxUnit + yMinUnit) / 2 * circumR. For even n that's zero; for odd n
    // it's positive (the pointy vertex is farther from origin than the flat
    // bottom edge).
    float yShift = (yMaxUnit + yMinUnit) * 0.5 * circumR;
    vec2 pShifted = p + vec2(0.0, yShift);

    // Compute signed distance to the inset polygon via explicit edge loop.
    float minEdgeDist = 1e6;
    // For a convex polygon with CW winding (sin/cos gives CW in screen
    // space where y points down), a point is inside if the cross product
    // `edge × toP` is ≤ 0 for ALL edges. If any cross product is > 0
    // the point is outside.
    bool isOutside = false;
    for (int i = 0; i < 64; i++) {
        if (i >= n) break;
        float a0 = rot + 2.0 * PI * float(i) / float(n);
        float a1 = rot + 2.0 * PI * float(i + 1) / float(n);
        // Vertices in atan(x,y) convention: (circumR*sin(a), circumR*cos(a))
        vec2 v0 = insetCircumR * vec2(sin(a0), cos(a0));
        vec2 v1 = insetCircumR * vec2(sin(a1), cos(a1));

        vec2 edge = v1 - v0;
        vec2 toP = pShifted - v0;
        float t = clamp(dot(toP, edge) / dot(edge, edge), 0.0, 1.0);
        vec2 closest = v0 + edge * t;
        float dist = length(pShifted - closest);
        minEdgeDist = min(minEdgeDist, dist);

        float cross = edge.x * toP.y - edge.y * toP.x;
        if (cross > 0.0) isOutside = true;
    }

    float d = isOutside ? minEdgeDist : -minEdgeDist;
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
