// One step of the content-bounds reduction (#1021). Each output texel
// ORs together `u_span` source texels along `u_axis`, starting at
// `outputCoord * stride` where the stride is `u_span` on the reduced
// axis and 1 on the other. Output is 1.0 where any of them is occupied.
//
// With `u_alphaTest` = 1 the source is a layer texture and "occupied"
// means the alpha a u8 readback would report as non-zero:
// round(clamp(a) * 255) > 0, the same test `crop_to_content_bounds`
// applies on the CPU (`read_rgba` rounds float alpha with +0.5). With
// `u_alphaTest` = 0 the source is a previous step's output (R = 0 or 1).
struct Params {
    u_axis: vec2<i32>,
    u_span: i32,
    u_srcSize: vec2<i32>,
    u_alphaTest: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_src: texture_2d<f32>;

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let outCoord = vec2<i32>(position.xy);
    let stride = vec2<i32>(1) + params.u_axis * (params.u_span - 1);
    let base = outCoord * stride;
    var occupied = 0.0;
    for (var i: i32 = 0; i < params.u_span; i++) {
        let q = base + params.u_axis * i;
        if (q.x >= params.u_srcSize.x || q.y >= params.u_srcSize.y) { break; }
        let t = textureLoad(u_src, q, 0);
        var isHit: bool;
        if (params.u_alphaTest == 1) {
            isHit = clamp(t.a, 0.0, 1.0) * 255.0 + 0.5 >= 1.0;
        } else {
            isHit = t.r > 0.5;
        }
        if (isHit) {
            occupied = 1.0;
            break;
        }
    }
    return vec4<f32>(occupied);
}
