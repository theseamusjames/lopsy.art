struct Params {
    // light direction in radians
    u_angle: f32,
    // relief depth 0.0 - 1.0
    u_strength: f32,
    // 0.0 = emboss, 1.0 = pillow emboss
    u_embossType: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let texel = 1.0 / vec2<f32>(textureDimensions(u_tex, 0));
    let orig = textureSample(u_tex, u_tex_sampler, uv);

    let lightDir = vec2<f32>(cos(params.u_angle), sin(params.u_angle));

    // Strength controls the sampling distance — wider offset = wider bevel.
    // Quadratic curve so the upper half of the slider is more dramatic.
    let t = params.u_strength * params.u_strength;
    let radius = 1.0 + t * 20.0;
    let offset = lightDir * texel * radius;

    // Two-point directional luminance difference along the light vector.
    // Max magnitude is bounded by the luminance range (0-1) so it won't
    // clip the way a Sobel kernel does.
    let lumW = vec3<f32>(0.299, 0.587, 0.114);
    let lumFwd = dot(textureSample(u_tex, u_tex_sampler, uv + offset).rgb, lumW);
    let lumBwd = dot(textureSample(u_tex, u_tex_sampler, uv - offset).rgb, lumW);
    let diff = lumFwd - lumBwd;

    // Normal emboss: directional (highlight one side, shadow the other).
    // Pillow emboss: raised ridges along all edges (highlights both sides).
    var relief = diff;
    if (params.u_embossType > 0.5) { relief = abs(diff); }
    relief *= 0.75;

    let result = clamp(orig.rgb + vec3<f32>(relief), vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(result, orig.a);
}
