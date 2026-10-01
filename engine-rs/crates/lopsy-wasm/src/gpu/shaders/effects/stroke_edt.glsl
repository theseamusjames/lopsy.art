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
// 1 = output the layer's silhouette grown by the outside part of the stroke
// (alpha only), which the drop shadow and outer glow are cast from.
uniform int u_silhouette;
uniform float u_layerOpacity; // opacity the layer itself is composited with
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

    // Don't clamp pixelCoord — for out-of-bounds pixels (cropped layers),
    // the unclamped position ensures distances are measured correctly.
    ivec2 pixelCoord = ivec2(floor(layerUV * vec2(texSize)));
    bool inBounds = pixelCoord.x >= 0 && pixelCoord.x < texSize.x &&
                    pixelCoord.y >= 0 && pixelCoord.y < texSize.y;
    float srcA = inBounds ? texelFetch(u_srcTex, pixelCoord, 0).a : 0.0;
    bool isOpaque = srcA >= 0.5;

    float halfW = u_position == 2 ? u_width * 0.5 : u_width;
    float thresholdSq = halfW * halfW;
    float minDistSq = thresholdSq + 1.0;
    int maxDist = int(ceil(halfW)) + 1;

    if (halfW <= 20.0) {
        // Brute-force: check every pixel in the search area.
        // For width ≤ 20, the grid is at most 41x41 = 1681 iterations.
        // No ray marching artifacts — every pixel is checked exactly.
        for (int y = -maxDist; y <= maxDist; y++) {
            for (int x = -maxDist; x <= maxDist; x++) {
                float dSq = float(x * x + y * y);
                if (dSq > thresholdSq) continue;
                if (dSq >= minDistSq) continue;

                ivec2 sCoord = pixelCoord + ivec2(x, y);
                // Out-of-bounds = transparent (alpha 0). This ensures edges
                // at cropped layer boundaries are detected correctly.
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
    } else {
        // Ray march for large stroke widths (> 20px).
        // 64 rays with guaranteed cardinal/diagonal coverage.
        const int NUM_RAYS = 64;
        const float TWO_PI = 6.2831853;

        for (int i = 0; i < NUM_RAYS; i++) {
            float angle = float(i) * (TWO_PI / float(NUM_RAYS));
            float dx = cos(angle);
            float dy = sin(angle);
            for (int d = 1; d <= 100; d++) {
                if (d > maxDist) break;
                float fdSq = float(d * d);
                if (fdSq > thresholdSq) break;
                if (fdSq >= minDistSq) break;

                ivec2 sCoord = pixelCoord + ivec2(round(float(d) * dx), round(float(d) * dy));
                float sampleA = 0.0;
                if (sCoord.x >= 0 && sCoord.x < texSize.x &&
                    sCoord.y >= 0 && sCoord.y < texSize.y) {
                    sampleA = texelFetch(u_srcTex, sCoord, 0).a;
                }
                bool sampleOpaque = sampleA >= 0.5;

                if (sampleOpaque != isOpaque) {
                    minDistSq = fdSq;
                    break;
                }
            }
        }
    }

    bool isStroke = false;
    float coverage = 1.0;
    if (u_position == 0) {
        // An outside stroke is composited behind its layer, so it also runs
        // under the layer's partly covered edge pixels (otherwise the
        // backdrop shows through them as a seam between the shape and its
        // stroke) and is knocked out by the layer's coverage, as the hard
        // drop shadow is.
        bool isEdge = isOpaque && srcA < 0.999 && minDistSq <= 2.0;
        isStroke = (!isOpaque && minDistSq <= thresholdSq) || isEdge;
        coverage = (1.0 - srcA) / max(1.0 - srcA * u_layerOpacity, 1e-4);
    } else if (minDistSq <= thresholdSq) {
        isStroke = u_position == 1 ? isOpaque : true;
    }

    float strokeA = u_strokeColor.a * u_opacity;
    if (u_silhouette == 1) {
        // Stroke and layer combine source-over whichever is in front, so the
        // silhouette is their alpha union. An outside ring (edge pixels
        // included) grows it; a centre stroke only outside the opaque core.
        bool grows = isStroke && (u_position == 0 || !isOpaque);
        float a = grows ? strokeA + srcA * (1.0 - strokeA) : srcA;
        fragColor = vec4(0.0, 0.0, 0.0, a);
    } else if (isStroke) {
        fragColor = vec4(u_strokeColor.rgb, strokeA * coverage);
    } else {
        fragColor = vec4(0.0);
    }
}
