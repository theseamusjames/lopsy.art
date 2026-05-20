#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform sampler2D u_dispMap;
uniform float u_scaleX;
uniform float u_scaleY;
uniform vec2 u_texelSize;
uniform int u_edgeMode; // 0 = transparent, 1 = clamp, 2 = wrap

void main() {
    vec4 disp = texture(u_dispMap, v_uv);

    // Red channel → horizontal, Green channel → vertical
    // Map [0,1] to [-1,1]
    float dx = (disp.r - 0.5) * 2.0 * u_scaleX * u_texelSize.x;
    float dy = (disp.g - 0.5) * 2.0 * u_scaleY * u_texelSize.y;

    vec2 srcUv = v_uv + vec2(dx, dy);

    if (u_edgeMode == 2) {
        srcUv = fract(srcUv);
    } else if (u_edgeMode == 1) {
        srcUv = clamp(srcUv, vec2(0.0), vec2(1.0));
    } else {
        if (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0) {
            fragColor = vec4(0.0);
            return;
        }
    }

    fragColor = texture(u_tex, srcUv);
}
