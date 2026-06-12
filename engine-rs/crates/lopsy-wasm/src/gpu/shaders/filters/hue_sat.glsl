#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_hue;
uniform float u_saturation;
uniform float u_lightness;
out vec4 fragColor;
//#include hsl

void main() {
    vec4 c = texture(u_tex, v_uv);
    vec3 hsl = rgb2hsl(c.rgb);
    hsl.x = fract(hsl.x + u_hue / 360.0);
    hsl.y = clamp(hsl.y * (1.0 + u_saturation / 100.0), 0.0, 1.0);
    hsl.z = clamp(hsl.z + u_lightness / 100.0, 0.0, 1.0);
    fragColor = vec4(hsl2rgb(hsl), c.a);
}
