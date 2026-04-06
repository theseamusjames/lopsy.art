#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_layerTex;
uniform sampler2D u_maskTex;
uniform int u_hasMask;
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
        float maskVal = texture(u_maskTex, maskUV).r;
        if (maskVal > 0.0) {
            color = vec4(0.0);
        }
    } else {
        // No selection: clear everything
        color = vec4(0.0);
    }

    fragColor = color;
}
