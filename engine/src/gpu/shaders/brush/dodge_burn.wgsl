struct Params {
    u_mode: i32,
    u_exposure: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_layerTex: texture_2d<f32>;
@group(0) @binding(2) var u_layerTex_sampler: sampler;
@group(0) @binding(3) var u_stampTex: texture_2d<f32>;
@group(0) @binding(4) var u_stampTex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let c = textureSample(u_layerTex, u_layerTex_sampler, uv);
    let stamp = textureSample(u_stampTex, u_stampTex_sampler, uv).r;
    let strength = stamp * params.u_exposure;
    var rgb = c.rgb;
    if (params.u_mode == 0) {
        rgb += (1.0 - rgb) * strength;
    } else {
        rgb *= (1.0 - strength);
    }
    return vec4<f32>(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)), c.a);
}
