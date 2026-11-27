struct Params {
    u_dstSize: vec2<f32>,
    // -1 = colour, averaged in premultiplied space. 0..3 = that channel's
    // straight value averaged, as grey.
    u_channel: i32,
    // A source that is one rectangle of a larger picture (lopsy_core::tile):
    // (x, y, whole width, whole height), or all zeros for none. With one, the
    // output is the whole picture's box downscale to u_dstSize, at the
    // output texels the pass draws: footprints on the whole's grid, each
    // source texel fetched from the tile at its place in the whole.
    u_region: vec4<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;

const MAX_TAPS: i32 = 64;

fn premultiplied(c: vec4<f32>) -> vec4<f32> {
    return vec4<f32>(c.rgb * c.a, c.a);
}

// One output pixel is the box average of its whole source footprint. A
// single LINEAR tap only sees the 2x2 texels at the footprint's centre, so a
// pattern finer than the footprint aliases (a grid shows only its lines).
// Each tap here is a 2x2 bilinear read at a texel corner and the taps step
// 2 texels apart, so up to MAX_TAPS * 2 texels per axis every texel counts
// once; larger footprints are evenly subsampled. textureLoad keeps the
// result independent of the texture's own filter mode.
@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<i32>(textureDimensions(u_tex, 0));
    // The texels the footprints are of, and the fetch from the texture:
    // with a region the whole picture's, moved to the tile and kept in it.
    var sourceSize = vec2<f32>(size);
    var maxP = size - 1;
    var origin = vec2<i32>(0);
    if (params.u_region.z > 0.0) {
        sourceSize = params.u_region.zw;
        maxP = vec2<i32>(params.u_region.zw) - 1;
        origin = vec2<i32>(params.u_region.xy);
    }
    let tileMax = size - 1;
    let footprint = sourceSize / params.u_dstSize;
    let lo = floor(position.xy) * footprint;
    let n = clamp(vec2<i32>(ceil(footprint * 0.5)), vec2<i32>(1), vec2<i32>(MAX_TAPS));
    let stepPx = footprint / vec2<f32>(n);

    var premul = vec4<f32>(0.0);
    var straight = vec4<f32>(0.0);
    for (var j: i32 = 0; j < MAX_TAPS; j++) {
        if (j >= n.y) { break; }
        for (var i: i32 = 0; i < MAX_TAPS; i++) {
            if (i >= n.x) { break; }
            let q = lo + (vec2<f32>(f32(i), f32(j)) + 0.5) * stepPx - 0.5;
            let qf = floor(q);
            let p0 = vec2<i32>(qf);
            let f = q - qf;
            let c00 = textureLoad(u_tex, clamp(clamp(p0, vec2<i32>(0), maxP) - origin, vec2<i32>(0), tileMax), 0);
            let c10 = textureLoad(u_tex, clamp(clamp(p0 + vec2<i32>(1, 0), vec2<i32>(0), maxP) - origin, vec2<i32>(0), tileMax), 0);
            let c01 = textureLoad(u_tex, clamp(clamp(p0 + vec2<i32>(0, 1), vec2<i32>(0), maxP) - origin, vec2<i32>(0), tileMax), 0);
            let c11 = textureLoad(u_tex, clamp(clamp(p0 + vec2<i32>(1, 1), vec2<i32>(0), maxP) - origin, vec2<i32>(0), tileMax), 0);
            straight += mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
            premul += mix(
                mix(premultiplied(c00), premultiplied(c10), f.x),
                mix(premultiplied(c01), premultiplied(c11), f.x),
                f.y,
            );
        }
    }
    let count = f32(n.x * n.y);

    if (params.u_channel >= 0) {
        let avg = straight / count;
        var v = avg.a;
        if (params.u_channel == 0) {
            v = avg.r;
        } else if (params.u_channel == 1) {
            v = avg.g;
        } else if (params.u_channel == 2) {
            v = avg.b;
        }
        return vec4<f32>(v, v, v, 1.0);
    }
    if (premul.a < 1e-6) {
        return vec4<f32>(0.0);
    }
    return vec4<f32>(premul.rgb / premul.a, premul.a / count);
}
