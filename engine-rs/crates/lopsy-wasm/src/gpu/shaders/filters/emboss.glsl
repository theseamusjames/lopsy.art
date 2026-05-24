#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_angle;    // light direction in radians
uniform float u_strength; // relief depth 0.0 - 1.0
uniform float u_type;     // 0.0 = emboss, 1.0 = pillow emboss

out vec4 fragColor;

void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_tex, 0));
    vec4 orig = texture(u_tex, v_uv);

    vec2 lightDir = vec2(cos(u_angle), sin(u_angle));

    // Strength controls the sampling distance — wider offset = wider bevel.
    // Quadratic curve so the upper half of the slider is more dramatic.
    float t = u_strength * u_strength;
    float radius = 1.0 + t * 20.0;
    vec2 offset = lightDir * texel * radius;

    // Two-point directional luminance difference along the light vector.
    // Max magnitude is bounded by the luminance range (0–1) so it won't
    // clip the way a Sobel kernel does.
    vec3 lumW = vec3(0.299, 0.587, 0.114);
    float lumFwd = dot(texture(u_tex, v_uv + offset).rgb, lumW);
    float lumBwd = dot(texture(u_tex, v_uv - offset).rgb, lumW);
    float diff = lumFwd - lumBwd;

    // Normal emboss: directional (highlight one side, shadow the other).
    // Pillow emboss: raised ridges along all edges (highlights both sides).
    float emboss = (u_type > 0.5 ? abs(diff) : diff) * 0.75;

    vec3 result = clamp(orig.rgb + vec3(emboss), 0.0, 1.0);
    fragColor = vec4(result, orig.a);
}
