struct Params {
    u_gridSize: vec2<f32>,
    // Bounds in texture UV coordinates (0..1). Pixels outside the bounds
    // pass through unchanged. When bounds = (0,0,1,1) the warp covers the
    // whole image.
    u_boundsMin: vec2<f32>,
    u_boundsMax: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;
@group(0) @binding(3) var u_grid: texture_2d<f32>;

// Each grid texel holds one point's offset from its identity position in
// bounds-local units, 16 bits per axis: (R, G) = high and low byte of X,
// (B, A) = high and low byte of Y. Must match DISPLACEMENT_CENTER /
// DISPLACEMENT_SCALE in src/filters/mesh-warp.ts; 32768 is an exact zero.
// A single byte per axis moved content in steps of 1/127 of the bounds
// (#1160).
const DISP_CENTER: f32 = 32768.0;
const DISP_SCALE: f32 = 32767.0;

// Newton steps on the piecewise-bilinear forward map, each backed off until
// it lowers the residual. Converges for any non-folding mesh, however hard
// a cell is squashed or stretched; the damped fixed-point iteration this
// replaces crawled under strong compression and broke thin lines into
// dashes.
const INVERSE_ITERATIONS: i32 = 12;
const MAX_BACKTRACKS: i32 = 4;

struct Displacement {
    value: vec2<f32>,
    jacobian: mat2x2<f32>,
}

fn gridPoint(p: vec2<i32>) -> vec2<f32> {
    // The pool may store the bytes as RGBA16F; rounding recovers them.
    let b = floor(textureLoad(u_grid, p, 0) * 255.0 + 0.5);
    return (vec2<f32>(b.r * 256.0 + b.g, b.b * 256.0 + b.a) - DISP_CENTER) / DISP_SCALE;
}

// Forward displacement at `uv` in texture UV, bilinear between grid
// points, and its Jacobian. Outside the bounds the displacement holds its
// edge value, so the derivative across that axis is zero.
fn displacementAt(uv: vec2<f32>, boundsSize: vec2<f32>) -> Displacement {
    let localUv = (uv - params.u_boundsMin) / boundsSize;
    let cells = params.u_gridSize - 1.0;
    let g = clamp(localUv, vec2<f32>(0.0), vec2<f32>(1.0)) * cells;
    let i0 = vec2<i32>(clamp(floor(g), vec2<f32>(0.0), cells - 1.0));
    let f = g - vec2<f32>(i0);

    let d00 = gridPoint(i0);
    let d10 = gridPoint(i0 + vec2<i32>(1, 0));
    let d01 = gridPoint(i0 + vec2<i32>(0, 1));
    let d11 = gridPoint(i0 + vec2<i32>(1, 1));

    let inside = step(vec2<f32>(0.0), localUv) * step(localUv, vec2<f32>(1.0));
    let dX = mix(d10 - d00, d11 - d01, f.y) * boundsSize * (cells.x / boundsSize.x) * inside.x;
    let dY = mix(d01 - d00, d11 - d10, f.x) * boundsSize * (cells.y / boundsSize.y) * inside.y;
    let value = mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y) * boundsSize;
    return Displacement(value, mat2x2<f32>(dX, dY));
}

fn residualAt(srcUv: vec2<f32>, boundsSize: vec2<f32>, uv: vec2<f32>) -> vec2<f32> {
    return srcUv + displacementAt(srcUv, boundsSize).value - uv;
}

// WGSL has no inverse(); this is the adjugate over the determinant.
fn inverse2(m: mat2x2<f32>, det: f32) -> mat2x2<f32> {
    return mat2x2<f32>(m[1][1] / det, -m[0][1] / det, -m[1][0] / det, m[0][0] / det);
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let boundsSize = params.u_boundsMax - params.u_boundsMin;
    let unwarped = textureSample(u_tex, u_tex_sampler, uv);

    // Pixels outside the bounds rect pass through with no warp.
    if (uv.x < params.u_boundsMin.x || uv.x > params.u_boundsMax.x
     || uv.y < params.u_boundsMin.y || uv.y > params.u_boundsMax.y
     || boundsSize.x <= 0.0 || boundsSize.y <= 0.0) {
        return unwarped;
    }

    // The grid stores a forward map: content at identity position p moves
    // to p + D(p), so dragged content follows its handle. Rendering needs
    // the inverse — find src with src + D(src) = uv.
    var srcUv = uv;
    for (var i: i32 = 0; i < INVERSE_ITERATIONS; i++) {
        let displacement = displacementAt(srcUv, boundsSize);
        let residual = srcUv + displacement.value - uv;
        let err2 = dot(residual, residual);
        if (err2 < 1e-14) { break; }
        let forward = mat2x2<f32>(1.0, 0.0, 0.0, 1.0) + displacement.jacobian;
        let det = determinant(forward);
        // A folded or degenerate cell has no usable Jacobian: fall back to
        // a damped fixed-point step.
        var stepUv = residual * 0.5;
        if (det > 1e-6) { stepUv = inverse2(forward, det) * residual; }
        var t = 1.0;
        for (var k: i32 = 0; k < MAX_BACKTRACKS; k++) {
            let r = residualAt(srcUv - stepUv * t, boundsSize, uv);
            if (dot(r, r) < err2) { break; }
            t *= 0.5;
        }
        srcUv -= stepUv * t;
    }

    if (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0) {
        return vec4<f32>(0.0);
    }
    return textureSampleLevel(u_tex, u_tex_sampler, srcUv, 0.0);
}
