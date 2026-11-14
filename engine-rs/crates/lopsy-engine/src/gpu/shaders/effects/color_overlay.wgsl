struct Params {
    u_overlayColor: vec4<f32>,
    u_opacity: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_srcTex: texture_2d<f32>;
@group(0) @binding(2) var u_srcTex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let src = textureSample(u_srcTex, u_srcTex_sampler, uv);
    return vec4<f32>(mix(src.rgb, params.u_overlayColor.rgb, params.u_opacity), src.a);
}
