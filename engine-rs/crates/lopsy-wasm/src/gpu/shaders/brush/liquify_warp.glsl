#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_sourceTex;
uniform vec2 u_center;
uniform float u_size;
uniform float u_strength;
uniform vec2 u_texSize;
uniform int u_mode;    // 0=push, 1=pinch, 2=twirl
uniform vec2 u_dir;    // normalized drag direction (push mode)
out vec4 fragColor;

void main() {
    vec2 fragPos = v_uv * u_texSize;
    float radius = u_size * 0.5;
    vec2 delta = fragPos - u_center;
    float dist = length(delta);

    if (dist > radius) {
        fragColor = texture(u_sourceTex, v_uv);
        return;
    }

    float d = clamp(dist / radius, 0.0, 1.0);
    float falloff = (1.0 - d * d);
    falloff *= falloff;
    float edge = 1.0 - smoothstep(radius - 1.0, radius, dist);
    float t = falloff * edge * u_strength;

    vec2 samplePos;

    if (u_mode == 0) {
        // Push: displace in drag direction
        samplePos = fragPos - u_dir * t * radius * 0.5;
    } else if (u_mode == 1) {
        // Pinch: pull toward center
        vec2 toCenter = (dist > 0.001) ? normalize(delta) : vec2(0.0);
        samplePos = fragPos + toCenter * t * radius * 0.3;
    } else {
        // Twirl: rotate around center
        float angle = t * 1.0;
        float c = cos(angle);
        float s = sin(angle);
        vec2 rotated = vec2(delta.x * c - delta.y * s,
                            delta.x * s + delta.y * c);
        samplePos = u_center + rotated;
    }

    vec2 sampleUV = samplePos / u_texSize;
    if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
        fragColor = texture(u_sourceTex, v_uv);
    } else {
        fragColor = texture(u_sourceTex, sampleUV);
    }
}
