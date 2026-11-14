// Bilinear sample of a straight-alpha texture, interpolated in
// premultiplied space and un-premultiplied on return. Hardware LINEAR
// filtering of straight alpha averages the RGB of transparent (black)
// texels into anti-aliased edges and leaves a dark fringe (#815).
// Uses textureLoad, so the texture's own filter mode is irrelevant.
fn fetchPremul(tex: texture_2d<f32>, p: vec2<i32>, maxP: vec2<i32>) -> vec4<f32> {
    let c = textureLoad(tex, clamp(p, vec2<i32>(0), maxP), 0);
    return vec4<f32>(c.rgb * c.a, c.a);
}

fn samplePremulBilinear(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
    let size = vec2<i32>(textureDimensions(tex, 0));
    let maxP = size - 1;
    let p = uv * vec2<f32>(size) - 0.5;
    let f = fract(p);
    let i0 = vec2<i32>(floor(p));
    let c00 = fetchPremul(tex, i0, maxP);
    let c10 = fetchPremul(tex, i0 + vec2<i32>(1, 0), maxP);
    let c01 = fetchPremul(tex, i0 + vec2<i32>(0, 1), maxP);
    let c11 = fetchPremul(tex, i0 + vec2<i32>(1, 1), maxP);
    let m = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
    if (m.a < 1e-6) { return vec4<f32>(0.0); }
    return vec4<f32>(m.rgb / m.a, m.a);
}
