#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_segments;  // number of mirror segments (2 - 32)
uniform float u_rotation;  // rotation offset in radians
out vec4 fragColor;

const float PI = 3.14159265359;

void main() {
    // Polar coordinates relative to image center
    vec2 center = vec2(0.5, 0.5);
    vec2 pos = v_uv - center;
    float r = length(pos);
    float theta = atan(pos.y, pos.x);

    // Fold the angle into a wedge of size (2*PI / segments), then mirror
    // alternate wedges so the seams join smoothly.
    float segAngle = 2.0 * PI / max(u_segments, 2.0);
    float folded = mod(theta - u_rotation, segAngle);
    if (folded > segAngle * 0.5) {
        folded = segAngle - folded;
    }

    // Project back to Cartesian. We add the rotation back so the whole
    // kaleidoscope can be spun as a unit.
    float sampleTheta = folded + u_rotation;
    vec2 sampled = center + vec2(cos(sampleTheta), sin(sampleTheta)) * r;

    // Outside the source image → transparent so the effect doesn't wrap
    // garbage from clamp-to-edge sampling.
    if (sampled.x < 0.0 || sampled.x > 1.0 || sampled.y < 0.0 || sampled.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = texture(u_tex, sampled);
    }
}
