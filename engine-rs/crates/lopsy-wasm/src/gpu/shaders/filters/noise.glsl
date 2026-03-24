#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_amount;
uniform bool u_monochrome;
uniform float u_seed;
out vec4 fragColor;
float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(443.897, 441.423, 437.195) + u_seed);
    p3 += dot(p3, p3.yzx + 19.19);
    return fract((p3.x + p3.y) * p3.z);
}
void main() {
    vec4 c = texture(u_tex, v_uv);
    vec2 coord = v_uv * vec2(textureSize(u_tex, 0));
    if (u_monochrome) {
        float n = (hash(coord) - 0.5) * u_amount;
        c.rgb += n;
    } else {
        c.r += (hash(coord) - 0.5) * u_amount;
        c.g += (hash(coord + vec2(1.0)) - 0.5) * u_amount;
        c.b += (hash(coord + vec2(2.0)) - 0.5) * u_amount;
    }
    fragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
}
