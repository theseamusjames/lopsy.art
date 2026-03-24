#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_layerTex;
uniform sampler2D u_maskTex;
uniform int u_hasMask;
uniform vec4 u_fillColor;
uniform vec2 u_docSize;
uniform vec2 u_layerOffset;
uniform vec2 u_layerSize;
out vec4 fragColor;

void main() {
    vec4 existing = texture(u_layerTex, v_uv);

    float maskVal = 1.0;
    if (u_hasMask == 1) {
        vec2 docPos = u_layerOffset + v_uv * u_layerSize;
        vec2 maskUV = docPos / u_docSize;
        maskVal = texture(u_maskTex, maskUV).r;
        if (maskVal < 0.5) maskVal = 0.0;
        else maskVal = 1.0;
    }

    // Blend fill color over existing using standard alpha compositing
    vec4 fill = vec4(u_fillColor.rgb, u_fillColor.a * maskVal);
    float outA = fill.a + existing.a * (1.0 - fill.a);
    vec3 outRGB = outA > 0.0
        ? (fill.rgb * fill.a + existing.rgb * existing.a * (1.0 - fill.a)) / outA
        : vec3(0.0);
    fragColor = vec4(outRGB, outA);
}
