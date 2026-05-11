#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_mode;
out vec4 fragColor;

#define PI 3.14159265358979

void main() {
    vec2 uv = v_uv;

    if (u_mode < 0.5) {
        // Rectangular to Polar
        // Map UV center (0.5, 0.5) as origin
        // x-axis -> angle, y-axis -> radius
        float angle = uv.x * 2.0 * PI;
        float radius = uv.y;

        vec2 srcUV = vec2(
            0.5 + radius * cos(angle),
            0.5 + radius * sin(angle)
        );

        if (srcUV.x < 0.0 || srcUV.x > 1.0 || srcUV.y < 0.0 || srcUV.y > 1.0) {
            fragColor = vec4(0.0);
        } else {
            fragColor = texture(u_tex, srcUV);
        }
    } else {
        // Polar to Rectangular
        // Convert Cartesian to polar
        vec2 d = uv - 0.5;
        float radius = length(d) * 2.0;
        float angle = atan(d.y, d.x);

        // Normalize angle to [0, 1]
        float normAngle = (angle + PI) / (2.0 * PI);

        vec2 srcUV = vec2(normAngle, radius);

        if (srcUV.y > 1.0) {
            fragColor = vec4(0.0);
        } else {
            fragColor = texture(u_tex, srcUV);
        }
    }
}
