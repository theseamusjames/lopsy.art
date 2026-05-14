#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_dispMap;
uniform float u_scaleX;
uniform float u_scaleY;
uniform int u_mode;
uniform int u_wrap;
out vec4 fragColor;

void main() {
    vec4 disp = texture(u_dispMap, v_uv);
    vec2 texSize = vec2(textureSize(u_tex, 0));
    vec2 texel = 1.0 / texSize;

    vec2 offset;
    if (u_mode == 0) {
        offset = vec2(
            (disp.r - 0.5) * 2.0 * u_scaleX,
            (disp.g - 0.5) * 2.0 * u_scaleY
        );
    } else {
        float lum = dot(disp.rgb, vec3(0.2126, 0.7152, 0.0722));
        offset = vec2(
            (lum - 0.5) * 2.0 * u_scaleX,
            (lum - 0.5) * 2.0 * u_scaleY
        );
    }

    vec2 srcUv = v_uv + offset * texel;

    if (u_wrap == 1) {
        srcUv = fract(srcUv);
    } else {
        if (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0) {
            fragColor = vec4(0.0);
            return;
        }
    }

    fragColor = texture(u_tex, srcUv);
}
