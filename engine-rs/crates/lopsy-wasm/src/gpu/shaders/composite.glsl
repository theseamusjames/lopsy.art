#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_srcTex;
uniform sampler2D u_dstTex;
uniform float u_opacity;
out vec4 fragColor;

void main() {
    vec4 src = texture(u_srcTex, v_uv);
    vec4 dst = texture(u_dstTex, v_uv);

    float sa = src.a * u_opacity;
    float da = dst.a;
    float outA = sa + da * (1.0 - sa);

    if (outA < 0.001) {
        fragColor = vec4(0.0);
        return;
    }

    vec3 outRGB = (src.rgb * sa + dst.rgb * da * (1.0 - sa)) / outA;
    fragColor = vec4(outRGB, outA);
}
