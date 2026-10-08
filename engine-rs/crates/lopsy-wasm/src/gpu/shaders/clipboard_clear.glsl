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
uniform vec2 u_docSize;
uniform vec2 u_layerOffset;
uniform vec2 u_layerSize;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_layerTex, v_uv);

    if (u_hasMask == 1) {
        // Convert layer UV to document-space, then to mask UV
        vec2 docPos = u_layerOffset + v_uv * u_layerSize;
        vec2 maskUV = docPos / u_docSize;
        vec2 halfTexel = 0.5 / u_docSize;
        bool isOffCanvas = any(lessThan(maskUV, vec2(0.0))) || any(greaterThan(maskUV, vec2(1.0)));
        float maskVal = u_extendPastCanvas == 1
            ? texture(u_maskTex, clamp(maskUV, halfTexel, 1.0 - halfTexel)).r
            : (isOffCanvas ? 0.0 : texture(u_maskTex, maskUV).r);
        // Subtract the mask as coverage: anti-aliased and feathered selections
        // on opaque pixels leave a soft 1 - mask edge, while a selection loaded
        // from the layer's own alpha (mask == alpha) clears the pixel instead of
        // leaving an alpha * (1 - alpha) ghost. The one-step slack absorbs the
        // 8-bit mask quantizing a 16-bit float alpha.
        float remaining = color.a - maskVal;
        if (maskVal <= 0.0) {
            // Outside the selection: untouched.
        } else if (remaining <= 1.0 / 255.0) {
            color = vec4(0.0);
        } else {
            color.a = remaining;
        }
    } else {
        // No selection: clear everything
        color = vec4(0.0);
    }

    fragColor = color;
}
