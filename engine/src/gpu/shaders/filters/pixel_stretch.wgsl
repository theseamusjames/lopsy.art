struct Params {
    u_amount: f32,
    u_bands: f32,
    u_seed: f32,
    u_rgbSplit: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

fn hash(n: f32) -> f32 {
    return fract(sin(n * 12.9898 + params.u_seed * 78.233) * 43758.5453);
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let texSize = vec2<f32>(textureDimensions(u_tex, 0));
    let texelX = 1.0 / texSize.x;

    let bandIndex = floor(uv.y * params.u_bands);

    let h = hash(bandIndex + 0.5);
    let bandOn = step(0.6, hash(bandIndex * 3.0 + 0.7));
    let offset = (h * 2.0 - 1.0) * params.u_amount * texelX * bandOn;

    let split = params.u_rgbSplit * abs(offset) * 0.5;

    let uvR = vec2<f32>(clamp(uv.x + offset + split, 0.0, 1.0), uv.y);
    let uvG = vec2<f32>(clamp(uv.x + offset, 0.0, 1.0), uv.y);
    let uvB = vec2<f32>(clamp(uv.x + offset - split, 0.0, 1.0), uv.y);

    let rs = textureSample(u_tex, u_tex_sampler, uvR);
    let gs = textureSample(u_tex, u_tex_sampler, uvG);
    let bs = textureSample(u_tex, u_tex_sampler, uvB);

    // Per-channel coverage keeps the split visible past transparency (#1043).
    let a = max(rs.a, max(gs.a, bs.a));
    let premul = vec3<f32>(rs.r * rs.a, gs.g * gs.a, bs.b * bs.a);
    if (a > 0.0) {
        return vec4<f32>(premul / a, a);
    }
    return vec4<f32>(0.0);
}
