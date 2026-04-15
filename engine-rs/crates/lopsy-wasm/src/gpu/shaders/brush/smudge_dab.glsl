#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_sourceTex;
uniform vec2 u_center;
uniform vec2 u_prev;
uniform float u_size;
uniform float u_strength;
uniform vec2 u_texSize;
out vec4 fragColor;

void main() {
    vec2 fragPos = v_uv * u_texSize;
    vec4 existing = texture(u_sourceTex, v_uv);

    float radius = u_size * 0.5;
    float dist = length(fragPos - u_center);
    if (dist > radius) {
        fragColor = existing;
        return;
    }

    // Radial falloff: strongest at center, zero at edge.
    float t = (1.0 - dist / radius) * u_strength;
    t = clamp(t, 0.0, 1.0);

    // Sample from the prior dab position: each fragment reads the pixel that
    // was at fragPos - (center - prev) when the previous dab was painted,
    // effectively "dragging" the earlier pixels along the stroke direction.
    vec2 delta = u_center - u_prev;
    vec2 sampleUV = (fragPos - delta) / u_texSize;
    vec4 sampled;
    if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
        sampled = existing;
    } else {
        sampled = texture(u_sourceTex, sampleUV);
    }

    vec3 rgb = mix(existing.rgb, sampled.rgb, t);
    float a = mix(existing.a, sampled.a, t);
    fragColor = vec4(rgb, a);
}
