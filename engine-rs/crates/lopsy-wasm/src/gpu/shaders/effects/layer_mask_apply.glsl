#version 300 es
precision highp float;
// Copy a layer texture with its layer mask multiplied into alpha, in the
// layer's own texture space. Effects (glow, shadow, stroke) sample this copy
// so they follow the visible, masked silhouette.
in vec2 v_uv;
uniform sampler2D u_srcTex;
uniform sampler2D u_maskTex;
// The layer texture covers [layerOffset .. layerOffset+layerSize] in document
// space; the mask covers [maskOffset .. maskOffset+maskSize].
uniform vec2 u_layerOffset;
uniform vec2 u_layerSize;
uniform vec2 u_maskOffset;
uniform vec2 u_maskSize;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_srcTex, v_uv);
    vec2 docPos = u_layerOffset + v_uv * u_layerSize;
    vec2 maskUV = (docPos - u_maskOffset) / u_maskSize;
    // Matches blend.glsl: outside the mask's extent the layer is hidden.
    if (maskUV.x >= 0.0 && maskUV.x <= 1.0 && maskUV.y >= 0.0 && maskUV.y <= 1.0) {
        color.a *= texture(u_maskTex, maskUV).r;
    } else {
        color.a = 0.0;
    }
    fragColor = color;
}
