#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_disp;
uniform vec2 u_center;
uniform float u_radius;
uniform float u_pressure;
uniform vec2 u_drag;
uniform int u_mode;
uniform vec2 u_size;

out vec4 fragColor;

const float MAX_DISP = 2048.0;

vec2 decodeDisp(vec4 c) {
    float ndx = (c.r * 256.0 + c.g) / 257.0;
    float ndy = (c.b * 256.0 + c.a) / 257.0;
    return (vec2(ndx, ndy) * 2.0 - 1.0) * MAX_DISP;
}

vec4 encodeDisp(vec2 d) {
    vec2 n = clamp(d / MAX_DISP * 0.5 + 0.5, 0.0, 1.0);
    float ex = n.x * 65535.0;
    float ey = n.y * 65535.0;
    return vec4(
        floor(ex / 256.0) / 255.0,
        mod(ex, 256.0) / 255.0,
        floor(ey / 256.0) / 255.0,
        mod(ey, 256.0) / 255.0
    );
}

float brushWeight(float distSq, float radiusSq) {
    float t = 1.0 - distSq / radiusSq;
    return t * t * t;
}

void main() {
    vec2 pixel = v_uv * u_size;
    float dx = pixel.x - u_center.x;
    float dy = pixel.y - u_center.y;
    float distSq = dx * dx + dy * dy;
    float radiusSq = u_radius * u_radius;

    vec4 current = texture(u_disp, v_uv);

    if (distSq >= radiusSq) {
        fragColor = current;
        return;
    }

    float w = brushWeight(distSq, radiusSq) * u_pressure;
    vec2 disp = decodeDisp(current);

    if (u_mode == 0) {
        disp += u_drag * w;
    } else if (u_mode == 1 || u_mode == 2) {
        float angle = (u_mode == 1) ? 0.05 : -0.05;
        float a = angle * w;
        float cs = cos(a);
        float sn = sin(a);
        float ndx = dx * cs - dy * sn - dx;
        float ndy = dx * sn + dy * cs - dy;
        disp.x += ndx + (disp.x * cs - disp.y * sn - disp.x);
        disp.y += ndy + (disp.x * sn + disp.y * cs - disp.y);
    } else if (u_mode == 3) {
        float dist = sqrt(distSq);
        if (dist > 0.001) {
            disp.x -= (dx / dist) * w * u_radius * 0.1;
            disp.y -= (dy / dist) * w * u_radius * 0.1;
        }
    } else if (u_mode == 4) {
        float dist = sqrt(distSq);
        if (dist > 0.001) {
            disp.x += (dx / dist) * w * u_radius * 0.1;
            disp.y += (dy / dist) * w * u_radius * 0.1;
        }
    }

    fragColor = encodeDisp(disp);
}
