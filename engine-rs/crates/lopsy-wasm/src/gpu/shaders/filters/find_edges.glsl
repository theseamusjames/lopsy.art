#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;

void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_tex, 0));

    // Sobel kernels
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
    float edge = sqrt(gx*gx + gy*gy);

    vec4 orig = texture(u_tex, v_uv);
    fragColor = vec4(vec3(edge), orig.a);
}
