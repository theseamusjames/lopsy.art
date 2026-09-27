#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_floatTex;
uniform vec2 u_floatSize;
uniform vec2 u_layerOffset;
uniform vec2 u_layerSize;
uniform vec4 u_origRect;   // x, y, w, h
// Doc space → unit square. A projective (homography) map, not an inverse
// bilinear one: bilinear keeps equal spacing along each edge, so a
// Perspective drag never foreshortened (#927).
uniform mat3 u_quadToSquare;

out vec4 fragColor;

//#include premul_sample

void main() {
    vec2 docPos = v_uv * u_layerSize + u_layerOffset;

    vec3 h = u_quadToSquare * vec3(docPos, 1.0);
    if (h.z <= 1e-9) {
        fragColor = vec4(0.0);
        return;
    }
    vec2 uv = h.xy / h.z;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        fragColor = vec4(0.0);
        return;
    }

    vec2 srcDoc = u_origRect.xy + uv * u_origRect.zw;
    vec2 floatUV = (srcDoc - u_layerOffset) / u_floatSize;

    if (floatUV.x < 0.0 || floatUV.x > 1.0 || floatUV.y < 0.0 || floatUV.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = samplePremulBilinear(u_floatTex, floatUV);
    }
}
