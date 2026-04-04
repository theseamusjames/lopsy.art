#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform float u_scale;
uniform float u_seed;
uniform float u_turbulence;

float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031 + u_seed * 0.01);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;

    for (int i = 0; i < 8; i++) {
        value += amplitude * noise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

void main() {
    vec2 uv = v_uv * u_scale;

    // Turbulent displacement for smoke-like swirling
    float dx = fbm(uv + vec2(3.7, 1.2)) * u_turbulence;
    float dy = fbm(uv + vec2(8.3, 2.8)) * u_turbulence;
    float smoke = fbm(uv + vec2(dx, dy));

    // Smoother, more wispy look
    smoke = smoothstep(0.2, 0.8, smoke);
    smoke *= smoke;

    vec4 orig = texture(u_tex, v_uv);
    fragColor = vec4(vec3(smoke), orig.a);
}
