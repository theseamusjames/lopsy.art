// One separable Gaussian pass, edge-clamped, for the develop detail stages.
// CPU reference: lopsy_core::detail::blur_axis.
struct Params {
    // (1, 0) for horizontal, (0, 1) for vertical.
    u_dir: vec2<f32>,
    u_sigma: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;

const MAX_TAPS: i32 = 12;

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<i32>(textureDimensions(u_tex, 0));
    let p = vec2<i32>(position.xy);
    let dir = vec2<i32>(params.u_dir);
    let sigma = max(params.u_sigma, 0.3);
    let r = clamp(i32(ceil(3.0 * sigma)), 1, MAX_TAPS);
    var acc = vec4<f32>(0.0);
    var total = 0.0;
    for (var i = -MAX_TAPS; i <= MAX_TAPS; i++) {
        if (i < -r || i > r) {
            continue;
        }
        let w = exp(-f32(i * i) / (2.0 * sigma * sigma));
        let q = clamp(p + dir * i, vec2<i32>(0), size - 1);
        acc += w * textureLoad(u_tex, q, 0);
        total += w;
    }
    return acc / total;
}
