#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_layerTex;
uniform sampler2D u_maskTex;
uniform int u_hasMask;
// 1 for the Move tool's float: a selection reaching a canvas edge carries on
// past it, so content hanging off that edge moves with the rest (#1131).
// 0 elsewhere: off-canvas texels are outside the selection (#1033).
uniform int u_extendPastCanvas;
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
        vec2 halfTexel = 0.5 / u_docSize;
        bool isOffCanvas = any(lessThan(maskUV, vec2(0.0))) || any(greaterThan(maskUV, vec2(1.0)));
        float maskVal = u_extendPastCanvas == 1
            ? texture(u_maskTex, clamp(maskUV, halfTexel, 1.0 - halfTexel)).r
            : (isOffCanvas ? 0.0 : texture(u_maskTex, maskUV).r);
        // Take the mask as coverage, min(alpha, mask), mirroring
        // clipboard_clear's alpha - mask so copy + clear conserve the pixel.
        // A product would square alpha for a selection built from the
        // layer's own alpha (#1009). The mask is 8-bit while the layer may be
        // RGBA16F, so a mask within one 8-bit step of alpha covers it whole.
        if (maskVal <= 0.0) {
            color.a = 0.0;
        } else if (maskVal < color.a - 1.0 / 255.0) {
            color.a = maskVal;
        }
    }

    fragColor = color;
}
