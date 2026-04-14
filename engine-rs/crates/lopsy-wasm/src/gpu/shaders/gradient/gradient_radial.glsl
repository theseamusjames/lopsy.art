#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_existingTex;
uniform sampler2D u_maskTex;
uniform int u_hasMask;
uniform vec2 u_center;
uniform float u_radius;
uniform vec4 u_stops[16];
uniform float u_stopPositions[16];
uniform int u_stopCount;
uniform vec2 u_texSize;
uniform vec2 u_docSize;
uniform vec2 u_layerOffset;
out vec4 fragColor;
void main() {
    vec2 pos = v_uv * u_texSize;
    float t = clamp(length(pos - u_center) / u_radius, 0.0, 1.0);
    vec4 gradColor = u_stops[0];
    for (int i = 1; i < 16; i++) {
        if (i >= u_stopCount) break;
        if (t >= u_stopPositions[i-1]) {
            float seg = (t - u_stopPositions[i-1]) / max(u_stopPositions[i] - u_stopPositions[i-1], 0.001);
            gradColor = mix(u_stops[i-1], u_stops[i], clamp(seg, 0.0, 1.0));
        }
    }

    // Triangular dither to reduce banding when stored in RGBA8 textures.
    vec2 seed = gl_FragCoord.xy;
    float n0 = fract(sin(dot(seed, vec2(12.9898, 78.233))) * 43758.5453);
    float n1 = fract(sin(dot(seed, vec2(63.7264, 10.873))) * 28637.1136);
    float dither = (n0 + n1 - 1.0) / 255.0;
    gradColor.rgb += dither;

    vec4 existing = texture(u_existingTex, v_uv);

    if (u_hasMask == 1) {
        vec2 docPos = u_layerOffset + v_uv * u_texSize;
        vec2 maskUV = docPos / u_docSize;
        float maskVal = step(0.5, texture(u_maskTex, maskUV).r);
        fragColor = mix(existing, gradColor, maskVal);
    } else {
        fragColor = gradColor;
    }
}
