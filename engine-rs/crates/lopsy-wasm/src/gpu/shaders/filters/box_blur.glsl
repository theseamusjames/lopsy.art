#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_direction;
uniform int u_radius;
uniform int u_step;
out vec4 fragColor;
void main() {
    vec2 texelSize = 1.0 / vec2(textureSize(u_tex, 0));
    int step = max(u_step, 1);
    // Average premultiplied color/alpha, then un-premultiply on write —
    // averaging straight RGB directly pulls a transparent tap's (often
    // black) RGB into the average and leaves a dark halo (#919).
    vec3 sumRGB = vec3(0.0);
    float sumA = 0.0;
    float count = 0.0;
    for (int i = -63; i <= 63; i++) {
        if (i < -u_radius || i > u_radius) continue;
        vec4 c = texture(u_tex, v_uv + u_direction * float(i * step) * texelSize);
        sumRGB += c.rgb * c.a;
        sumA += c.a;
        count += 1.0;
    }
    float outA = sumA / count;
    vec3 outRGB = sumA > 1e-6 ? sumRGB / sumA : vec3(0.0);
    fragColor = vec4(outRGB, outA);
}
