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

    // Early out if far from layer bounds
    vec2 marginUV = (u_width + 1.0) * u_texelSize;
    if (layerUV.x < -marginUV.x || layerUV.x > 1.0 + marginUV.x ||
        layerUV.y < -marginUV.y || layerUV.y > 1.0 + marginUV.y) {
        fragColor = vec4(0.0);
        return;
    }

    // Current pixel alpha
    float srcA = 0.0;
    if (layerUV.x >= 0.0 && layerUV.x <= 1.0 && layerUV.y >= 0.0 && layerUV.y <= 1.0) {
        srcA = texture(u_srcTex, layerUV).a;
    }
    bool isOpaque = srcA >= 0.5;

    // Search neighborhood for nearest edge
    float halfW = u_position == 2 ? u_width * 0.5 : u_width;
    int radius = int(ceil(halfW));
    float minDistSq = halfW * halfW + 1.0; // start beyond threshold

    for (int y = -radius; y <= radius; y++) {
        for (int x = -radius; x <= radius; x++) {
            float dSq = float(x * x + y * y);
            if (dSq > halfW * halfW) continue;
            if (dSq >= minDistSq) continue;

            vec2 sampleUV = layerUV + vec2(float(x), float(y)) * u_texelSize;
            float sampleA = 0.0;
            if (sampleUV.x >= 0.0 && sampleUV.x <= 1.0 && sampleUV.y >= 0.0 && sampleUV.y <= 1.0) {
                sampleA = texture(u_srcTex, sampleUV).a;
            }
            bool sampleOpaque = sampleA >= 0.5;

            // Found an edge pixel (neighbor differs from current)
            if (sampleOpaque != isOpaque) {
                minDistSq = dSq;
            }
        }
    }

    bool isStroke = false;
    if (minDistSq <= halfW * halfW) {
        if (u_position == 0) {
            // Outside: stroke on transparent pixels near opaque
            isStroke = !isOpaque;
        } else if (u_position == 1) {
            // Inside: stroke on opaque pixels near transparent
            isStroke = isOpaque;
        } else {
            // Center: stroke on both sides of edge
            isStroke = true;
        }
    }

    if (isStroke) {
        fragColor = vec4(u_strokeColor.rgb, u_strokeColor.a * u_opacity);
    } else {
        fragColor = vec4(0.0);
    }
}
