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
out vec4 fragColor;
void main() {
    float dilatedA = texture(u_dilatedTex, v_uv).a;

    vec2 docPos = v_uv * u_docSize;
    vec2 origUV = (docPos - u_origOffset) / u_origSize;
    float origA = 0.0;
    if (origUV.x >= 0.0 && origUV.x <= 1.0 && origUV.y >= 0.0 && origUV.y <= 1.0) {
        origA = texture(u_origTex, origUV).a;
    }

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

    float strokeA = u_strokeColor.a * u_opacity;
    if (u_silhouette == 1) {
        float a = isStroke ? strokeA + origA * (1.0 - strokeA) : origA;
        fragColor = vec4(0.0, 0.0, 0.0, a);
    } else if (isStroke) {
        fragColor = vec4(u_strokeColor.rgb, strokeA);
    } else {
        fragColor = vec4(0.0);
    }
}
