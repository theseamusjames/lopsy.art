#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_amount;
uniform float u_bands;
uniform float u_seed;
uniform float u_rgbSplit;
out vec4 fragColor;

float hash(float n) {
    return fract(sin(n * 12.9898 + u_seed * 78.233) * 43758.5453);
}

void main() {
    vec2 texSize = vec2(textureSize(u_tex, 0));
    float texelX = 1.0 / texSize.x;

    float bandIndex = floor(v_uv.y * u_bands);

    float h = hash(bandIndex + 0.5);
    float bandOn = step(0.6, hash(bandIndex * 3.0 + 0.7));
    float offset = (h * 2.0 - 1.0) * u_amount * texelX * bandOn;

    float split = u_rgbSplit * abs(offset) * 0.5;

    vec2 uvR = vec2(clamp(v_uv.x + offset + split, 0.0, 1.0), v_uv.y);
    vec2 uvG = vec2(clamp(v_uv.x + offset, 0.0, 1.0), v_uv.y);
    vec2 uvB = vec2(clamp(v_uv.x + offset - split, 0.0, 1.0), v_uv.y);

    float r = texture(u_tex, uvR).r;
    vec4 center = texture(u_tex, uvG);
    float b = texture(u_tex, uvB).b;

    fragColor = vec4(r, center.g, b, center.a);
}
