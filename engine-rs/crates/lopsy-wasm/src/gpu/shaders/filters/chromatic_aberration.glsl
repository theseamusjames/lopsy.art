#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_amount;    // pixel offset magnitude
uniform float u_angle;     // direction in radians
out vec4 fragColor;
void main() {
    vec2 texSize = vec2(textureSize(u_tex, 0));
    vec2 texel = 1.0 / texSize;
    vec2 dir = vec2(cos(u_angle), sin(u_angle));
    vec2 offset = u_amount * texel * dir;
    vec4 rs = texture(u_tex, v_uv + offset);
    vec4 gs = texture(u_tex, v_uv);
    vec4 bs = texture(u_tex, v_uv - offset);
    // Each shifted channel carries its own coverage, so a fringe that moves
    // past a transparent layer's silhouette stays visible (#1043).
    float a = max(rs.a, max(gs.a, bs.a));
    vec3 premul = vec3(rs.r * rs.a, gs.g * gs.a, bs.b * bs.a);
    fragColor = a > 0.0 ? vec4(premul / a, a) : vec4(0.0);
}
