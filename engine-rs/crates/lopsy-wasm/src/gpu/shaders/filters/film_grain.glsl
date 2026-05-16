#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_amount;
uniform float u_size;
uniform float u_roughness;
uniform bool u_monochrome;
uniform float u_seed;
out vec4 fragColor;

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
    highp uvec3 v = pcg3d(uvec3(ip.x, ip.y, ip.x * 0x4F5Du + ip.y * 0x9E37u + s));
    return vec3(v) / 4294967295.0;
}

void main() {
    vec4 c = texture(u_tex, v_uv);

    // Coarsen coordinate space by grain size to create larger grain clumps
    vec2 coord = floor(gl_FragCoord.xy / u_size);

    // Two-octave noise: base + roughness-weighted detail
    vec3 n1 = hash3(coord);
    vec3 n2 = hash3(coord * 2.37 + 131.7);
    vec3 grain = mix(n1, n2, u_roughness) - 0.5;

    // Luminance of the source pixel (Rec. 709)
    float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));

    // Bell-shaped response: strongest in midtones, fades in shadows/highlights
    // This mimics real photographic film where silver halide density peaks
    // in the midtone region
    float response = 4.0 * lum * (1.0 - lum);

    float strength = u_amount * response;

    if (u_monochrome) {
        c.rgb += grain.x * strength;
    } else {
        c.rgb += grain * strength;
    }

    fragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
}
