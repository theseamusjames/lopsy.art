#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec3 u_shadowColor;
uniform vec3 u_highlightColor;
uniform float u_contrast;
out vec4 fragColor;
void main() {
    vec4 c = texture(u_tex, v_uv);
    float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    float mapped = clamp((lum - 0.5) * u_contrast + 0.5, 0.0, 1.0);
    vec3 result = mix(u_shadowColor, u_highlightColor, mapped);
    fragColor = vec4(result, c.a);
}
