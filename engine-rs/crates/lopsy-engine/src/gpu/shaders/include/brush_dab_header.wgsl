// Shared by the three brush dab shaders: the uniforms, the per-dab jitter
// hash and the stamp helpers. Each shader adds its own `computeDab` and
// ends with `//#include brush_dab_footer`.
struct Params {
    u_brushColor: vec4<f32>,
    u_opacity: f32,
    u_flow: f32,
    u_hardness: f32,
    u_center: vec2<f32>,
    u_size: f32,
    u_texSize: vec2<f32>,
    u_hasSelection: i32,
    u_docSize: vec2<f32>,
    u_layerOffset: vec2<f32>,
    u_angle: f32,
    u_dabTransform: mat2x2<f32>,
    u_tipAspect: vec2<f32>,
    u_sizeJitter: f32,
    u_angleJitter: f32,
    u_opacityJitter: f32,
    u_hasBrushTexture: i32,
    u_textureScale: f32,
    u_textureBlendMode: i32,
    u_brushTextureSize: vec2<f32>,
    u_strokeOrigin: vec2<f32>,
    u_textureRotation: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_selectionMask: texture_2d<f32>;
@group(0) @binding(2) var u_selectionMask_sampler: sampler;
@group(0) @binding(3) var u_brushTip: texture_2d<f32>;
@group(0) @binding(4) var u_brushTip_sampler: sampler;
@group(0) @binding(5) var u_brushTexture: texture_2d<f32>;
@group(0) @binding(6) var u_brushTexture_sampler: sampler;

fn dabHash(center: vec2<f32>, seed: f32) -> f32 {
    return fract(sin(dot(center + seed, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

// Compute rotated + aspect-corrected UV for tip-based brushes.
// Returns UV in [0,1] range. Caller must discard if out of bounds.
fn computeTipUV(fragPos: vec2<f32>, center: vec2<f32>, jSize: f32, jAngle: f32) -> vec2<f32> {
    var tipUV = (params.u_dabTransform * (fragPos - center)) / jSize;
    let ca = cos(jAngle);
    let sa = sin(jAngle);
    tipUV = mat2x2<f32>(ca, sa, -sa, ca) * tipUV;
    tipUV /= params.u_tipAspect;
    return tipUV + 0.5;
}

fn tipUVOutOfBounds(tipUV: vec2<f32>) -> bool {
    return tipUV.x < 0.0 || tipUV.x > 1.0 || tipUV.y < 0.0 || tipUV.y > 1.0;
}

// The tip is read after the dab's bounds test, so it names its level.
fn sampleTipWithHardness(tipUV: vec2<f32>) -> f32 {
    let tip = textureSampleLevel(u_brushTip, u_brushTip_sampler, tipUV, 0.0);
    let sharp = tip.r;
    let glow = tip.g;
    let softness = (1.0 - params.u_hardness) * 1.5;
    return sharp * max(1.0 - glow * softness, 0.0);
}

// ~= sqrt(2) / 2, plus a hair of margin
const NEAREST_PIXEL_OFFSET: f32 = 0.71;

// Distance-based stamp for procedural circles.
// Returns opacity multiplier including hardness falloff and edge AA.
//
// The AA rim below intentionally narrows for small dabs. A dab centre
// rarely lands exactly on a pixel centre — even packed as densely as the
// spacing floor allows along a stroke, the nearest a pixel centre can be
// to *some* dab is still up to sqrt(2)/2 px away (half the pixel
// diagonal). A fixed 1px rim (radius-1..radius) is a thin sliver next to
// a large radius, but once radius drops under ~1.7px that rim swallows
// the dab's entire footprint — at radius <= ~0.7px it discarded every
// pixel outright, and up to ~1.7px it left every achievable pixel
// partially transparent even at Hardness 100 (#849: 1-2px brushes
// painted almost nothing). `coverageRadius` floors the radius so the
// worst-case pixel offset always falls inside the flat, fully-covered
// zone, and `rim` shrinks from the usual 1px only by as much as that
// floor requires. For radius above ~1.7px this is identical to the
// original `1.0 - smoothstep(radius - 1.0, radius, dist)`.
fn circleStamp(fragPos: vec2<f32>, center: vec2<f32>, radius: f32) -> f32 {
    let dist = length(fragPos - center);

    let coverageRadius = max(radius, NEAREST_PIXEL_OFFSET + 0.1);
    let rim = clamp(coverageRadius - NEAREST_PIXEL_OFFSET, 0.05, 1.0);

    // signal to discard
    if (dist > coverageRadius) { return -1.0; }
    let t = clamp(dist / coverageRadius, 0.0, 1.0);
    var stamp = 1.0;
    if (t > params.u_hardness) {
        let softT = (t - params.u_hardness) / max(1.0 - params.u_hardness, 0.001);
        stamp = 1.0 - smoothstep(0.0, 1.0, softT);
    }
    let edge = 1.0 - smoothstep(coverageRadius - rim, coverageRadius, dist);
    return stamp * edge;
}
