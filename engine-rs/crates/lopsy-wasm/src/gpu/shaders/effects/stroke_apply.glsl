#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_dilatedTex;   // dilated alpha (doc-sized)
uniform sampler2D u_origTex;      // original layer texture
uniform vec4 u_strokeColor;
uniform float u_opacity;
uniform int u_position;           // 0=outside (dilated orig), 1=inside (dilated inverted)
uniform vec2 u_origOffset;        // original layer position in document pixels
uniform vec2 u_origSize;          // original layer texture size
uniform vec2 u_docSize;
// 1 = output the layer's silhouette grown by the stroke (alpha only), which
// the drop shadow and outer glow are cast from.
uniform int u_silhouette;
uniform int u_knockout;           // 1 = outside stroke drawn behind the layer
uniform float u_layerOpacity;     // opacity the layer itself is composited with
out vec4 fragColor;

float origAlphaAt(vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return texture(u_origTex, uv).a;
}

void main() {
    float dilatedA = texture(u_dilatedTex, v_uv).a;

    vec2 docPos = v_uv * u_docSize;
    vec2 origUV = (docPos - u_origOffset) / u_origSize;
    float origA = origAlphaAt(origUV);

    bool isOpaque = origA >= 0.5;
    bool isDilated = dilatedA >= 0.5;

    bool isStroke;
    if (u_position == 0) {
        // Outside: dilated original — stroke where expanded but not originally opaque
        isStroke = isDilated && !isOpaque;
    } else {
        // Inside: dilated inverted — stroke where inversion expanded into opaque area
        isStroke = isDilated && isOpaque;
    }

    float coverage = 1.0;
    if (u_knockout == 1) {
        // Behind the layer: also under its partly covered edge pixels, and
        // knocked out by its coverage (see stroke_edt.glsl).
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

    float strokeA = u_strokeColor.a * u_opacity;
    if (u_silhouette == 1) {
        // Stroke and layer combine source-over whichever is in front, so the
        // silhouette is their alpha union; the knockout coverage only shapes
        // the drawn stroke.
        float a = isStroke ? strokeA + origA * (1.0 - strokeA) : origA;
        fragColor = vec4(0.0, 0.0, 0.0, a);
    } else if (isStroke) {
        fragColor = vec4(u_strokeColor.rgb, strokeA * coverage);
    } else {
        fragColor = vec4(0.0);
    }
}
