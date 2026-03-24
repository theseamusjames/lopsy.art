#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
// Map output UV [0,1] to source UV via: srcUV = v_uv * u_scale + u_offset
uniform vec2 u_scale;
uniform vec2 u_offset;
out vec4 fragColor;
void main() {
    vec2 srcUV = v_uv * u_scale + u_offset;
    if (srcUV.x < 0.0 || srcUV.x > 1.0 || srcUV.y < 0.0 || srcUV.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = texture(u_tex, srcUV);
    }
}
