struct Params {
    // 0 = ellipse, 1 = regular polygon, 2 = rectangle (fills the whole box).
    u_shapeType: i32,
    u_center: vec2<f32>,
    u_size: vec2<f32>,
    u_fillColor: vec4<f32>,
    u_strokeColor: vec4<f32>,
    u_strokeWidth: f32,
    u_cornerRadius: f32,
    u_sides: i32,
    u_texSize: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
// Copy of the layer's content before this shape (straight alpha).
@group(0) @binding(1) var u_dstTex: texture_2d<f32>;
@group(0) @binding(2) var u_dstTex_sampler: sampler;

const PI: f32 = 3.14159265359;

// True Euclidean signed distance to an ellipse (#900). The stroke is the
// band |d| < halfW, so d must be a real distance at every angle: the old
// scaled-circle estimate `(|p/r| - 1) * min(r)` was short by the aspect
// ratio on the major axis and ballooned the stroke at the tips.
//
// Finds the closest boundary point by iterating on its unit-circle
// parameter t = (cos θ, sin θ): each step approximates the boundary near
// the current point by its osculating circle (centred on the evolute point
// e) and re-projects p onto it. Three fixed iterations are within ~0.05px
// of exact even at 10:1, and it is exact for circles (e = 0).
fn sdEllipse(p: vec2<f32>, r: vec2<f32>) -> f32 {
    if (min(r.x, r.y) < 0.5) { return 1e6; }
    // The tiny floor keeps the exact centre of a circle (e = 0, no defined
    // closest point) from collapsing t to zero and reporting d = 0 there.
    let ap = max(abs(p), vec2<f32>(1e-3));
    var t = vec2<f32>(0.70710678);
    let k = r.x * r.x - r.y * r.y;
    for (var i: i32 = 0; i < 3; i++) {
        let x = r * t;
        let e = vec2<f32>(k, -k) * t * t * t / r;
        let rc = length(x - e);
        let qd = max(length(ap - e), 1e-6);
        t = clamp(((ap - e) * (rc / qd) + e) / r, vec2<f32>(0.0), vec2<f32>(1.0));
        t /= max(length(t), 1e-6);
    }
    let d = length(ap - r * t);
    if (dot(ap / r, ap / r) < 1.0) { return -d; }
    return d;
}

fn sdRect(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// Signed distance to a convex polygon with N vertices, sized so the
// polygon's vertex bounding box fits inside `halfSize`. Uses an explicit
// per-edge loop so that visual rotation (flat-top vs pointy-top) works
// correctly — the symmetry-based folding trick can't distinguish rotations
// that are multiples of π/N.
//
// After computing the inset polygon's SDF, subtracts `cr` to round
// the corners outward.
fn sdPolygon(p: vec2<f32>, halfSize: vec2<f32>, n: i32, cr: f32) -> f32 {
    if (min(halfSize.x, halfSize.y) < 0.5) { return 1e6; }

    let an = PI / f32(n);
    let cosAn = cos(an);

    // Rotation: even-sided polygons get +an so flat edges face up/down.
    // Odd-sided polygons get +PI so the top vertex points up in screen
    // coordinates (where +Y = down), matching the JS polygon orientation.
    var rot = PI;
    if (n / 2 * 2 == n) { rot = an; }

    // Measure natural polygon extents at unit circumradius. For odd n the
    // polygon is not symmetric vertically (pointy top, flat bottom), so we
    // also need a vertical centering offset.
    var xMaxUnit = 0.0;
    var yMaxUnit = -1.0;
    var yMinUnit = 1.0;
    for (var i: i32 = 0; i < 64; i++) {
        if (i >= n) { break; }
        let a = rot + 2.0 * PI * f32(i) / f32(n);
        xMaxUnit = max(xMaxUnit, abs(sin(a)));
        yMaxUnit = max(yMaxUnit, cos(a));
        yMinUnit = min(yMinUnit, cos(a));
    }

    // Pick circumR so the polygon fits inside (2*halfSize.x, 2*halfSize.y).
    // For even n this preserves the prior apothem-fit behavior (n=4 square
    // touches all four bbox edges). For odd n it shrinks the polygon so the
    // top vertex no longer extends past the bbox top — the previous
    // apothem-only fit put the top vertex at 2x the bbox height for n=3.
    let scaleX = halfSize.x / max(xMaxUnit, 1e-6);
    let scaleY = (2.0 * halfSize.y) / max(yMaxUnit - yMinUnit, 1e-6);
    let circumR = min(scaleX, scaleY);
    let faceR = circumR * cosAn;

    let maxCr = faceR * 0.99;
    let clampedCr = min(cr, maxCr);

    // Inset the polygon by cr along the face normal.
    let insetFaceR = faceR - clampedCr;
    let insetCircumR = insetFaceR / cosAn;

    // Shift the test point so the polygon's bbox center maps to (0, 0).
    // The polygon centroid is at the origin; its bbox center sits at
    // (yMaxUnit + yMinUnit) / 2 * circumR. For even n that's zero; for odd n
    // it's positive (the pointy vertex is farther from origin than the flat
    // bottom edge).
    let yShift = (yMaxUnit + yMinUnit) * 0.5 * circumR;
    let pShifted = p + vec2<f32>(0.0, yShift);

    // Compute signed distance to the inset polygon via explicit edge loop.
    var minEdgeDist = 1e6;
    // For a convex polygon with CW winding (sin/cos gives CW in screen
    // space where y points down), a point is inside if the cross product
    // `edge x toP` is <= 0 for ALL edges. If any cross product is > 0
    // the point is outside.
    var isOutside = false;
    for (var i: i32 = 0; i < 64; i++) {
        if (i >= n) { break; }
        let a0 = rot + 2.0 * PI * f32(i) / f32(n);
        let a1 = rot + 2.0 * PI * f32(i + 1) / f32(n);
        // Vertices in atan(x,y) convention: (circumR*sin(a), circumR*cos(a))
        let v0 = insetCircumR * vec2<f32>(sin(a0), cos(a0));
        let v1 = insetCircumR * vec2<f32>(sin(a1), cos(a1));

        let edge = v1 - v0;
        let toP = pShifted - v0;
        let t = clamp(dot(toP, edge) / dot(edge, edge), 0.0, 1.0);
        let closest = v0 + edge * t;
        let dist = length(pShifted - closest);
        minEdgeDist = min(minEdgeDist, dist);

        let crossZ = edge.x * toP.y - edge.y * toP.x;
        if (crossZ > 0.0) { isOutside = true; }
    }

    var d = -minEdgeDist;
    if (isOutside) { d = minEdgeDist; }
    return d - clampedCr;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let dst = textureSample(u_dstTex, u_dstTex_sampler, uv);
    let pos = uv * params.u_texSize;
    let p = pos - params.u_center;
    var d: f32;
    if (params.u_shapeType == 0) {
        d = sdEllipse(p, params.u_size * 0.5);
    } else if (params.u_shapeType == 2) {
        d = sdRect(p, params.u_size * 0.5, params.u_cornerRadius);
    } else {
        d = sdPolygon(p, params.u_size * 0.5, max(params.u_sides, 3), params.u_cornerRadius);
    }
    let fill = 1.0 - smoothstep(-0.5, 0.5, d);
    let halfW = params.u_strokeWidth * 0.5;
    let stroke = 1.0 - smoothstep(halfW - 0.5, halfW + 0.5, abs(d));

    // Coverage-weighted colours are premultiplied; the layer texture is
    // straight alpha, so the "over" is resolved here and un-premultiplied
    // before writing. Writing the premultiplied edge directly is what
    // produced the dark anti-aliasing fringe of #815.
    var src = vec4<f32>(params.u_fillColor.rgb * params.u_fillColor.a, params.u_fillColor.a) * fill;
    if (params.u_strokeWidth > 0.0) {
        let strokeP = vec4<f32>(params.u_strokeColor.rgb * params.u_strokeColor.a, params.u_strokeColor.a) * stroke;
        src = strokeP + src * (1.0 - strokeP.a);
    }

    let outA = src.a + dst.a * (1.0 - src.a);
    if (outA < 1e-6) {
        return vec4<f32>(0.0);
    }
    let outRGB = (src.rgb + dst.rgb * dst.a * (1.0 - src.a)) / outA;
    return vec4<f32>(outRGB, outA);
}
