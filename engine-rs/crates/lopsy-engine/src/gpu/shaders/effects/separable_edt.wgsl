// Wide Stroke band as an exact Euclidean distance test, in two separable
// passes (CPU statement and tests: lopsy-core/src/stroke_band.rs).
// Pass 0 (rows): seeds are texels with alpha >= 0.5; writes the distance to
// the nearest seed in the texel's row, split over R (high byte) and G (low
// byte) so it survives an RGBA8 target exactly.
// Pass 1 (columns): reads those row distances and writes alpha 1 where
// dy^2 + row(dy)^2 <= u_reachSq for some dy — a disc, not a square, so the
// band is the same width on diagonal and curved edges as on straight ones.
struct Params {
    // 0 = rows, 1 = columns
    u_pass: i32,
    // ceil(reach): texels searched on each side
    u_radius: i32,
    // reach^2, the band's squared half-width
    u_reachSq: f32,
    // 1 = texels beyond the buffer edge are seeds
    u_oobSeed: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;

const NO_SEED: f32 = 65535.0;

fn encodeDistance(d: f32) -> vec4<f32> {
    let high = floor(d / 256.0);
    return vec4<f32>(high / 255.0, (d - 256.0 * high) / 255.0, 0.0, 1.0);
}

fn decodeDistance(t: vec4<f32>) -> f32 {
    let b = floor(t.rg * 255.0 + 0.5);
    return b.x * 256.0 + b.y;
}

fn isSeed(p: vec2<i32>, size: vec2<i32>) -> bool {
    if (p.x < 0 || p.y < 0 || p.x >= size.x || p.y >= size.y) { return params.u_oobSeed == 1; }
    return textureLoad(u_tex, p, 0).a >= 0.5;
}

fn rowDistance(p: vec2<i32>, size: vec2<i32>) -> f32 {
    if (p.y < 0 || p.y >= size.y) {
        if (params.u_oobSeed == 1) { return 0.0; }
        return NO_SEED;
    }
    return decodeDistance(textureLoad(u_tex, p, 0));
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let size = vec2<i32>(textureDimensions(u_tex, 0));
    let p = vec2<i32>(floor(uv * vec2<f32>(size)));

    if (params.u_pass == 0) {
        var d = NO_SEED;
        for (var i: i32 = 0; i <= 8192; i++) {
            if (i > params.u_radius) { break; }
            if (isSeed(p + vec2<i32>(i, 0), size) || isSeed(p - vec2<i32>(i, 0), size)) {
                d = f32(i);
                break;
            }
        }
        return encodeDistance(d);
    }

    let radius = f32(params.u_radius);
    var best = NO_SEED * NO_SEED;
    for (var i: i32 = 0; i <= 8192; i++) {
        if (i > params.u_radius) { break; }
        let dySq = f32(i * i);
        // Rows further away can only be further: stop once past the best.
        if (dySq >= best) { break; }
        let h = min(rowDistance(p + vec2<i32>(0, i), size), rowDistance(p - vec2<i32>(0, i), size));
        if (h <= radius) { best = min(best, dySq + h * h); }
    }
    return vec4<f32>(0.0, 0.0, 0.0, select(0.0, 1.0, best <= params.u_reachSq));
}
