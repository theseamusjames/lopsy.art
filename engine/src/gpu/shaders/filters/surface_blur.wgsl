struct Params {
    u_radius: i32,
    u_threshold: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let texelSize = 1.0 / vec2<f32>(textureDimensions(u_tex, 0));
    let center = textureSample(u_tex, u_tex_sampler, uv);

    var weightedSum = vec4<f32>(0.0);
    var totalWeight = 0.0;

    let r = params.u_radius;
    for (var dy: i32 = -r; dy <= r; dy++) {
        for (var dx: i32 = -r; dx <= r; dx++) {
            let offset = vec2<f32>(f32(dx), f32(dy)) * texelSize;
            let neighborColor = textureSample(u_tex, u_tex_sampler, uv + offset);

            // Color distance between neighbor and center pixel (RGB channels)
            let dist = length(neighborColor.rgb - center.rgb);

            // Spatial weight: linear falloff within radius
            let spatialDist = length(vec2<f32>(f32(dx), f32(dy)));
            let spatialWeight = max(0.0, 1.0 - spatialDist / (f32(r) + 1.0));

            // Range weight: exclude pixels beyond threshold
            let rangeWeight = 1.0 - smoothstep(params.u_threshold * 0.95, params.u_threshold, dist);

            let weight = spatialWeight * rangeWeight;
            weightedSum += neighborColor * weight;
            totalWeight += weight;
        }
    }

    var result = center;
    if (totalWeight > 0.0) {
        result = weightedSum / totalWeight;
    }
    // Preserve original alpha
    return vec4<f32>(result.rgb, center.a);
}
