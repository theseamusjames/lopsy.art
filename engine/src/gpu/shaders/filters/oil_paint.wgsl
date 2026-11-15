struct Params {
    u_radius: f32,
    u_sharpness: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let texSize = vec2<f32>(textureDimensions(u_tex, 0));
    let texel = 1.0 / texSize;
    let r = i32(params.u_radius);

    // Kuwahara filter: divide neighborhood into 4 overlapping quadrants,
    // compute mean & variance of each, then weight by inverse variance.
    var mean: array<vec3<f32>, 4>;
    var varSum: array<vec3<f32>, 4>;
    var count: array<f32, 4>;

    for (var i: i32 = 0; i < 4; i++) {
        mean[i] = vec3<f32>(0.0);
        varSum[i] = vec3<f32>(0.0);
        count[i] = 0.0;
    }

    // Quadrant 0: top-left (-r..0, -r..0)
    // Quadrant 1: top-right (0..+r, -r..0)
    // Quadrant 2: bottom-left (-r..0, 0..+r)
    // Quadrant 3: bottom-right (0..+r, 0..+r)
    for (var dy: i32 = -r; dy <= r; dy++) {
        for (var dx: i32 = -r; dx <= r; dx++) {
            let offset = vec2<f32>(f32(dx), f32(dy)) * texel;
            let s = textureSample(u_tex, u_tex_sampler, uv + offset).rgb;

            if (dx <= 0 && dy <= 0) { mean[0] += s; varSum[0] += s * s; count[0] += 1.0; }
            if (dx >= 0 && dy <= 0) { mean[1] += s; varSum[1] += s * s; count[1] += 1.0; }
            if (dx <= 0 && dy >= 0) { mean[2] += s; varSum[2] += s * s; count[2] += 1.0; }
            if (dx >= 0 && dy >= 0) { mean[3] += s; varSum[3] += s * s; count[3] += 1.0; }
        }
    }

    var result = vec3<f32>(0.0);
    var totalWeight = 0.0;

    for (var i: i32 = 0; i < 4; i++) {
        let m = mean[i] / count[i];
        // E[s^2] - m^2 rounds slightly negative on flat regions, and pow() of a
        // negative base is NaN on some backends (Metal), which blacks out the pixel.
        let v = max(varSum[i] / count[i] - m * m, vec3<f32>(0.0));
        let variance = dot(v, vec3<f32>(1.0));

        // Weight inversely by variance raised to sharpness power
        let w = 1.0 / (1.0 + pow(variance * 1000.0, params.u_sharpness));
        result += m * w;
        totalWeight += w;
    }

    let orig = textureSample(u_tex, u_tex_sampler, uv);
    return vec4<f32>(result / totalWeight, orig.a);
}
