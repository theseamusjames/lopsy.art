struct Params {
    // Map output UV [0,1] to source UV via: srcUV = uv * u_scale + u_offset
    u_scale: vec2<f32>,
    u_offset: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;

// Bilinear in premultiplied space like `blit_resample`, but texels outside
// the source are transparent rather than clamped: the destination can cover
// a sub-pixel margin around the source (Image Size snaps each layer's box
// outward to whole pixels), and clamping would smear the edge into it.
fn fetchPremulOrClear(p: vec2<i32>, size: vec2<i32>) -> vec4<f32> {
    if (p.x < 0 || p.y < 0 || p.x >= size.x || p.y >= size.y) {
        return vec4<f32>(0.0);
    }
    let c = textureLoad(u_tex, p, 0);
    return vec4<f32>(c.rgb * c.a, c.a);
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let size = vec2<i32>(textureDimensions(u_tex, 0));
    let srcUV = uv * params.u_scale + params.u_offset;
    let p = srcUV * vec2<f32>(size) - 0.5;
    let f = fract(p);
    let i0 = vec2<i32>(floor(p));
    let c00 = fetchPremulOrClear(i0, size);
    let c10 = fetchPremulOrClear(i0 + vec2<i32>(1, 0), size);
    let c01 = fetchPremulOrClear(i0 + vec2<i32>(0, 1), size);
    let c11 = fetchPremulOrClear(i0 + vec2<i32>(1, 1), size);
    let m = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
    if (m.a < 1e-6) { return vec4<f32>(0.0); }
    return vec4<f32>(m.rgb / m.a, m.a);
}
