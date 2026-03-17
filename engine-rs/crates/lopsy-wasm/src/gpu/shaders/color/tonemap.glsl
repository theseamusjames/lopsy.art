#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform int u_curve;
out vec4 fragColor;
vec3 pqOETF(vec3 c) {
    float m1 = 0.1593017578125, m2 = 78.84375;
    float c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875;
    vec3 ym1 = pow(max(c, 0.0), vec3(m1));
    return pow((c1 + c2 * ym1) / (1.0 + c3 * ym1), vec3(m2));
}
vec3 hlgOETF(vec3 c) {
    float a = 0.17883277, b = 0.28466892, cc = 0.55991073;
    return mix(sqrt(3.0 * max(c, 0.0)), a * log(max(12.0 * c - b, 0.001)) + cc, step(vec3(1.0/12.0), c));
}
void main() {
    vec4 c = texture(u_tex, v_uv);
    if (u_curve == 0) c.rgb = pqOETF(c.rgb);
    else c.rgb = hlgOETF(c.rgb);
    fragColor = c;
}
