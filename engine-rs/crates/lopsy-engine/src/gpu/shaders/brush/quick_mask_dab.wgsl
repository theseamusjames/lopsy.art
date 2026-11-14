struct Params {
    u_size: f32,
    u_hardness: f32,
    u_opacity: f32,
    u_center: vec2<f32>,
    u_texSize: vec2<f32>,
    // 0 = brush (add), 1 = eraser (remove)
    u_mode: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_maskTex: texture_2d<f32>;
@group(0) @binding(2) var u_maskTex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let current = textureSample(u_maskTex, u_maskTex_sampler, uv);
    let fragPos = uv * params.u_texSize;
    let radius = params.u_size * 0.5;
    let dist = length(fragPos - params.u_center);

    if (dist > radius) {
        return current;
    }

    // Quadratic falloff matching brush stamp
    let t = clamp(dist / radius, 0.0, 1.0);
    let soft = 1.0 - t * t;
    var stamp = params.u_hardness + (1.0 - params.u_hardness) * soft;

    // Smooth antialiasing at circle edge
    let edge = 1.0 - smoothstep(radius - 1.0, radius, dist);
    stamp *= edge;

    let dabStrength = stamp * params.u_opacity;
    let existing = current.r;

    if (params.u_mode == 0) {
        // Brush: paint white (add to selection) - MAX accumulation
        let v = max(existing, dabStrength);
        return vec4<f32>(v, v, v, 1.0);
    }
    // Eraser: paint black (remove from selection)
    let v = existing * (1.0 - dabStrength);
    return vec4<f32>(v, v, v, 1.0);
}
