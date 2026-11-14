struct Params {
    u_level: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let c = textureSample(u_tex, u_tex_sampler, uv);
    let lum = dot(c.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let v = step(params.u_level, lum);
    return vec4<f32>(vec3<f32>(v), c.a);
}
