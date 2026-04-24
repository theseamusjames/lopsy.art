#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_amplitude;
uniform float u_wavelength;
uniform float u_phase;
uniform float u_angle;
out vec4 fragColor;

void main() {
    vec2 texSize = vec2(textureSize(u_tex, 0));

    float cosA = cos(u_angle);
    float sinA = sin(u_angle);

    vec2 pos = v_uv * texSize;

    float along = pos.x * cosA + pos.y * sinA;

    float displacement = u_amplitude * sin(along / u_wavelength * 6.2831853 + u_phase);

    vec2 offset = vec2(-sinA, cosA) * displacement / texSize;

    vec2 uv = v_uv + offset;

    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = texture(u_tex, uv);
    }
}
