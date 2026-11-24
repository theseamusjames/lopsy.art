// Noise reduction for the develop view: a 5x5 bilateral on luminance and
// chroma taken from a blurred copy except across luminance edges.
// CPU reference: lopsy_core::detail::noise_reduce_reference.
struct Params {
    // 0..1 each.
    u_luminance: f32,
    u_color: f32,
    // Range sigma of the bilateral (nr_range_sigma over the threshold scale).
    u_rangeSigma: f32,
    // The colour edge guard's threshold is 0.08 over this (NoiseRun).
    u_guardScale: f32,
    // 1 leaves negative results as they are (the working space); 0 clamps.
    u_keepNegative: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_chroma: texture_2d<f32>;
@group(0) @binding(3) var u_chroma_sampler: sampler;

fn luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<i32>(textureDimensions(u_tex, 0));
    let p = vec2<i32>(position.xy);
    let src = textureLoad(u_tex, p, 0);
    let uv = position.xy / vec2<f32>(size);
    let blurred = textureSampleLevel(u_chroma, u_chroma_sampler, uv, 0.0).rgb;

    let yc = luma(src.rgb);
    let sr = params.u_rangeSigma;
    var acc = 0.0;
    var total = 0.0;
    for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
            let q = clamp(p + vec2<i32>(dx, dy), vec2<i32>(0), size - 1);
            let yn = luma(textureLoad(u_tex, q, 0).rgb);
            let spatial = exp(-f32(dx * dx + dy * dy) / (2.0 * 1.2 * 1.2));
            let range = exp(-((yn - yc) * (yn - yc)) / (2.0 * sr * sr));
            acc += spatial * range * yn;
            total += spatial * range;
        }
    }
    let yNew = yc + params.u_luminance * (acc / total - yc);
    let yb = luma(blurred);
    let g = (yb - yc) / 0.08 * params.u_guardScale;
    let k = params.u_color * exp(-(g * g));
    let chroma = src.rgb - vec3<f32>(yc);
    let chromaB = blurred - vec3<f32>(yb);
    let rgb = vec3<f32>(yNew) + chroma + k * (chromaB - chroma);
    if (params.u_keepNegative == 1) {
        return vec4<f32>(rgb, src.a);
    }
    return vec4<f32>(max(rgb, vec3<f32>(0.0)), src.a);
}
