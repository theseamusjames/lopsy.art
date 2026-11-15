struct Params {
    u_strength: f32,
    u_zoom: f32,
    u_fringing: f32,
    // canvas centre in texture UV
    u_center: vec2<f32>,
    // canvas long side in pixels
    u_radiusScale: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

// #946: the radius is measured in pixels (normalised by the long side),
// not UV units — on a non-square layer one UV unit spans a different
// number of pixels on each axis, which squashed circles into ellipses.
// #1253: centred on, and normalised by, the canvas rather than the texture,
// which is larger than the canvas when the layer hangs past an edge.
fn distort(uv: vec2<f32>, k: f32, aspect: vec2<f32>) -> vec2<f32> {
    let d = (uv - params.u_center) / params.u_zoom;
    let dp = d * aspect;
    let r2 = dot(dp, dp);
    return params.u_center + d * (1.0 + k * r2);
}

fn inBounds(uv: vec2<f32>) -> bool {
    return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let texSize = vec2<f32>(textureDimensions(u_tex, 0));
    let aspect = texSize / params.u_radiusScale;
    var k = params.u_strength;
    if (k > 0.0) {
        k *= 1.0 + 2.0 * k;
    }

    if (abs(params.u_fringing) > 0.001) {
        let spread = params.u_fringing * 0.3;
        let uvR = distort(uv, k * (1.0 + spread), aspect);
        let uvG = distort(uv, k, aspect);
        let uvB = distort(uv, k * (1.0 - spread), aspect);

        if (!inBounds(uvR) || !inBounds(uvG) || !inBounds(uvB)) {
            return vec4<f32>(0.0);
        }
        let rs = textureSampleLevel(u_tex, u_tex_sampler, uvR, 0.0);
        let gs = textureSampleLevel(u_tex, u_tex_sampler, uvG, 0.0);
        let bs = textureSampleLevel(u_tex, u_tex_sampler, uvB, 0.0);
        // Per-channel coverage keeps fringes visible past transparency (#1043).
        let a = max(rs.a, max(gs.a, bs.a));
        let premul = vec3<f32>(rs.r * rs.a, gs.g * gs.a, bs.b * bs.a);
        if (a > 0.0) {
            return vec4<f32>(premul / a, a);
        }
        return vec4<f32>(0.0);
    }

    let warped = distort(uv, k, aspect);
    if (!inBounds(warped)) {
        return vec4<f32>(0.0);
    }
    return textureSampleLevel(u_tex, u_tex_sampler, warped, 0.0);
}
