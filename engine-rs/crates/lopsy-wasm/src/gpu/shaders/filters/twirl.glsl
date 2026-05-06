#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_angle;
uniform float u_radius;
uniform float u_falloff;
out vec4 fragColor;

void main() {
    vec2 center = vec2(0.5);
    vec2 delta = v_uv - center;
    float dist = length(delta);

    float r = u_radius;
    if (dist < r && r > 0.0) {
        float t = 1.0 - dist / r;
        float twist = u_angle * pow(t, u_falloff);
        float s = sin(twist);
        float c = cos(twist);
        delta = vec2(c * delta.x - s * delta.y,
                     s * delta.x + c * delta.y);
    }

    vec2 uv = center + delta;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = texture(u_tex, uv);
    }
}
