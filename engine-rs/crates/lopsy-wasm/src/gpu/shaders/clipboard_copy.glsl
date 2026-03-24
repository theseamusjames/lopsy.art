#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_layerTex;
uniform sampler2D u_maskTex;
uniform int u_hasMask;
// Layer texture covers [layerOffset .. layerOffset+layerSize] in document space.
// The output covers [boundsOffset .. boundsOffset+boundsSize] in document space.
uniform vec2 u_layerOffset;
uniform vec2 u_layerSize;
uniform vec2 u_boundsOffset;
uniform vec2 u_boundsSize;
uniform vec2 u_docSize;
out vec4 fragColor;

void main() {
    // Document-space coordinate for this output pixel
    vec2 docPos = u_boundsOffset + v_uv * u_boundsSize;

    // Sample layer texture
    vec2 layerUV = (docPos - u_layerOffset) / u_layerSize;
    vec4 color = vec4(0.0);
    if (layerUV.x >= 0.0 && layerUV.x <= 1.0 && layerUV.y >= 0.0 && layerUV.y <= 1.0) {
        color = texture(u_layerTex, layerUV);
    }

    // Apply selection mask if present
    if (u_hasMask == 1) {
        vec2 maskUV = docPos / u_docSize;
        float maskVal = texture(u_maskTex, maskUV).r;
        // Hard threshold at 0.5 (128/255) to match JS behavior
        if (maskVal < 0.5) {
            color = vec4(0.0);
        }
    }

    fragColor = color;
}
