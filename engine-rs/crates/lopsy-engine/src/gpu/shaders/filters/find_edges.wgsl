@group(0) @binding(0) var u_tex: texture_2d<f32>;
@group(0) @binding(1) var u_tex_sampler: sampler;

fn lumaAt(uv: vec2<f32>) -> f32 {
    return dot(textureSample(u_tex, u_tex_sampler, uv).rgb, vec3<f32>(0.299, 0.587, 0.114));
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let texel = 1.0 / vec2<f32>(textureDimensions(u_tex, 0));

    // Sobel kernels
    let tl = lumaAt(uv + vec2<f32>(-texel.x, -texel.y));
    let tc = lumaAt(uv + vec2<f32>(0.0, -texel.y));
    let tr = lumaAt(uv + vec2<f32>(texel.x, -texel.y));
    let ml = lumaAt(uv + vec2<f32>(-texel.x, 0.0));
    let mr = lumaAt(uv + vec2<f32>(texel.x, 0.0));
    let bl = lumaAt(uv + vec2<f32>(-texel.x, texel.y));
    let bc = lumaAt(uv + vec2<f32>(0.0, texel.y));
    let br = lumaAt(uv + vec2<f32>(texel.x, texel.y));

    let gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
    let gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
    let edge = sqrt(gx * gx + gy * gy);

    let orig = textureSample(u_tex, u_tex_sampler, uv);
    return vec4<f32>(vec3<f32>(edge), orig.a);
}
