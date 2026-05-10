#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_angle;    // light direction in radians
uniform float u_strength; // relief height 0.0 - 1.0
uniform float u_type;     // 0.0 = emboss, 1.0 = pillow emboss

out vec4 fragColor;

void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_tex, 0));
    vec4 orig = texture(u_tex, v_uv);

    float cosA = cos(u_angle);
    float sinA = sin(u_angle);
    vec2 lightDir = vec2(cosA, sinA);

    // Sample 3x3 neighborhood luminances
    float tl = dot(texture(u_tex, v_uv + vec2(-texel.x, -texel.y)).rgb, vec3(0.299, 0.587, 0.114));
    float tc = dot(texture(u_tex, v_uv + vec2(0.0, -texel.y)).rgb, vec3(0.299, 0.587, 0.114));
    float tr = dot(texture(u_tex, v_uv + vec2(texel.x, -texel.y)).rgb, vec3(0.299, 0.587, 0.114));
    float ml = dot(texture(u_tex, v_uv + vec2(-texel.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float mr = dot(texture(u_tex, v_uv + vec2(texel.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float bl = dot(texture(u_tex, v_uv + vec2(-texel.x, texel.y)).rgb, vec3(0.299, 0.587, 0.114));
    float bc = dot(texture(u_tex, v_uv + vec2(0.0, texel.y)).rgb, vec3(0.299, 0.587, 0.114));
    float br = dot(texture(u_tex, v_uv + vec2(texel.x, texel.y)).rgb, vec3(0.299, 0.587, 0.114));

    // Sobel gradients
    float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
    float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;

    // Directional emboss: dot product of gradient with light direction
    float emboss = dot(vec2(gx, gy), lightDir) * u_strength;

    if (u_type > 0.5) {
        // Pillow emboss: fade the relief toward the edges of opaque regions
        // so the object looks like a raised pillow
        float center = dot(orig.rgb, vec3(0.299, 0.587, 0.114));
        float avgSurround = (tl + tc + tr + ml + mr + bl + bc + br) / 8.0;
        float edgeFade = clamp(abs(center - avgSurround) * 8.0, 0.0, 1.0);
        emboss *= (1.0 - edgeFade * 0.6);
    }

    // Blend emboss highlight/shadow onto original color
    vec3 result = orig.rgb + vec3(emboss);
    result = clamp(result, 0.0, 1.0);

    fragColor = vec4(result, orig.a);
}
