struct Params {
    u_sourceOffset: vec2<f32>,
    u_center: vec2<f32>,
    u_size: f32,
    u_texSize: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_sourceTex: texture_2d<f32>;
@group(0) @binding(2) var u_sourceTex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let fragPos = uv * params.u_texSize;
    let existing = textureSample(u_sourceTex, u_sourceTex_sampler, uv);

    // Only apply within the dab circle
    let radius = params.u_size * 0.5;
    let dist = length(fragPos - params.u_center);
    if (dist > radius) {
        return existing;
    }

    // Compute stamp falloff (same as the brush dab), at hardness 0.8. The
    // f32() makes 1.0 - 0.8 fold in 32-bit float, as it did in GLSL.
    let t = clamp(dist / radius, 0.0, 1.0);
    let soft = 1.0 - t * t;
    var stamp = 0.8 + (1.0 - f32(0.8)) * soft;
    let edge = 1.0 - smoothstep(radius - 1.0, radius, dist);
    stamp *= edge;

    // Sample source at offset position
    let sourceUV = (fragPos + params.u_sourceOffset) / params.u_texSize;
    if (sourceUV.x < 0.0 || sourceUV.x > 1.0 || sourceUV.y < 0.0 || sourceUV.y > 1.0) {
        return existing;
    }
    let src = textureSampleLevel(u_sourceTex, u_sourceTex_sampler, sourceUV, 0.0);

    // Blend source onto existing using stamp as alpha
    let a = src.a * stamp;
    let blended = src.rgb * a + existing.rgb * (1.0 - a);
    let outA = a + existing.a * (1.0 - a);
    return vec4<f32>(blended, outA);
}
