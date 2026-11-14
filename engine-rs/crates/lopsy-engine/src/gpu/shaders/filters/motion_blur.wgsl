struct Params {
    // radians
    u_angle: f32,
    // number of samples
    u_distance: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;

// At a non-axis-aligned angle the per-sample offset below is a fraction of
// a texel, so most taps land between texel centers — hardware LINEAR
// filtering there blends straight RGBA and bleeds a transparent tap's RGB
// into the result, same root cause as #815.
//#include premul_sample

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let texSize = vec2<f32>(textureDimensions(u_tex, 0));
    let dir = vec2<f32>(cos(params.u_angle), sin(params.u_angle)) / texSize;

    // Average premultiplied color/alpha, then un-premultiply on write — see
    // the gaussian and box blurs for why (#919).
    var sumRGB = vec3<f32>(0.0);
    var sumA = 0.0;
    let samples = max(1, params.u_distance);
    let halfDist = f32(samples) * 0.5;

    for (var i: i32 = 0; i < samples; i++) {
        let offset = f32(i) - halfDist;
        let sampleUV = uv + dir * offset;
        let c = samplePremulBilinear(u_tex, sampleUV);
        sumRGB += c.rgb * c.a;
        sumA += c.a;
    }

    let outA = sumA / f32(samples);
    var outRGB = vec3<f32>(0.0);
    if (sumA > 1e-6) { outRGB = sumRGB / sumA; }
    return vec4<f32>(outRGB, outA);
}
