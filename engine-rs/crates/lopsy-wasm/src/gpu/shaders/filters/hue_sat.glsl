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
    vec3 rgb = hsl2rgb(hsl);
    // Lightness blends towards black or white (as Photoshop does) rather than
    // shifting HSL L, which turns pale tints into fully saturated colours.
    float l = u_lightness / 100.0;
    rgb = l < 0.0 ? rgb * (1.0 + l) : rgb + (1.0 - rgb) * l;
    fragColor = vec4(rgb, c.a);
}
