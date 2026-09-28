#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform vec2 u_size;        // layer texture size in pixels
uniform vec2 u_center;      // burst origin in layer-texture pixels
uniform float u_reach;      // distance from origin to the farthest document corner
uniform float u_rays;       // ray count
uniform float u_rotation;   // radians
uniform float u_length;     // ray length as a fraction of u_reach
uniform float u_width;      // lit fraction of each ray's angular slot at the base (0-1)
uniform float u_taper;      // 0 = wedge, 0.5 = parallel beam, 1 = spike narrowing to its tip
uniform float u_fade;       // 0 = solid to the tip, 1 = fades out to nothing at the tip
uniform float u_softness;   // edge feather as a fraction of the ray's half-width
uniform float u_jitter;     // per-ray length variation (0-1)
uniform float u_seed;
uniform vec4 u_rayColor;    // straight RGB + opacity
uniform int u_fillGaps;     // 1 = paint the gaps between rays with u_gapColor
uniform vec3 u_gapColor;

const float TAU = 6.28318530718;

float rayHash(float k) {
    vec2 p = fract(vec2(k * 0.1031, u_seed * 0.1137 + 0.37));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
}

float rayCoverage(vec2 pos) {
    float r = length(pos);
    float slot = TAU / u_rays;
    float theta = atan(pos.y, pos.x) - u_rotation;
    float k = floor(theta / slot + 0.5);
    float rayIndex = mod(k, u_rays);

    // Each ray gets its own length so a jittered burst looks hand-cut
    // rather than a perfect polygon.
    float rayLen = u_length * u_reach * (1.0 - u_jitter * rayHash(rayIndex));
    rayLen = max(rayLen, 1.0);
    float t = r / rayLen;
    if (t > 1.0 + 1.0 / rayLen) return 0.0;

    // Position in the ray's own frame: distance out along its axis and
    // perpendicular distance from it, in pixels.
    float dTheta = theta - k * slot;
    float along = max(r * cos(dTheta), 0.0);
    float d = r * abs(sin(dTheta));

    // Taper blends the half-width profile from a wedge (grows with distance)
    // to a spike (widest at the origin, zero at the tip). Halfway between,
    // the two cancel into a parallel-sided beam. Measuring against the
    // axis rather than the arc keeps every edge straight; narrowing the
    // wedge's angle instead would bulge the middle into a petal.
    float halfSpread = tan(min(u_width * slot * 0.5, 1.55));
    float halfWidth = halfSpread * mix(along, rayLen - along, u_taper);

    // A one-pixel minimum feather keeps edges anti-aliased and lets rays
    // blend into each other near the origin where they're sub-pixel.
    float feather = max(u_softness * halfWidth * 2.0, 1.0);
    float side = 1.0 - smoothstep(halfWidth - feather * 0.5, halfWidth + feather * 0.5, d);

    float tip = 1.0 - smoothstep(1.0 - 1.0 / rayLen, 1.0, t);
    float fade = mix(1.0, 1.0 - smoothstep(0.0, 1.0, t), u_fade);

    return clamp(side * tip * fade, 0.0, 1.0);
}

void main() {
    vec2 pos = v_uv * u_size - u_center;
    vec4 base = texture(u_tex, v_uv);
    if (u_fillGaps == 1) {
        base = vec4(u_gapColor, 1.0);
    }

    float rayA = rayCoverage(pos) * u_rayColor.a;

    // Straight-alpha "over": layer textures are not premultiplied.
    float outA = rayA + base.a * (1.0 - rayA);
    if (outA < 1e-5) {
        fragColor = vec4(0.0);
        return;
    }
    vec3 outRgb = (u_rayColor.rgb * rayA + base.rgb * base.a * (1.0 - rayA)) / outA;
    fragColor = vec4(outRgb, outA);
}
