#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_strength;
uniform float u_zoom;
uniform float u_fringing;
out vec4 fragColor;

// #946: the radius is measured in pixels (normalised by the long side),
// not UV units — on a non-square layer one UV unit spans a different
// number of pixels on each axis, which squashed circles into ellipses.
vec2 distort(vec2 uv, float k, vec2 aspect) {
    vec2 d = (uv - 0.5) / u_zoom;
    vec2 dp = d * aspect;
    float r2 = dot(dp, dp);
    return 0.5 + d * (1.0 + k * r2);
}

bool inBounds(vec2 uv) {
    return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
}

void main() {
    vec2 texSize = vec2(textureSize(u_tex, 0));
    vec2 aspect = texSize / max(texSize.x, texSize.y);
    float k = u_strength;
    if (k > 0.0) {
        k *= 1.0 + 2.0 * k;
    }

    if (abs(u_fringing) > 0.001) {
        float spread = u_fringing * 0.3;
        vec2 uvR = distort(v_uv, k * (1.0 + spread), aspect);
        vec2 uvG = distort(v_uv, k, aspect);
        vec2 uvB = distort(v_uv, k * (1.0 - spread), aspect);

        if (!inBounds(uvR) || !inBounds(uvG) || !inBounds(uvB)) {
            fragColor = vec4(0.0);
        } else {
            float r = texture(u_tex, uvR).r;
            vec4 g = texture(u_tex, uvG);
            float b = texture(u_tex, uvB).b;
            fragColor = vec4(r, g.g, b, g.a);
        }
    } else {
        vec2 uv = distort(v_uv, k, aspect);
        if (!inBounds(uv)) {
            fragColor = vec4(0.0);
        } else {
            fragColor = texture(u_tex, uv);
        }
    }
}
