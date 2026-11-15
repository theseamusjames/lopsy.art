struct Params {
    // layer texture size in pixels
    u_size: vec2<f32>,
    // burst origin in layer-texture pixels
    u_center: vec2<f32>,
    // distance from origin to the farthest document corner
    u_reach: f32,
    // ray count
    u_rays: f32,
    // radians
    u_rotation: f32,
    // ray length as a fraction of u_reach
    u_length: f32,
    // lit fraction of each ray's angular slot at the base (0-1)
    u_width: f32,
    // 0 = wedge, 0.5 = parallel beam, 1 = spike narrowing to its tip
    u_taper: f32,
    // 0 = solid to the tip, 1 = fades out to nothing at the tip
    u_fade: f32,
    // edge feather as a fraction of the ray's half-width
    u_softness: f32,
    // per-ray length variation (0-1)
    u_jitter: f32,
    u_seed: f32,
    // straight RGB + opacity
    u_rayColor: vec4<f32>,
    // 1 = paint the gaps between rays with u_gapColor
    u_fillGaps: i32,
    u_gapColor: vec3<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

const TAU: f32 = 6.28318530718;

fn rayHash(k: f32) -> f32 {
    var p = fract(vec2<f32>(k * 0.1031, params.u_seed * 0.1137 + 0.37));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
}

fn rayCoverage(pos: vec2<f32>) -> f32 {
    let r = length(pos);
    let slot = TAU / params.u_rays;
    let theta = atan2(pos.y, pos.x) - params.u_rotation;
    let k = floor(theta / slot + 0.5);
    // GLSL's mod; WGSL's % truncates, which differs for a negative k.
    let rayIndex = k - params.u_rays * floor(k / params.u_rays);

    // Each ray gets its own length so a jittered burst looks hand-cut
    // rather than a perfect polygon.
    let rayLen = max(params.u_length * params.u_reach * (1.0 - params.u_jitter * rayHash(rayIndex)), 1.0);
    let t = r / rayLen;
    if (t > 1.0 + 1.0 / rayLen) { return 0.0; }

    // Position in the ray's own frame: distance out along its axis and
    // perpendicular distance from it, in pixels.
    let dTheta = theta - k * slot;
    let along = max(r * cos(dTheta), 0.0);
    let d = r * abs(sin(dTheta));

    // Taper blends the half-width profile from a wedge (grows with distance)
    // to a spike (widest at the origin, zero at the tip). Halfway between,
    // the two cancel into a parallel-sided beam. Measuring against the
    // axis rather than the arc keeps every edge straight; narrowing the
    // wedge's angle instead would bulge the middle into a petal.
    let halfSpread = tan(min(params.u_width * slot * 0.5, 1.55));
    let halfWidth = halfSpread * mix(along, rayLen - along, params.u_taper);

    // A one-pixel minimum feather keeps edges anti-aliased and lets rays
    // blend into each other near the origin where they're sub-pixel.
    let feather = max(params.u_softness * halfWidth * 2.0, 1.0);
    let side = 1.0 - smoothstep(halfWidth - feather * 0.5, halfWidth + feather * 0.5, d);

    let tip = 1.0 - smoothstep(1.0 - 1.0 / rayLen, 1.0, t);
    let fade = mix(1.0, 1.0 - smoothstep(0.0, 1.0, t), params.u_fade);

    return clamp(side * tip * fade, 0.0, 1.0);
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let pos = uv * params.u_size - params.u_center;
    var base = textureSample(u_tex, u_tex_sampler, uv);
    if (params.u_fillGaps == 1) {
        base = vec4<f32>(params.u_gapColor, 1.0);
    }

    let rayA = rayCoverage(pos) * params.u_rayColor.a;

    // Straight-alpha "over": layer textures are not premultiplied.
    let outA = rayA + base.a * (1.0 - rayA);
    if (outA < 1e-5) {
        return vec4<f32>(0.0);
    }
    let outRgb = (params.u_rayColor.rgb * rayA + base.rgb * base.a * (1.0 - rayA)) / outA;
    return vec4<f32>(outRgb, outA);
}
