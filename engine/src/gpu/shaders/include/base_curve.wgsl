// The base curve's lookup table, `u_curveLut`: entry i is texel
// (i % width, i / width) of its red channel (engine/src/develop/mod.rs,
// `curve_texels`). The including shader declares the texture.
fn curveEntry(i: i32, width: i32) -> f32 {
    return textureLoad(u_curveLut, vec2<i32>(i % width, i / width), 0).r;
}

// Linear interpolation between entries over 0..1, as dng::color::apply_lut
// does it; outside 0..1 the end entries. Hardware filtering would
// interpolate at the texture's own precision.
fn curveLookup(v: f32, size: i32, width: i32) -> f32 {
    let maxIdx = f32(size - 1);
    let idx = clamp(v * maxIdx, 0.0, maxIdx);
    let lo = i32(floor(idx));
    let hi = min(lo + 1, size - 1);
    let frac = idx - f32(lo);
    return curveEntry(lo, width) * (1.0 - frac) + curveEntry(hi, width) * frac;
}
