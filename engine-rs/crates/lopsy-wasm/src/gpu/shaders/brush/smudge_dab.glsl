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

    // Soft quadratic falloff (matches brush_dab), peaking at 1.0 in the centre
    // and smoothly decaying to 0 at the edge. Cubing it pushes more of the
    // weight into the centre so the outer ring fades out invisibly rather
    // than clamping at a sharp circular silhouette.
    float d = clamp(dist / radius, 0.0, 1.0);
    float soft = 1.0 - d * d;
    soft = soft * soft;

    // 1px smoothstep feather at the outer edge so the dab doesn't terminate
    // with a hard ring against unsmudged pixels.
    float edge = 1.0 - smoothstep(radius - 1.0, radius, dist);
    float t = soft * edge * u_strength;
    t = clamp(t, 0.0, 1.0);

    if (t <= 0.0) {
        fragColor = existing;
        return;
    }

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
