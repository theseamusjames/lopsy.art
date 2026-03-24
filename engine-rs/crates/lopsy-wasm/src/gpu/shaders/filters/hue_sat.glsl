#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_hue;
uniform float u_saturation;
uniform float u_lightness;
out vec4 fragColor;
vec3 rgb2hsl(vec3 c) {
    float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
    float l = (mx + mn) * 0.5;
    if (mx - mn < 0.00001) return vec3(0.0, 0.0, l);
    float d = mx - mn;
    float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    float h;
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    return vec3(h / 6.0, s, l);
}
float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0; if (t > 1.0) t -= 1.0;
    if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
    if (t < 0.5) return q;
    if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
    return p;
}
vec3 hsl2rgb(vec3 hsl) {
    if (hsl.y < 0.00001) return vec3(hsl.z);
    float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
    float p = 2.0 * hsl.z - q;
    return vec3(hue2rgb(p, q, hsl.x + 1.0/3.0), hue2rgb(p, q, hsl.x), hue2rgb(p, q, hsl.x - 1.0/3.0));
}
void main() {
    vec4 c = texture(u_tex, v_uv);
    vec3 hsl = rgb2hsl(c.rgb);
    hsl.x = fract(hsl.x + u_hue / 360.0);
    hsl.y = clamp(hsl.y * (1.0 + u_saturation / 100.0), 0.0, 1.0);
    hsl.z = clamp(hsl.z + u_lightness / 100.0, 0.0, 1.0);
    fragColor = vec4(hsl2rgb(hsl), c.a);
}
