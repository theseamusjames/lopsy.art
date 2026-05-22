#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform mat3 u_invH;
uniform vec2 u_outSize;
uniform vec2 u_srcSize;
out vec4 fragColor;
void main() {
    vec2 dst = v_uv * u_outSize;
    vec3 homog = u_invH * vec3(dst, 1.0);
    if (abs(homog.z) < 1e-10) { fragColor = vec4(0.0); return; }
    vec2 src = homog.xy / homog.z;
    vec2 srcUV = src / u_srcSize;
    if (srcUV.x < 0.0 || srcUV.x > 1.0 || srcUV.y < 0.0 || srcUV.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = texture(u_tex, srcUV);
    }
}
