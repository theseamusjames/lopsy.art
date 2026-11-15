struct Params {
    u_amount: f32,
    u_threshold: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;
@group(0) @binding(3) var u_blurredTex: texture_2d<f32>;
@group(0) @binding(4) var u_blurredTex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let orig = textureSample(u_tex, u_tex_sampler, uv);
    let blur = textureSample(u_blurredTex, u_blurredTex_sampler, uv);
    let diff = orig.rgb - blur.rgb;
    let mask = step(vec3<f32>(params.u_threshold / 255.0), abs(diff));
    let sharpened = clamp(orig.rgb + diff * params.u_amount * mask, vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(sharpened, orig.a);
}
