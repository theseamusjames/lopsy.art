struct Params {
    u_focusPosition: f32,
    u_focusWidth: f32,
    u_blurRadius: f32,
    u_angle: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

fn computeBlurAmount(uv: vec2<f32>) -> f32 {
    let centered = uv - 0.5;
    let cosA = cos(params.u_angle);
    let sinA = sin(params.u_angle);
    let projected = centered.x * (-sinA) + centered.y * cosA + 0.5;

    let dist = abs(projected - params.u_focusPosition);
    let halfWidth = params.u_focusWidth * 0.5;
    return smoothstep(halfWidth, halfWidth + 0.15, dist);
}

// Poisson disc samples (28 points) for natural-looking blur
const NUM_SAMPLES: i32 = 28;
const POISSON_DISK = array<vec2<f32>, 28>(
    vec2<f32>(-0.613392, 0.617481),
    vec2<f32>(0.170019, -0.040254),
    vec2<f32>(-0.299417, 0.791925),
    vec2<f32>(0.645680, 0.493210),
    vec2<f32>(-0.651784, 0.717887),
    vec2<f32>(0.421003, 0.027070),
    vec2<f32>(-0.817194, -0.271096),
    vec2<f32>(-0.705374, -0.668203),
    vec2<f32>(0.977050, -0.108615),
    vec2<f32>(0.063326, 0.142369),
    vec2<f32>(0.203528, 0.214331),
    vec2<f32>(-0.667531, 0.326090),
    vec2<f32>(-0.098422, -0.295755),
    vec2<f32>(-0.885922, 0.215369),
    vec2<f32>(0.566637, 0.605213),
    vec2<f32>(0.039766, -0.396100),
    vec2<f32>(0.751946, 0.453352),
    vec2<f32>(0.078707, -0.715323),
    vec2<f32>(-0.075838, -0.529344),
    vec2<f32>(0.724479, -0.580798),
    vec2<f32>(0.222999, -0.215125),
    vec2<f32>(-0.467574, -0.405438),
    vec2<f32>(-0.248268, -0.814753),
    vec2<f32>(0.354411, -0.887570),
    vec2<f32>(0.175817, 0.382366),
    vec2<f32>(0.487472, -0.063082),
    vec2<f32>(-0.084078, 0.898312),
    vec2<f32>(0.488876, -0.783441),
);

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let blurAmount = computeBlurAmount(uv);
    let sharp = textureSample(u_tex, u_tex_sampler, uv);

    if (blurAmount < 0.01) {
        return sharp;
    }

    let texelSize = 1.0 / vec2<f32>(textureDimensions(u_tex, 0));
    let radius = blurAmount * params.u_blurRadius;

    var accum = sharp;
    var totalWeight = 1.0;

    for (var i: i32 = 0; i < NUM_SAMPLES; i++) {
        let offset = POISSON_DISK[i] * radius * texelSize;
        let d = length(POISSON_DISK[i]);
        let w = 1.0 - d * 0.3;
        accum += textureSampleLevel(u_tex, u_tex_sampler, uv + offset, 0.0) * w;
        totalWeight += w;
    }

    return accum / totalWeight;
}
