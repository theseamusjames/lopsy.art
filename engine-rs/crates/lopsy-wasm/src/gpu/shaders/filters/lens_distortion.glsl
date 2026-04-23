#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_strength;
uniform float u_zoom;
uniform float u_fringing;
out vec4 fragColor;

vec2 distort(vec2 uv, float k) {
    vec2 d = (uv - 0.5) / u_zoom;
    float r2 = dot(d, d);
    return 0.5 + d * (1.0 + k * r2);
}

bool inBounds(vec2 uv) {
    return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
}

void main() {
    float k = u_strength;
    if (k > 0.0) {
        k *= 1.0 + 2.0 * k;
    }

    if (abs(u_fringing) > 0.001) {
        float spread = u_fringing * 0.3;
        vec2 uvR = distort(v_uv, k * (1.0 + spread));
        vec2 uvG = distort(v_uv, k);
        vec2 uvB = distort(v_uv, k * (1.0 - spread));

        if (!inBounds(uvR) || !inBounds(uvG) || !inBounds(uvB)) {
            fragColor = vec4(0.0);
        } else {
            float r = texture(u_tex, uvR).r;
            vec4 g = texture(u_tex, uvG);
            float b = texture(u_tex, uvB).b;
            fragColor = vec4(r, g.g, b, g.a);
        }
    } else {
        vec2 uv = distort(v_uv, k);
        if (!inBounds(uv)) {
            fragColor = vec4(0.0);
        } else {
            fragColor = texture(u_tex, uv);
        }
    }
}
