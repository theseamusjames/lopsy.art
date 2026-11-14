struct Params {
    u_amount: f32, // pixel offset magnitude
    u_angle: f32, // direction in radians
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let texSize = vec2<f32>(textureDimensions(u_tex, 0));
    let texel = 1.0 / texSize;
    let dir = vec2<f32>(cos(params.u_angle), sin(params.u_angle));
    let offset = params.u_amount * texel * dir;
    let rs = textureSample(u_tex, u_tex_sampler, uv + offset);
    let gs = textureSample(u_tex, u_tex_sampler, uv);
    let bs = textureSample(u_tex, u_tex_sampler, uv - offset);
    // Each shifted channel carries its own coverage, so a fringe that moves
    // past a transparent layer's silhouette stays visible (#1043).
    let a = max(rs.a, max(gs.a, bs.a));
    let premul = vec3<f32>(rs.r * rs.a, gs.g * gs.a, bs.b * bs.a);
    if (a > 0.0) {
        return vec4<f32>(premul / a, a);
    }
    return vec4<f32>(0.0);
}
