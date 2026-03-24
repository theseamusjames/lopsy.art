#version 300 es
precision highp float;
in vec2 v_uv;
uniform int u_shapeType;
uniform vec2 u_center;
uniform vec2 u_size;
uniform vec4 u_fillColor;
uniform vec4 u_strokeColor;
uniform float u_strokeWidth;
uniform float u_cornerRadius;
uniform vec2 u_texSize;
out vec4 fragColor;
float sdEllipse(vec2 p, vec2 r) {
    vec2 q = abs(p) / r;
    return (length(q) - 1.0) * min(r.x, r.y);
}
float sdRect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
    vec2 pos = v_uv * u_texSize;
    vec2 p = pos - u_center;
    float d;
    if (u_shapeType == 0) d = sdEllipse(p, u_size * 0.5);
    else d = sdRect(p, u_size * 0.5, u_cornerRadius);
    float fill = 1.0 - smoothstep(-0.5, 0.5, d);
    float stroke = 1.0 - smoothstep(u_strokeWidth - 0.5, u_strokeWidth + 0.5, abs(d));
    vec4 color = u_fillColor * fill;
    if (u_strokeWidth > 0.0) color = mix(color, u_strokeColor, stroke * u_strokeColor.a);
    fragColor = color;
}
