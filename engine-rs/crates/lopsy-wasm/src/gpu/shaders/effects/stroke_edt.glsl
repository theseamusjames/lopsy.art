#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_srcTex;
uniform vec4 u_strokeColor;
uniform float u_width;      // stroke width in pixels
uniform int u_position;     // 0=outside, 1=inside, 2=center
uniform float u_opacity;
uniform vec2 u_texelSize;   // 1/layerWidth, 1/layerHeight
uniform vec2 u_srcOffset;   // layer position in document pixels
uniform vec2 u_srcSize;     // layer texture size in pixels
uniform vec2 u_docSize;     // document size in pixels
out vec4 fragColor;

void main() {
    vec2 docPos = v_uv * u_docSize;
    vec2 layerUV = (docPos - u_srcOffset) / u_srcSize;
    ivec2 texSize = textureSize(u_srcTex, 0);

    // Early out if far from layer bounds
    vec2 marginUV = (u_width + 1.0) * u_texelSize;
    if (layerUV.x < -marginUV.x || layerUV.x > 1.0 + marginUV.x ||
        layerUV.y < -marginUV.y || layerUV.y > 1.0 + marginUV.y) {
        fragColor = vec4(0.0);
        return;
    }

    // Use texelFetch for exact pixel-level edge detection (no interpolation)
    ivec2 pixelCoord = ivec2(layerUV * vec2(texSize));
    float srcA = 0.0;
    if (pixelCoord.x >= 0 && pixelCoord.x < texSize.x &&
        pixelCoord.y >= 0 && pixelCoord.y < texSize.y) {
        srcA = texelFetch(u_srcTex, pixelCoord, 0).a;
    }
    bool isOpaque = srcA >= 0.5;

    float halfW = u_position == 2 ? u_width * 0.5 : u_width;
    int radius = min(int(ceil(halfW)), 16); // Cap at 16 to avoid GPU timeout
    float thresholdSq = halfW * halfW;
    float minDistSq = thresholdSq + 1.0;

    for (int y = -radius; y <= radius; y++) {
        for (int x = -radius; x <= radius; x++) {
            float dSq = float(x * x + y * y);
            if (dSq > thresholdSq) continue;
            if (dSq >= minDistSq) continue;

            ivec2 sCoord = pixelCoord + ivec2(x, y);
            float sampleA = 0.0;
            if (sCoord.x >= 0 && sCoord.x < texSize.x &&
                sCoord.y >= 0 && sCoord.y < texSize.y) {
                sampleA = texelFetch(u_srcTex, sCoord, 0).a;
            }
            bool sampleOpaque = sampleA >= 0.5;

            if (sampleOpaque != isOpaque) {
                minDistSq = dSq;
            }
        }
    }

    bool isStroke = false;
    if (minDistSq <= thresholdSq) {
        if (u_position == 0) {
            isStroke = !isOpaque;
        } else if (u_position == 1) {
            isStroke = isOpaque;
        } else {
            isStroke = true;
        }
    }

    if (isStroke) {
        fragColor = vec4(u_strokeColor.rgb, u_strokeColor.a * u_opacity);
    } else {
        fragColor = vec4(0.0);
    }
}
