struct Params {
    u_cellCount: f32,
    u_edgeWidth: f32,
    u_edgeR: f32,
    u_edgeG: f32,
    u_edgeB: f32,
    u_seed: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

// Seed jitter from an integer hash (PCG2D, Jarzynski & Olano 2020) of the
// integer cell index (#1271). Integer arithmetic is exact on every backend,
// so a cell's seed is bit-identical in every evaluation. The old
// `fract(sin(q) * 43758.5453)` hash amplified a one-ulp difference in `q`
// (from FMA contraction or Metal's fast-math sin) into an unrelated value,
// so the two passes below disagreed about where a seed was.
fn pcg2d(value: vec2<u32>) -> vec2<u32> {
    var v = value * 1664525u + 1013904223u;
    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;
    v ^= v >> vec2<u32>(16u);
    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;
    v ^= v >> vec2<u32>(16u);
    return v;
}

// Jitter in [0, 1): the top 24 bits convert to float exactly.
fn cellJitter(cell: vec2<i32>, seed: u32) -> vec2<f32> {
    let h = pcg2d(vec2<u32>(cell) + seed * vec2<u32>(0x9E3779B9u, 0x85EBCA6Bu));
    return vec2<f32>(h >> vec2<u32>(8u)) * (1.0 / 16777216.0);
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let texSize = vec2<f32>(textureDimensions(u_tex, 0));
    let aspect = texSize.x / texSize.y;

    let scaledUV = vec2<f32>(uv.x * aspect, uv.y) * params.u_cellCount;
    let cellBase = floor(scaledUV);
    let cellIdx = vec2<i32>(cellBase);
    let cellFrac = scaledUV - cellBase;
    let seed = u32(params.u_seed + 0.5);

    // Pass 1: nearest seed (each seed is jittered inside its own cell).
    var minDist = 1e10;
    var nearestOffset = vec2<f32>(0.0);
    var nearestJitter = vec2<f32>(0.0);
    var nearestCell = vec2<i32>(0);
    for (var y: i32 = -1; y <= 1; y++) {
        for (var x: i32 = -1; x <= 1; x++) {
            let neighbor = vec2<i32>(x, y);
            let jitter = cellJitter(cellIdx + neighbor, seed);
            let offset = vec2<f32>(neighbor) + jitter - cellFrac;
            let d = dot(offset, offset);
            if (d < minDist) {
                minDist = d;
                nearestOffset = offset;
                nearestJitter = jitter;
                nearestCell = neighbor;
            }
        }
    }

    // Pass 2 (#1171): true distance to the cell boundary — the distance to
    // the nearest bisector between the nearest seed and each neighbouring
    // seed. F2 - F1 (used before) only equals twice that distance on the
    // line joining the two seeds; away from it the gap shrinks, so edges
    // flared into wide dark wedges near short borders. The neighbours that
    // can share a border with the nearest seed lie within a 5x5 block
    // centred on its cell. The nearest seed is skipped by its cell index,
    // not by comparing recomputed positions (#1271): every other cell's
    // seed lies in a different unit square, so `between` is never zero.
    var edgeDist = 1e10;
    for (var y: i32 = -2; y <= 2; y++) {
        for (var x: i32 = -2; x <= 2; x++) {
            if (x == 0 && y == 0) {
                continue;
            }
            let neighbor = nearestCell + vec2<i32>(x, y);
            let offset = vec2<f32>(neighbor) + cellJitter(cellIdx + neighbor, seed) - cellFrac;
            let between = offset - nearestOffset;
            edgeDist = min(edgeDist, dot(0.5 * (nearestOffset + offset), normalize(between)));
        }
    }

    // Sample image color at the Voronoi cell center found in pass 1.
    let closestCenter = vec2<f32>(cellIdx + nearestCell) + nearestJitter;
    let sampleUV = clamp(
        closestCenter / (params.u_cellCount * vec2<f32>(aspect, 1.0)),
        vec2<f32>(0.0),
        vec2<f32>(1.0),
    );
    let cellColor = textureSampleLevel(u_tex, u_tex_sampler, sampleUV, 0.0);

    // #936: one cell unit spans height / cellCount px (scaledUV scales the
    // short axis by cellCount), so the px -> cell-unit conversion must use
    // the same side. Dividing by the long side thinned edges by the aspect.
    let edgePx = params.u_edgeWidth / texSize.y * params.u_cellCount;
    // The line is centred on the boundary, Edge Width px across in total.
    let edge = 1.0 - smoothstep(0.0, max(edgePx, 0.001), 2.0 * edgeDist);

    let edgeColor = vec3<f32>(params.u_edgeR, params.u_edgeG, params.u_edgeB);
    let finalColor = mix(cellColor.rgb, edgeColor, edge);
    // #916: voronoi is a Stylize filter, not a generator (unlike Clouds /
    // Smoke / Fibers) — it samples the source image via u_tex, so it must
    // preserve the sampled cell's alpha to keep the layer's silhouette on
    // transparent areas. The #766 fix forced alpha to 1.0 here too, which
    // flooded every transparent region with opaque black.
    return vec4<f32>(finalColor, cellColor.a);
}
