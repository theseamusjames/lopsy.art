#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_amount;
uniform bool u_monochrome;
// #668 — 0: uniform distribution (previous default); 1: Gaussian via
// Box-Muller. Gaussian noise is visually softer and looks more like
// real sensor / film grain.
uniform bool u_gaussian;
uniform float u_seed;
out vec4 fragColor;

// PCG3D — Jarzynski & Olano, "Hash Functions for GPU Rendering" (JCGT 2020)
// Cross-dimensional multiply ensures no axis-aligned correlation.
highp uvec3 pcg3d(highp uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    return v;
}

vec3 hash3(vec2 p) {
    highp uvec2 ip = uvec2(p);
    highp uint s = floatBitsToUint(u_seed);
    // Mix x and y into the third input so PCG3D's cross-multiply has
    // entropy in all three lanes even when seed is zero.
    highp uvec3 v = pcg3d(uvec3(ip.x, ip.y, ip.x * 0x4F5Du + ip.y * 0x9E37u + s));
    return vec3(v) / 4294967295.0;
}

// Convert two uniform values in (0,1] into one Gaussian sample via
// Box-Muller. We use only the cos branch — the sin branch is discarded
// (single sample per invocation) which is fine here since we call this
// for each channel with a separate pair of uniforms.
float gaussian_from_uniform(float u1, float u2) {
    // Nudge u1 off zero so log() stays finite.
    float safe_u1 = max(u1, 1.0e-6);
    // Scale down so ±3σ maps to ±0.5 amplitude (matches uniform range).
    return sqrt(-2.0 * log(safe_u1)) * cos(6.28318530718 * u2) * (1.0 / 6.0);
}

void main() {
    vec4 c = texture(u_tex, v_uv);
    vec2 coord = gl_FragCoord.xy;
    vec3 n1 = hash3(coord);
    if (u_gaussian) {
        // Need a second batch of uniforms for the sin/cos pair.
        vec3 n2 = hash3(coord + vec2(37.0, 71.0));
        if (u_monochrome) {
            float g = gaussian_from_uniform(n1.x, n2.x);
            c.rgb += vec3(g) * u_amount;
        } else {
            c.r += gaussian_from_uniform(n1.x, n2.x) * u_amount;
            c.g += gaussian_from_uniform(n1.y, n2.y) * u_amount;
            c.b += gaussian_from_uniform(n1.z, n2.z) * u_amount;
        }
    } else {
        if (u_monochrome) {
            c.rgb += (n1.x - 0.5) * u_amount;
        } else {
            c.rgb += (n1 - 0.5) * u_amount;
        }
    }
    fragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
}
