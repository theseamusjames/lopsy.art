#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_amount;
uniform bool u_monochrome;
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

void main() {
    vec4 c = texture(u_tex, v_uv);
    vec2 coord = gl_FragCoord.xy;
    vec3 n = hash3(coord);
    if (u_monochrome) {
        c.rgb += (n.x - 0.5) * u_amount;
    } else {
        c.rgb += (n - 0.5) * u_amount;
    }
    fragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
}
