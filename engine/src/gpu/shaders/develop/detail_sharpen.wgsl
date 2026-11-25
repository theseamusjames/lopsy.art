// Unsharp mask on luminance with an edge mask, for the develop view. The
// same luminance change goes to all three channels, so there are no colour
// halos. CPU reference: lopsy_core::detail::sharpen_reference.
struct Params {
    // amount / 100 (0..1.5).
    u_amount: f32,
    // 0..100.
    u_edges: f32,
    // 1 = output the edge mask as grey instead (live frame only).
    u_maskView: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
// The image after a Gaussian of the sharpening radius, at full size.
@group(0) @binding(2) var u_blurred: texture_2d<f32>;

fn luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn blurredLuma(p: vec2<i32>, size: vec2<i32>) -> f32 {
    return luma(textureLoad(u_blurred, clamp(p, vec2<i32>(0), size - 1), 0).rgb);
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<i32>(textureDimensions(u_tex, 0));
    let p = vec2<i32>(position.xy);
    let src = textureLoad(u_tex, p, 0);
    let gx = 0.5 * (blurredLuma(p + vec2<i32>(1, 0), size) - blurredLuma(p - vec2<i32>(1, 0), size));
    let gy = 0.5 * (blurredLuma(p + vec2<i32>(0, 1), size) - blurredLuma(p - vec2<i32>(0, 1), size));
    let mag = sqrt(gx * gx + gy * gy);
    var mask = 1.0;
    if (params.u_edges > 0.0) {
        let t = 0.05 * params.u_edges / 100.0;
        let s = clamp((mag - 0.5 * t) / (0.5 * t), 0.0, 1.0);
        mask = s * s * (3.0 - 2.0 * s);
    }
    if (params.u_maskView == 1) {
        return vec4<f32>(vec3<f32>(mask), src.a);
    }
    let d = params.u_amount * mask * (luma(src.rgb) - blurredLuma(p, size));
    return vec4<f32>(max(src.rgb + vec3<f32>(d), vec3<f32>(0.0)), src.a);
}
