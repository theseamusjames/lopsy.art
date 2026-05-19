#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_srcTex;
uniform sampler2D u_dstTex;
uniform float u_opacity;
// Optional brush texture (applied to stroke before compositing)
uniform sampler2D u_brushTexture;
uniform int u_hasBrushTexture;
uniform float u_textureScale;
uniform int u_textureBlendMode; // 0=multiply, 1=subtract, 2=overlay
uniform vec2 u_brushTextureSize;
uniform vec2 u_strokeTexSize;   // stroke texture size in pixels
uniform vec2 u_layerOffset;     // layer position in document
out vec4 fragColor;

void main() {
    vec4 src = texture(u_srcTex, v_uv);
    vec4 dst = texture(u_dstTex, v_uv);

    // Source (stroke texture) is premultiplied — un-premultiply first
    vec3 srcRGB = src.a > 0.001 ? src.rgb / src.a : vec3(0.0);
    float sa = src.a * u_opacity;
    float da = dst.a;
    float outA = sa + da * (1.0 - sa);

    if (outA < 0.001) {
        fragColor = vec4(0.0);
        return;
    }

    vec3 outRGB = (srcRGB * sa + dst.rgb * da * (1.0 - sa)) / outA;
    fragColor = vec4(outRGB, outA);
}
