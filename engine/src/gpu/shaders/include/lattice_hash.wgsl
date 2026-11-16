// A random value in [0, 1) for an integer lattice point of value noise.
//
// Integer arithmetic is exact on every GPU. The float hash this replaced
// (fract of products of large values) amplified rounding, and drivers fold
// `hash(i)` and `hash(i + (1, 0))` differently, so the two cells sharing a
// lattice corner could disagree about its value: hard-edged blocks and
// seams along the lattice lines (#1674). `cell` must hold whole numbers
// (a `floor`); the seed's bits pick the pattern.
fn lattice_hash(cell: vec2<f32>, seed: f32) -> f32 {
    let c = bitcast<vec2<u32>>(vec2<i32>(cell));
    var h = (c.x * 0x8da6b343u) ^ (c.y * 0xd8163841u) ^ (bitcast<u32>(seed) * 0xcb1ab31fu);
    h = (h ^ (h >> 16u)) * 0x7feb352du;
    h = (h ^ (h >> 15u)) * 0x846ca68bu;
    h = h ^ (h >> 16u);
    return f32(h >> 8u) / 16777216.0;
}
