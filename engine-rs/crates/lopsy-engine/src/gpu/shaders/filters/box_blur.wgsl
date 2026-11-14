struct Params {
    u_direction: vec2<f32>,
    u_radius: i32,
    u_step: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let texelSize = 1.0 / vec2<f32>(textureDimensions(u_tex, 0));
    let stride = max(params.u_step, 1);
    // Average premultiplied color/alpha, then un-premultiply on write —
    // averaging straight RGB directly pulls a transparent tap's (often
    // black) RGB into the average and leaves a dark halo (#919).
    var sumRGB = vec3<f32>(0.0);
    var sumA = 0.0;
    var count = 0.0;
    for (var i: i32 = -63; i <= 63; i++) {
        if (i < -params.u_radius || i > params.u_radius) { continue; }
        let c = textureSample(u_tex, u_tex_sampler, uv + params.u_direction * f32(i * stride) * texelSize);
        sumRGB += c.rgb * c.a;
        sumA += c.a;
        count += 1.0;
    }
    let outA = sumA / count;
    var outRGB = vec3<f32>(0.0);
    if (sumA > 1e-6) { outRGB = sumRGB / sumA; }
    return vec4<f32>(outRGB, outA);
}
