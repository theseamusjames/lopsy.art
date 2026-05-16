#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform float u_variance;
uniform float u_strength;
uniform float u_seed;

float hash(float p) {
    p = fract(p * 0.1031 + u_seed * 0.173);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash2(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031 + u_seed * 0.01);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise1d(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), f);
}

float noise2d(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash2(i);
    float b = hash2(i + vec2(1.0, 0.0));
    float c = hash2(i + vec2(0.0, 1.0));
    float d = hash2(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
    vec2 uv = v_uv;

    float strengthNorm = u_strength / 64.0;
    float varianceNorm = u_variance / 64.0;

    float verticalFreq = 80.0 + strengthNorm * 320.0;
    float horizontalWander = (1.0 - strengthNorm) * 0.15;

    float fiber = 0.0;
    float totalWeight = 0.0;

    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float freq = verticalFreq * pow(1.8, fi);
        float amp = 1.0 / pow(1.6, fi);

        float wander = horizontalWander * noise2d(vec2(uv.x * 20.0 + fi * 7.3, uv.y * 3.0 + u_seed));
        float xCoord = uv.x + wander;

        float n = noise1d(xCoord * freq + fi * 100.0 + u_seed * 13.7);
        fiber += n * amp;
        totalWeight += amp;
    }
    fiber /= totalWeight;

    float detail = noise2d(vec2(uv.x * 200.0, uv.y * 8.0) + u_seed * 5.0);
    fiber = mix(fiber, detail, 0.15);

    float colorVariation = noise1d(uv.x * 30.0 + u_seed * 7.0) * varianceNorm;
    fiber = mix(0.5, fiber, 0.5 + varianceNorm * 0.5);
    fiber += (colorVariation - varianceNorm * 0.5) * 0.6;

    fiber = clamp(fiber, 0.0, 1.0);

    vec4 orig = texture(u_tex, v_uv);
    fragColor = vec4(vec3(fiber), orig.a);
}
