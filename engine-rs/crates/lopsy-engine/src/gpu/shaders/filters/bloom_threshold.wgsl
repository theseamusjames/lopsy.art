struct Params {
    u_threshold: f32,
    u_softKnee: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let c = textureSample(u_tex, u_tex_sampler, uv);
    let brightness = dot(c.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let knee = params.u_threshold * params.u_softKnee;
    var soft = brightness - (params.u_threshold - knee);
    soft = clamp(soft / (2.0 * knee + 0.0001), 0.0, 1.0);
    soft = soft * soft;
    let contribution = max(soft, step(params.u_threshold, brightness));
    // Carry the contribution in alpha only: gaussian_blur.glsl premultiplies
    // by alpha and un-premultiplies its result, so bloom_combine.glsl must
    // re-multiply by the blurred alpha to recover a falloff (#959).
    return vec4<f32>(c.rgb, c.a * contribution);
}
