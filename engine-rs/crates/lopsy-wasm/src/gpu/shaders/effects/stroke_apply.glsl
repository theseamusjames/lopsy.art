#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_bandTex;      // alpha 1 within the stroke reach of the seeds (separable_edt.glsl)
uniform sampler2D u_origTex;      // original layer texture
layout(std140) uniform Params {
    vec4 u_strokeColor;
    float u_opacity;
    int u_position; // 0=outside (band around orig), 1=inside (band around inverted)
    vec2 u_origOffset; // original layer position in document pixels
    vec2 u_origSize; // original layer texture size
    vec2 u_docSize;
    // 1 = output the layer's silhouette grown by the stroke (alpha only), which
    // the drop shadow and outer glow are cast from.
    int u_silhouette;
    int u_knockout; // 1 = outside stroke drawn behind the layer
    float u_layerOpacity; // opacity the layer itself is composited with
};
out vec4 fragColor;

float origAlphaAt(vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return texture(u_origTex, uv).a;
}

void main() {
    float bandA = texture(u_bandTex, v_uv).a;

    vec2 docPos = v_uv * u_docSize;
    vec2 origUV = (docPos - u_origOffset) / u_origSize;
    float origA = origAlphaAt(origUV);

    bool isOpaque = origA >= 0.5;
    bool isInBand = bandA >= 0.5;

    bool isStroke;
    if (u_position == 0) {
        // Outside: band around the opaque pixels, less the pixels themselves
        isStroke = isInBand && !isOpaque;
    } else {
        // Inside: band around the transparent pixels, within the opaque area
        isStroke = isInBand && isOpaque;
    }

    float coverage = 1.0;
    if (u_knockout == 1) {
        // Behind the layer: also under its partly covered edge pixels, and
        // knocked out by its coverage, as the hard drop shadow is.
        bool isEdge = false;
        if (isOpaque && origA < 0.999) {
            vec2 texel = 1.0 / u_origSize;
            for (int y = -1; y <= 1; y++) {
                for (int x = -1; x <= 1; x++) {
                    if (origAlphaAt(origUV + vec2(float(x), float(y)) * texel) < 0.5) isEdge = true;
                }
            }
        }
        isStroke = isStroke || isEdge;
        coverage = (1.0 - origA) / max(1.0 - origA * u_layerOpacity, 1e-4);
    }

    // Inside: the shape's faint edge pixels (alpha below 0.5) beside the
    // ring are seeds of the inverted band, so they are in it but not opaque.
    // Drawn over the layer, they would keep the fill colour as a fringe
    // outside the ring; they take the stroke, ramped by their coverage so
    // the ring's outer edge stays anti-aliased.
    bool isFaintEdge = false;
    if (u_position == 1 && u_knockout == 0 && !isOpaque && origA > 0.0) {
        vec2 texel = 1.0 / u_origSize;
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                if (origAlphaAt(origUV + vec2(float(x), float(y)) * texel) >= 0.5) isFaintEdge = true;
            }
        }
    }

    float strokeA = u_strokeColor.a * u_opacity;
    if (u_silhouette == 1) {
        // Stroke and layer combine source-over whichever is in front, so the
        // silhouette is their alpha union; the knockout coverage only shapes
        // the drawn stroke.
        float a = isStroke ? strokeA + origA * (1.0 - strokeA) : origA;
        fragColor = vec4(0.0, 0.0, 0.0, a);
    } else if (isStroke) {
        fragColor = vec4(u_strokeColor.rgb, strokeA * coverage);
    } else if (isFaintEdge) {
        fragColor = vec4(u_strokeColor.rgb, strokeA * min(origA * 2.0, 1.0));
    } else {
        fragColor = vec4(0.0);
    }
}
