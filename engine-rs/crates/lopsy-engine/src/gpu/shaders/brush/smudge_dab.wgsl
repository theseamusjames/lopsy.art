struct Params {
    u_center: vec2<f32>,
    u_prev: vec2<f32>,
    u_size: f32,
    u_strength: f32,
    u_texSize: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_sourceTex: texture_2d<f32>;
@group(0) @binding(2) var u_sourceTex_sampler: sampler;

//#include premul_sample

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let fragPos = uv * params.u_texSize;
    let existing = textureSample(u_sourceTex, u_sourceTex_sampler, uv);

    let radius = params.u_size * 0.5;
    let dist = length(fragPos - params.u_center);
    if (dist > radius) {
        return existing;
    }

    // Soft quadratic falloff (matches the brush dab), peaking at 1.0 in the
    // centre and smoothly decaying to 0 at the edge. Squaring it pushes more
    // of the weight into the centre so the outer ring fades out invisibly
    // rather than clamping at a sharp circular silhouette.
    let d = clamp(dist / radius, 0.0, 1.0);
    var soft = 1.0 - d * d;
    soft = soft * soft;

    // 1px smoothstep feather at the outer edge so the dab doesn't terminate
    // with a hard ring against unsmudged pixels.
    let edge = 1.0 - smoothstep(radius - 1.0, radius, dist);
    let t = clamp(soft * edge * params.u_strength, 0.0, 1.0);

    if (t <= 0.0) {
        return existing;
    }

    // Sample from the prior dab position: each fragment reads the pixel that
    // was at fragPos - (center - prev) when the previous dab was painted,
    // effectively "dragging" the earlier pixels along the stroke direction.
    let delta = params.u_center - params.u_prev;
    let sampleUV = (fragPos - delta) / params.u_texSize;
    var sampled = existing;
    if (!(sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0)) {
        sampled = samplePremulBilinear(u_sourceTex, sampleUV);
    }

    // The layer stores straight alpha. Mixing straight RGB pulls colour
    // smeared into transparent pixels towards their black RGB (#1260), so
    // blend premultiplied and un-premultiply the result.
    let pe = vec4<f32>(existing.rgb * existing.a, existing.a);
    let ps = vec4<f32>(sampled.rgb * sampled.a, sampled.a);
    let m = mix(pe, ps, t);
    if (m.a < 1e-6) {
        return vec4<f32>(0.0);
    }
    return vec4<f32>(m.rgb / m.a, m.a);
}
