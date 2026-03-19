#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_srcTex;
uniform vec4 u_shadowColor;
uniform vec2 u_offset;     // shadow offset in pixels
uniform float u_blur;      // blur radius in pixels
uniform float u_opacity;
uniform vec2 u_texelSize;  // 1/layerWidth, 1/layerHeight
uniform vec2 u_srcOffset;  // layer position in document pixels
uniform vec2 u_srcSize;    // layer texture size in pixels
uniform vec2 u_docSize;    // document size in pixels
out vec4 fragColor;
void main() {
    // Map document UV to layer-local UV, applying shadow offset
    vec2 docPos = v_uv * u_docSize;
    vec2 layerUV = (docPos - u_srcOffset - u_offset) / u_srcSize;
    // Early out if far from layer bounds (with blur margin)
    vec2 marginUV = (u_blur + 1.0) * u_texelSize;
    if (layerUV.x < -marginUV.x || layerUV.x > 1.0 + marginUV.x ||
        layerUV.y < -marginUV.y || layerUV.y > 1.0 + marginUV.y) {
        fragColor = vec4(0.0);
        return;
    }
    float alpha = 0.0;
    if (u_blur < 0.5) {
        if (layerUV.x >= 0.0 && layerUV.x <= 1.0 && layerUV.y >= 0.0 && layerUV.y <= 1.0) {
            alpha = texture(u_srcTex, layerUV).a;
        }
    } else {
        float total = 0.0;
        int radius = int(ceil(u_blur));
        for (int y = -radius; y <= radius; y++) {
            for (int x = -radius; x <= radius; x++) {
                vec2 sampleUV = layerUV + vec2(float(x), float(y)) * u_texelSize;
                if (sampleUV.x >= 0.0 && sampleUV.x <= 1.0 && sampleUV.y >= 0.0 && sampleUV.y <= 1.0) {
                    alpha += texture(u_srcTex, sampleUV).a;
                }
                total += 1.0;
            }
        }
        alpha = alpha / total;
    }
    fragColor = vec4(u_shadowColor.rgb, alpha * u_shadowColor.a * u_opacity);
}
