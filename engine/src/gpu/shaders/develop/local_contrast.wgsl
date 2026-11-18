// Haze, large details (clarity) and small details (texture) for the
// develop view. CPU reference: lopsy_core::detail::local_contrast_reference.
struct Params {
    // −100..100 each.
    u_largeAmount: f32,
    u_smallAmount: f32,
    u_hazeAmount: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
// The image blurred by LC_SMALL_SIGMA and LC_LARGE_SIGMA; either may be a
// downscaled copy, read with bilinear filtering.
@group(0) @binding(2) var u_small: texture_2d<f32>;
@group(0) @binding(3) var u_small_sampler: sampler;
@group(0) @binding(4) var u_large: texture_2d<f32>;
@group(0) @binding(5) var u_large_sampler: sampler;

fn luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn hazeApply(c: vec3<f32>, large: vec3<f32>, haze: f32) -> vec3<f32> {
    let h = haze / 100.0;
    if (h > 0.0) {
        let dark = clamp(min(min(large.r, large.g), large.b), 0.0, 1.0);
        let k = 0.85 * h * dark;
        return (c - vec3<f32>(k)) * (1.0 / (1.0 - k));
    }
    if (h < 0.0) {
        let t = -h * 0.35;
        return c + t * (vec3<f32>(0.85) - c);
    }
    return c;
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<f32>(textureDimensions(u_tex, 0));
    let src = textureLoad(u_tex, vec2<i32>(position.xy), 0);
    let uv = position.xy / size;
    let lg = textureSampleLevel(u_large, u_large_sampler, uv, 0.0).rgb;
    let sm = textureSampleLevel(u_small, u_small_sampler, uv, 0.0).rgb;

    let c = hazeApply(src.rgb, lg, params.u_hazeAmount);
    let cs = hazeApply(sm, lg, params.u_hazeAmount);
    let cl = hazeApply(lg, lg, params.u_hazeAmount);
    let y = luma(c);
    let d = y - luma(cl);
    let mid = clamp(4.0 * y * (1.0 - y), 0.0, 1.0);
    let y1 = y + params.u_largeAmount / 100.0 * 1.5 * mid * d / (1.0 + (d / 0.12) * (d / 0.12));
    let e = y - luma(cs);
    let y2 = y1 + params.u_smallAmount / 100.0 * 1.5 * e / (1.0 + (e / 0.08) * (e / 0.08));
    var rgb = c + vec3<f32>(y2 - y);
    if (y > 1e-4) {
        rgb = c * (y2 / y);
    }
    return vec4<f32>(max(rgb, vec3<f32>(0.0)), src.a);
}
