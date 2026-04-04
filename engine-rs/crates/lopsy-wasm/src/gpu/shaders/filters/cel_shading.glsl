#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform int u_levels;        // color quantization levels (3-10)
uniform float u_edgeStrength; // edge line strength (0-1)

void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_tex, 0));
    vec4 orig = texture(u_tex, v_uv);

    // Quantize colors
    float levels = float(max(2, u_levels));
    vec3 quantized = floor(orig.rgb * levels + 0.5) / levels;

    // Sobel edge detection
    float tl = dot(texture(u_tex, v_uv + vec2(-texel.x, -texel.y)).rgb, vec3(0.299, 0.587, 0.114));
    float tc = dot(texture(u_tex, v_uv + vec2(0.0, -texel.y)).rgb, vec3(0.299, 0.587, 0.114));
    float tr = dot(texture(u_tex, v_uv + vec2(texel.x, -texel.y)).rgb, vec3(0.299, 0.587, 0.114));
    float ml = dot(texture(u_tex, v_uv + vec2(-texel.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float mr = dot(texture(u_tex, v_uv + vec2(texel.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float bl = dot(texture(u_tex, v_uv + vec2(-texel.x, texel.y)).rgb, vec3(0.299, 0.587, 0.114));
    float bc = dot(texture(u_tex, v_uv + vec2(0.0, texel.y)).rgb, vec3(0.299, 0.587, 0.114));
    float br = dot(texture(u_tex, v_uv + vec2(texel.x, texel.y)).rgb, vec3(0.299, 0.587, 0.114));

    float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
    float gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
    float edge = smoothstep(0.05, 0.15, sqrt(gx*gx + gy*gy));

    // Mix quantized color with edge lines
    vec3 result = mix(quantized, vec3(0.0), edge * u_edgeStrength);
    fragColor = vec4(result, orig.a);
}
