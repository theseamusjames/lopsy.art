struct Params {
    u_maxOpacity: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let c = textureSample(u_tex, u_tex_sampler, uv);
    // Clamp alpha to the brush opacity ceiling.
    // Scale RGB proportionally to maintain premultiplied alpha.
    if (c.a > params.u_maxOpacity && c.a > 0.001) {
        let scale = params.u_maxOpacity / c.a;
        return vec4<f32>(c.rgb * scale, params.u_maxOpacity);
    }
    return c;
}
