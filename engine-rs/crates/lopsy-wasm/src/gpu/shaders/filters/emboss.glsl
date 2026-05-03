#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform float u_angle;   // radians
uniform float u_amount;  // 1.0 – 10.0

void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_tex, 0));

    // Rotate the standard emboss kernel offsets by u_angle.
    // Standard emboss light direction is top-left (0° = 0 rad).
    // The base kernel [[-2,-1,0],[-1,1,1],[0,1,2]] corresponds to a
    // light source coming from the direction of angle 0.
    // We rotate the sampling offsets by the angle to change light direction.
    float cosA = cos(u_angle);
    float sinA = sin(u_angle);

    // 3×3 neighbour offsets in kernel order (row-major, top-left first):
    // (-1,-1)  (0,-1)  (1,-1)
    // (-1, 0)  (0, 0)  (1, 0)
    // (-1, 1)  (0, 1)  (1, 1)
    //
    // Emboss kernel weights for those positions (sums to 0 → flat areas → mid-gray):
    // -2  -1   0
    // -1   0   1
    //  0   1   2
    //
    // We rotate the (dx,dy) offsets and keep the weights.
    // Rotation: dx' = cosA*dx - sinA*dy,  dy' = sinA*dx + cosA*dy

    // Sample all 9 neighbours with rotated offsets
    float k[9];
    k[0] = -2.0; k[1] = -1.0; k[2] =  0.0;
    k[3] = -1.0; k[4] =  0.0; k[5] =  1.0;
    k[6] =  0.0; k[7] =  1.0; k[8] =  2.0;

    // Base offsets (col, row) for each kernel position
    float dx[9]; float dy[9];
    dx[0] = -1.0; dy[0] = -1.0;
    dx[1] =  0.0; dy[1] = -1.0;
    dx[2] =  1.0; dy[2] = -1.0;
    dx[3] = -1.0; dy[3] =  0.0;
    dx[4] =  0.0; dy[4] =  0.0;
    dx[5] =  1.0; dy[5] =  0.0;
    dx[6] = -1.0; dy[6] =  1.0;
    dx[7] =  0.0; dy[7] =  1.0;
    dx[8] =  1.0; dy[8] =  1.0;

    float value = 0.0;
    for (int i = 0; i < 9; i++) {
        float rdx = cosA * dx[i] - sinA * dy[i];
        float rdy = sinA * dx[i] + cosA * dy[i];
        vec2 offset = vec2(rdx, rdy) * texel;
        float lum = dot(texture(u_tex, v_uv + offset).rgb, vec3(0.299, 0.587, 0.114));
        value += lum * k[i];
    }

    // Scale by amount and bias to mid-gray (0.5)
    value = value * (u_amount / 1.0) * 0.1 + 0.5;
    value = clamp(value, 0.0, 1.0);

    vec4 orig = texture(u_tex, v_uv);
    fragColor = vec4(vec3(value), orig.a);
}
