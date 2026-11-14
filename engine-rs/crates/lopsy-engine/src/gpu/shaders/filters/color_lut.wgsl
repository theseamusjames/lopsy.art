struct Params {
    u_lutSize: f32,
    u_intensity: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;
@group(0) @binding(3) var u_lut: texture_2d<f32>;
@group(0) @binding(4) var u_lut_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let color = textureSample(u_tex, u_tex_sampler, uv);
    let N = params.u_lutSize;
    let maxIdx = N - 1.0;
    let blueScaled = color.b * maxIdx;
    let slice0 = floor(blueScaled);
    let slice1 = min(slice0 + 1.0, maxIdx);
    let blueFrac = blueScaled - slice0;
    let v_coord = (color.g * maxIdx + 0.5) / N;
    let u0 = (slice0 * N + color.r * maxIdx + 0.5) / (N * N);
    let u1 = (slice1 * N + color.r * maxIdx + 0.5) / (N * N);
    let lut0 = textureSample(u_lut, u_lut_sampler, vec2<f32>(u0, v_coord)).rgb;
    let lut1 = textureSample(u_lut, u_lut_sampler, vec2<f32>(u1, v_coord)).rgb;
    let lutColor = mix(lut0, lut1, blueFrac);
    let result = mix(color.rgb, lutColor, params.u_intensity);
    return vec4<f32>(result, color.a);
}
