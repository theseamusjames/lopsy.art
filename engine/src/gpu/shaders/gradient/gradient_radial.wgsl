struct Params {
    u_hasMask: i32,
    u_center: vec2<f32>,
    u_radius: f32,
    u_stops: array<vec4<f32>, 16>,
    // Stop positions, four to a vector: position i is
    // u_stopPositions[i / 4][i % 4]. A WGSL uniform struct cannot hold
    // array<f32, 16>.
    u_stopPositions: array<vec4<f32>, 4>,
    u_stopCount: i32,
    u_texSize: vec2<f32>,
    u_docSize: vec2<f32>,
    u_layerOffset: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_existingTex: texture_2d<f32>;
@group(0) @binding(2) var u_existingTex_sampler: sampler;
@group(0) @binding(3) var u_maskTex: texture_2d<f32>;
@group(0) @binding(4) var u_maskTex_sampler: sampler;

fn stopPosition(i: i32) -> f32 {
    return params.u_stopPositions[i / 4][i % 4];
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let existing = textureSample(u_existingTex, u_existingTex_sampler, uv);

    // Texture-local, like u_center: callers subtract the layer origin from
    // the document-space drag (#1169).
    let pos = uv * params.u_texSize;
    let t = clamp(length(pos - params.u_center) / params.u_radius, 0.0, 1.0);
    var gradColor = params.u_stops[0];
    for (var i: i32 = 1; i < 16; i++) {
        if (i >= params.u_stopCount) { break; }
        let before = stopPosition(i - 1);
        if (t >= before) {
            let seg = (t - before) / max(stopPosition(i) - before, 0.001);
            gradColor = mix(params.u_stops[i - 1], params.u_stops[i], clamp(seg, 0.0, 1.0));
        }
    }

    // Triangular dither to reduce banding when stored in RGBA8 textures.
    let seed = position.xy;
    let n0 = fract(sin(dot(seed, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    let n1 = fract(sin(dot(seed, vec2<f32>(63.7264, 10.873))) * 28637.1136);
    let dither = (n0 + n1 - 1.0) / 255.0;
    // Clamped so a stop at 0 or 1 never dithers out of range in an RGBA16F
    // layer: negative channels poison non-Normal blends above it (#1557).
    let gradRGB = clamp(gradColor.rgb + dither, vec3<f32>(0.0), vec3<f32>(1.0));

    // Always composite over the existing pixels: the selection only scales
    // the gradient's coverage, so transparent stops keep what is underneath
    // with or without a selection (#1023).
    var coverage = 1.0;
    if (params.u_hasMask == 1) {
        let docPos = params.u_layerOffset + uv * params.u_texSize;
        let maskUV = docPos / params.u_docSize;
        let inCanvas = textureSampleLevel(u_maskTex, u_maskTex_sampler, maskUV, 0.0).r;
        // Off-canvas texels are outside the selection (#1033).
        let isOffCanvas = any(maskUV < vec2<f32>(0.0)) || any(maskUV > vec2<f32>(1.0));
        coverage = select(inCanvas, 0.0, isOffCanvas);
    }
    let srcA = gradColor.a * coverage;
    let outA = srcA + existing.a * (1.0 - srcA);
    var outRGB = vec3<f32>(0.0);
    if (outA > 0.0) {
        outRGB = (gradRGB * srcA + existing.rgb * existing.a * (1.0 - srcA)) / outA;
    }
    return vec4<f32>(outRGB, outA);
}
