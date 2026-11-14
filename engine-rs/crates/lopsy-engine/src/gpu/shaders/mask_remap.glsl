#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
layout(std140) uniform Params {
    vec2 u_dstSize;
    vec2 u_srcSize;
    // Inverse map in pixel space: srcPos = u_linear * dstPos + u_offset.
    mat2 u_linear;
    vec2 u_offset;
};
out vec4 fragColor;
void main() {
    vec2 srcUV = (u_linear * (v_uv * u_dstSize) + u_offset) / u_srcSize;
    // Outside a mask's texture the compositor applies no mask, i.e. the
    // layer shows — so area the old mask never covered stays revealed.
    if (srcUV.x < 0.0 || srcUV.x > 1.0 || srcUV.y < 0.0 || srcUV.y > 1.0) {
        fragColor = vec4(1.0);
    } else {
        fragColor = texture(u_tex, srcUV);
    }
}
