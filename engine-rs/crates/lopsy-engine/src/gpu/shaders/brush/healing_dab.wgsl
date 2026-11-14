struct Params {
    u_center: vec2<f32>,
    u_size: f32,
    u_texSize: vec2<f32>,
    u_sourceOffset: vec2<f32>,
    u_opacity: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_layerTex: texture_2d<f32>;
@group(0) @binding(2) var u_layerTex_sampler: sampler;
// 2x1 region means from healing_mean: (0, 0) source, (1, 0) destination.
@group(0) @binding(3) var u_meanTex: texture_2d<f32>;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let fragPos = uv * params.u_texSize;
    let existing = textureSample(u_layerTex, u_layerTex_sampler, uv);

    let radius = params.u_size * 0.5;
    let dist = length(fragPos - params.u_center);
    if (dist > radius) {
        return existing;
    }

    // Soft falloff within the dab
    let t = clamp(dist / radius, 0.0, 1.0);
    let soft = 1.0 - t * t;
    let edge = 1.0 - smoothstep(radius - 1.0, radius, dist);
    let stamp = soft * edge;

    // Sample source at offset position
    let sourceUV = (fragPos + params.u_sourceOffset) / params.u_texSize;
    if (sourceUV.x < 0.0 || sourceUV.x > 1.0 || sourceUV.y < 0.0 || sourceUV.y > 1.0) {
        return existing;
    }
    let src = textureSampleLevel(u_layerTex, u_layerTex_sampler, sourceUV, 0.0);

    // Healing: preserve source texture, match destination color
    // healed = source - srcMean + dstMean
    let srcMean = textureLoad(u_meanTex, vec2<i32>(0, 0), 0).rgb;
    let dstMean = textureLoad(u_meanTex, vec2<i32>(1, 0), 0).rgb;
    let healed = clamp(src.rgb - srcMean + dstMean, vec3<f32>(0.0), vec3<f32>(1.0));

    // Blend healed onto existing using stamp * opacity
    let a = src.a * stamp * params.u_opacity;
    let blended = healed * a + existing.rgb * (1.0 - a);
    let outA = a + existing.a * (1.0 - a);
    return vec4<f32>(blended, outA);
}
