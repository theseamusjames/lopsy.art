#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_filtered;
uniform sampler2D u_original;
uniform sampler2D u_selMask;
uniform vec2 u_docSize;
uniform vec2 u_layerOffset;
uniform vec2 u_layerSize;
out vec4 fragColor;
void main() {
    vec4 filtered = texture(u_filtered, v_uv);
    vec4 original = texture(u_original, v_uv);
    // The selection mask is document-sized; the layer texture may be offset
    // from the document or extend past it (#1033).
    vec2 maskUV = (u_layerOffset + v_uv * u_layerSize) / u_docSize;
    bool isOffCanvas = any(lessThan(maskUV, vec2(0.0))) || any(greaterThan(maskUV, vec2(1.0)));
    float mask = isOffCanvas ? 0.0 : texture(u_selMask, maskUV).r;
    fragColor = mix(original, filtered, mask);
}
