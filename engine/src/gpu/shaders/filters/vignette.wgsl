struct Params {
    u_amount: f32,
    // Document color mode: 1 = Lab, whose textures hold encoded CIELAB. Scaling
    // the encoded a/b channels would push them toward -128 (blue), so the pass
    // darkens decoded sRGB and re-encodes it.
    u_docColorMode: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

//#include lab

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let c = textureSample(u_tex, u_tex_sampler, uv);
    let isLab = params.u_docColorMode == 1;
    var rgb = c.rgb;
    if (isLab) { rgb = labToSrgb(rgb); }
    let dist = length(uv - 0.5) * 1.414;
    let vig = 1.0 - smoothstep(0.5, 1.2, dist) * params.u_amount * 0.01;
    rgb *= vig;
    if (isLab) { rgb = srgbToLab(rgb); }
    return vec4<f32>(rgb, c.a);
}
