// Moves the quick-mask content under the marquee by u_offset texels: the
// marquee's original area is cleared and the moved content max-blends onto
// what it lands on. Mirrors translateQuickMaskContent in quick-mask-move.ts.
// Texel rows match document rows, so the offset needs no flip.
struct Params {
    u_offset: vec2<i32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_base: texture_2d<f32>;
@group(0) @binding(2) var u_marquee: texture_2d<f32>;

fn marqueeAt(p: vec2<i32>) -> f32 {
    let size = vec2<i32>(textureDimensions(u_marquee, 0));
    if (any(p < vec2<i32>(0)) || any(p >= size)) { return 0.0; }
    return textureLoad(u_marquee, p, 0).r;
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let p = vec2<i32>(position.xy);
    let size = vec2<i32>(textureDimensions(u_base, 0));
    var v = 0.0;
    if (marqueeAt(p) <= 0.0) { v = textureLoad(u_base, p, 0).r; }
    let s = p - params.u_offset;
    if (all(s >= vec2<i32>(0)) && all(s < size) && marqueeAt(s) > 0.0) {
        v = max(v, textureLoad(u_base, s, 0).r);
    }
    return vec4<f32>(vec3<f32>(v), 1.0);
}
