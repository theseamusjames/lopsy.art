struct Params {
    u_center: vec2<f32>,
    u_radius: f32,
    u_pressure: f32,
    u_drag: vec2<f32>,
    u_mode: i32,
    u_size: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_disp: texture_2d<f32>;

const MAX_DISP: f32 = 2048.0;
const BLOAT_STRENGTH: f32 = 0.5;

// 16 bits per axis: (R, G) = high and low byte of the X code, (B, A) those
// of Y. The code is an exact integer and 32768 is an exact zero, so the
// carry between the bytes never splits one value two ways. A fractional
// code put zero displacement on the 127|255 / 128|0 carry, where backends
// that evaluate floor() and mod() with different precision tore the field
// along every zero-crossing (#1212). Must match DISP_CENTER / DISP_SCALE in
// src/tools/liquify/liquify.ts.
const DISP_CENTER: f32 = 32768.0;
const DISP_SCALE: f32 = 32767.0;

// Decoded offsets are in units of MAX_DISP.
fn fetchDisp(p: vec2<i32>) -> vec2<f32> {
    // The pool may store the bytes as RGBA16F; rounding recovers them.
    let b = floor(textureLoad(u_disp, p, 0) * 255.0 + 0.5);
    return (vec2<f32>(b.r * 256.0 + b.g, b.b * 256.0 + b.a) - DISP_CENTER) / DISP_SCALE;
}

// Bilinear between decoded texels at `pixel` (texel space, centres at
// k + 0.5). Hardware filtering would blend the high and low bytes
// separately at the texture's own precision.
fn sampleDisp(pixel: vec2<f32>) -> vec2<f32> {
    let size = vec2<i32>(textureDimensions(u_disp, 0));
    let g = clamp(pixel - 0.5, vec2<f32>(0.0), vec2<f32>(size - 1));
    let i0 = vec2<i32>(floor(g));
    let i1 = min(i0 + 1, size - 1);
    let f = g - vec2<f32>(i0);
    let d00 = fetchDisp(i0);
    let d10 = fetchDisp(vec2<i32>(i1.x, i0.y));
    let d01 = fetchDisp(vec2<i32>(i0.x, i1.y));
    let d11 = fetchDisp(i1);
    return mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y);
}

fn encodeDisp(d: vec2<f32>) -> vec4<f32> {
    let steps = d / MAX_DISP * DISP_SCALE;
    let code = clamp(
        sign(steps) * floor(abs(steps) + 0.5) + DISP_CENTER,
        vec2<f32>(DISP_CENTER - DISP_SCALE),
        vec2<f32>(DISP_CENTER + DISP_SCALE),
    );
    let hi = floor(code / 256.0);
    let lo = code - hi * 256.0;
    return vec4<f32>(hi.x, lo.x, hi.y, lo.y) / 255.0;
}

fn brushWeight(distSq: f32, radiusSq: f32) -> f32 {
    let t = 1.0 - distSq / radiusSq;
    return t * t * t;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let pixel = uv * params.u_size;
    let dx = pixel.x - params.u_center.x;
    let dy = pixel.y - params.u_center.y;
    let distSq = dx * dx + dy * dy;
    let radiusSq = params.u_radius * params.u_radius;

    let texel = vec2<i32>(floor(pixel));

    if (distSq >= radiusSq) {
        return textureLoad(u_disp, texel, 0);
    }

    let w = brushWeight(distSq, radiusSq) * params.u_pressure;
    var disp = fetchDisp(texel) * MAX_DISP;

    if (params.u_mode == 0) {
        // The warp pass resamples with srcUv = uv + disp (backward/pull
        // mapping), so a pixel that should visually move along +drag needs
        // disp = -drag: the output at p then pulls source content from
        // p - drag, i.e. from where that content used to sit before the
        // drag carried it forward to p. Storing +drag here samples from
        // p + drag instead, which pulls in whatever was ahead of the drag
        // (e.g. transparent pixels past an edge) and reads as a notch
        // opening backward instead of a bulge pushed forward.
        disp -= params.u_drag * w;
    } else if (params.u_mode == 1 || params.u_mode == 2) {
        var angle = -0.05;
        if (params.u_mode == 1) { angle = 0.05; }
        let a = angle * w;
        let cs = cos(a);
        let sn = sin(a);
        // Same composition as Bloat/Pinch: the dab maps p to its rotated
        // point q, and the existing field is resampled at q. Rotating the
        // previous offset in place only equals that when the centre never
        // moves; with a moving brush the error grew with every dab into
        // stair-step tearing across the falloff ring (#1565).
        let delta = vec2<f32>(dx * cs - dy * sn - dx, dx * sn + dy * cs - dy);
        let prev = sampleDisp(pixel + delta) * MAX_DISP;
        disp = delta + prev;
    } else if (params.u_mode == 3 || params.u_mode == 4) {
        // #945: the per-dab offset is proportional to the distance from the
        // centre (a radial scale), not a constant-length unit vector — a
        // constant magnitude doesn't vanish at the centre, so pixels nearer
        // than that magnitude sample from the opposite side and the image
        // folds. With k * pressure < 1 the radial map stays monotonic.
        // The new offset is composed with the existing field (sampled at
        // the displaced point) rather than added, so repeated dabs keep
        // magnifying smoothly instead of accumulating past the fold.
        var k = BLOAT_STRENGTH;
        if (params.u_mode == 3) { k = -BLOAT_STRENGTH; }
        let delta = vec2<f32>(dx, dy) * (k * w);
        let prev = sampleDisp(pixel + delta) * MAX_DISP;
        disp = delta + prev;
    }

    return encodeDisp(disp);
}
