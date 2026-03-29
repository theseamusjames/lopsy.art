#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_stampTex;
uniform sampler2D u_layerTex;
uniform float u_opacity;
uniform vec2 u_center;
uniform float u_size;
uniform vec2 u_texSize;
uniform sampler2D u_selectionMask;
uniform int u_hasSelection;
uniform vec2 u_docSize;
uniform vec2 u_layerOffset;
out vec4 fragColor;

void main() {
    vec2 fragPos = v_uv * u_texSize;
    vec4 existing = texture(u_layerTex, v_uv);

    vec2 dabMin = u_center - u_size * 0.5;
    vec2 dabMax = u_center + u_size * 0.5;

    if (fragPos.x < dabMin.x || fragPos.x > dabMax.x ||
        fragPos.y < dabMin.y || fragPos.y > dabMax.y) {
        fragColor = existing;
        return;
    }

    // Check selection mask
    if (u_hasSelection == 1) {
        vec2 docPos = fragPos + u_layerOffset;
        vec2 selUV = docPos / u_docSize;
        if (selUV.x < 0.0 || selUV.x > 1.0 || selUV.y < 0.0 || selUV.y > 1.0) {
            fragColor = existing;
            return;
        }
        float selMask = texture(u_selectionMask, selUV).r;
        if (selMask < 0.004) {
            fragColor = existing;
            return;
        }
    }

    vec2 stampUV = (fragPos - dabMin) / u_size;
    float stamp = texture(u_stampTex, stampUV).r;
    float eraseAmount = stamp * u_opacity;

    // Modulate erase by selection mask for soft edges
    if (u_hasSelection == 1) {
        vec2 docPos = fragPos + u_layerOffset;
        vec2 selUV = docPos / u_docSize;
        float selMask = texture(u_selectionMask, selUV).r;
        eraseAmount *= selMask;
    }

    fragColor = vec4(existing.rgb, existing.a * (1.0 - eraseAmount));
}
