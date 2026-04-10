#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_threshold; // 0.0 - 1.0
out vec4 fragColor;
void main() {
    vec4 c = texture(u_tex, v_uv);
    // Classic darkroom solarize: invert pixels brighter than threshold
    vec3 inverted = 1.0 - c.rgb;
    vec3 result;
    result.r = c.r < u_threshold ? c.r : inverted.r;
    result.g = c.g < u_threshold ? c.g : inverted.g;
    result.b = c.b < u_threshold ? c.b : inverted.b;
    fragColor = vec4(result, c.a);
}
