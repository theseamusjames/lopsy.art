struct Params {
    u_maxDisp: f32,
    u_texelSize: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;
@group(0) @binding(3) var u_disp: texture_2d<f32>;

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

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let dispPx = sampleDisp(uv * vec2<f32>(textureDimensions(u_disp, 0))) * params.u_maxDisp;
    let srcUv = uv + dispPx * params.u_texelSize;

    if (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0) {
        return vec4<f32>(0.0);
    }
    return textureSampleLevel(u_tex, u_tex_sampler, srcUv, 0.0);
}
