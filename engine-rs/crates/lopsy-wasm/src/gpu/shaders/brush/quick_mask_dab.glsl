#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_maskTex;
uniform float u_size;
uniform float u_hardness;
uniform float u_opacity;
uniform vec2 u_center;
uniform vec2 u_texSize;
uniform int u_mode; // 0 = brush (add), 1 = eraser (remove)

out vec4 fragColor;

void main() {
    vec2 fragPos = v_uv * u_texSize;
    float radius = u_size * 0.5;
    float dist = length(fragPos - u_center);

    if (dist > radius) {
        fragColor = texture(u_maskTex, v_uv);
        return;
    }

    // Quadratic falloff matching brush stamp
    float t = clamp(dist / radius, 0.0, 1.0);
    float soft = 1.0 - t * t;
    float stamp = u_hardness + (1.0 - u_hardness) * soft;

    // Smooth antialiasing at circle edge
    float edge = 1.0 - smoothstep(radius - 1.0, radius, dist);
    stamp *= edge;

    float dabStrength = stamp * u_opacity;
    float existing = texture(u_maskTex, v_uv).r;

    if (u_mode == 0) {
        // Brush: paint white (add to selection) - MAX accumulation
        fragColor = vec4(max(existing, dabStrength), max(existing, dabStrength), max(existing, dabStrength), 1.0);
    } else {
        // Eraser: paint black (remove from selection)
        fragColor = vec4(existing * (1.0 - dabStrength), existing * (1.0 - dabStrength), existing * (1.0 - dabStrength), 1.0);
    }
}
