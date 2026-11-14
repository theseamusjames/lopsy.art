struct Params {
    // normalized center (0.5, 0.5 = image center)
    u_center: vec2<f32>,
    // number of samples / strength
    u_amount: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;

// The sample offsets below are a continuous fraction of the radial
// direction, so most taps land between texel centers — hardware LINEAR
// filtering there blends straight RGBA and bleeds a transparent tap's RGB
// into the result, same root cause as #815.
//#include premul_sample

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let dir = params.u_center - uv;
    let samples = max(1, params.u_amount);
    let invSamples = 1.0 / f32(samples);

    // Average premultiplied color/alpha, then un-premultiply on write — see
    // the gaussian and box blurs for why (#919).
    var sumRGB = vec3<f32>(0.0);
    var sumA = 0.0;
    for (var i: i32 = 0; i < samples; i++) {
        let t = f32(i) * invSamples;
        let offset = dir * t * 0.1;
        let c = samplePremulBilinear(u_tex, uv + offset);
        sumRGB += c.rgb * c.a;
        sumA += c.a;
    }

    let outA = sumA * invSamples;
    var outRGB = vec3<f32>(0.0);
    if (sumA > 1e-6) { outRGB = sumRGB / sumA; }
    return vec4<f32>(outRGB, outA);
}
