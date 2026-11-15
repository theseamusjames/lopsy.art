struct Params {
    // Drawn into a 2x1 target: texel (0, 0) receives the source region's mean,
    // texel (1, 0) the destination region's.
    u_srcCenter: vec2<f32>,
    u_dstCenter: vec2<f32>,
    u_radius: f32,
    u_texSize: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

// Poisson disk samples in unit circle (32 taps for good coverage)
const NUM_SAMPLES: i32 = 32;
const SAMPLES = array<vec2<f32>, 32>(
    vec2<f32>(-0.613, 0.617), vec2<f32>(0.170, -0.040), vec2<f32>(-0.299, -0.294),
    vec2<f32>(0.525, 0.529), vec2<f32>(-0.840, -0.138), vec2<f32>(0.149, -0.600),
    vec2<f32>(0.700, -0.497), vec2<f32>(-0.228, 0.318), vec2<f32>(0.471, 0.062),
    vec2<f32>(-0.516, -0.693), vec2<f32>(0.862, 0.170), vec2<f32>(-0.100, 0.888),
    vec2<f32>(0.354, -0.916), vec2<f32>(-0.689, 0.224), vec2<f32>(0.063, 0.372),
    vec2<f32>(-0.448, 0.947), vec2<f32>(0.940, -0.224), vec2<f32>(-0.919, 0.373),
    vec2<f32>(0.273, 0.838), vec2<f32>(-0.135, -0.879), vec2<f32>(0.657, -0.783),
    vec2<f32>(-0.752, -0.465), vec2<f32>(0.410, -0.367), vec2<f32>(-0.316, 0.645),
    vec2<f32>(0.820, 0.698), vec2<f32>(-0.582, 0.015), vec2<f32>(0.098, -0.295),
    vec2<f32>(-0.017, 0.142), vec2<f32>(0.574, 0.302), vec2<f32>(-0.423, -0.087),
    vec2<f32>(0.186, 0.568), vec2<f32>(-0.732, 0.791),
);

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    var center = params.u_dstCenter;
    if (position.x < 1.0) { center = params.u_srcCenter; }
    var sum = vec3<f32>(0.0);
    var count = 0.0;

    for (var i: i32 = 0; i < NUM_SAMPLES; i++) {
        let offset = SAMPLES[i] * params.u_radius;
        let samplePos = center + offset;
        let sampleUV = samplePos / params.u_texSize;

        if (sampleUV.x >= 0.0 && sampleUV.x <= 1.0 &&
            sampleUV.y >= 0.0 && sampleUV.y <= 1.0) {
            let s = textureSampleLevel(u_tex, u_tex_sampler, sampleUV, 0.0);
            if (s.a > 0.0) {
                sum += s.rgb;
                count += 1.0;
            }
        }
    }

    if (count > 0.0) {
        return vec4<f32>(sum / count, 1.0);
    }
    return vec4<f32>(0.0);
}
