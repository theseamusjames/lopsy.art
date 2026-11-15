struct Params {
    // number of mirror segments (2 - 32)
    u_segments: f32,
    // rotation offset in radians
    u_rotation: f32,
    // texture size in pixels, for aspect-correct polar math
    u_size: vec2<f32>,
    // canvas centre in texture UV (not 0.5 when the layer hangs off-canvas)
    u_center: vec2<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

const PI: f32 = 3.14159265359;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    // Polar coordinates relative to the canvas center, in pixel space so a unit
    // of angle/radius means the same physical distance on both axes — UV
    // space alone stretches non-square layers along the long axis.
    let center = params.u_center;
    let pos = (uv - center) * params.u_size;
    let r = length(pos);
    let theta = atan2(pos.y, pos.x);

    // Fold the angle into a wedge of size (2*PI / segments), then mirror
    // alternate wedges so the seams join smoothly. The floor form is GLSL's
    // mod; WGSL's % truncates, which differs for a negative angle.
    let segAngle = 2.0 * PI / max(params.u_segments, 2.0);
    let turned = theta - params.u_rotation;
    var folded = turned - segAngle * floor(turned / segAngle);
    if (folded > segAngle * 0.5) {
        folded = segAngle - folded;
    }

    // Project back to Cartesian in pixel space, then back to UV for sampling.
    // We add the rotation back so the whole kaleidoscope can be spun as a unit.
    let sampleTheta = folded + params.u_rotation;
    let sampled = center + (vec2<f32>(cos(sampleTheta), sin(sampleTheta)) * r) / params.u_size;

    // Outside the source image -> transparent so the effect doesn't wrap
    // garbage from clamp-to-edge sampling.
    if (sampled.x < 0.0 || sampled.x > 1.0 || sampled.y < 0.0 || sampled.y > 1.0) {
        return vec4<f32>(0.0);
    }
    return textureSampleLevel(u_tex, u_tex_sampler, sampled, 0.0);
}
