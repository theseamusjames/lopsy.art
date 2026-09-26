#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform vec2 u_center;    // normalized center (0.5, 0.5 = image center)
uniform int u_amount;     // number of samples / strength

// Bilinear sample of a straight-alpha texture, interpolated in premultiplied
// space and un-premultiplied on return. The sample offsets below are a
// continuous fraction of the radial direction, so most taps land between
// texel centers — hardware LINEAR filtering there blends straight RGBA and
// bleeds a transparent tap's RGB into the result, same root cause as #815
// (see the affine/perspective transform fix). texelFetch bypasses the
// sampler's own filter mode entirely.
vec4 samplePremulBilinear(sampler2D tex, vec2 uv, vec2 texSize) {
    ivec2 maxP = ivec2(texSize) - 1;
    vec2 p = uv * texSize - 0.5;
    vec2 f = fract(p);
    ivec2 i0 = ivec2(floor(p));
    vec4 c00 = texelFetch(tex, clamp(i0, ivec2(0), maxP), 0);
    vec4 c10 = texelFetch(tex, clamp(i0 + ivec2(1, 0), ivec2(0), maxP), 0);
    vec4 c01 = texelFetch(tex, clamp(i0 + ivec2(0, 1), ivec2(0), maxP), 0);
    vec4 c11 = texelFetch(tex, clamp(i0 + ivec2(1, 1), ivec2(0), maxP), 0);
    vec4 p00 = vec4(c00.rgb * c00.a, c00.a);
    vec4 p10 = vec4(c10.rgb * c10.a, c10.a);
    vec4 p01 = vec4(c01.rgb * c01.a, c01.a);
    vec4 p11 = vec4(c11.rgb * c11.a, c11.a);
    vec4 m = mix(mix(p00, p10, f.x), mix(p01, p11, f.x), f.y);
    if (m.a < 1e-6) return vec4(0.0);
    return vec4(m.rgb / m.a, m.a);
}

void main() {
    vec2 texSize = vec2(textureSize(u_tex, 0));
    vec2 dir = u_center - v_uv;
    int samples = max(1, u_amount);
    float invSamples = 1.0 / float(samples);

    // Average premultiplied color/alpha, then un-premultiply on write — see
    // gaussian_blur.glsl / box_blur.glsl for why (#919).
    vec3 sumRGB = vec3(0.0);
    float sumA = 0.0;
    for (int i = 0; i < samples; i++) {
        float t = float(i) * invSamples;
        vec2 offset = dir * t * 0.1;
        vec4 c = samplePremulBilinear(u_tex, v_uv + offset, texSize);
        sumRGB += c.rgb * c.a;
        sumA += c.a;
    }

    float outA = sumA * invSamples;
    vec3 outRGB = sumA > 1e-6 ? sumRGB / sumA : vec3(0.0);
    fragColor = vec4(outRGB, outA);
}
