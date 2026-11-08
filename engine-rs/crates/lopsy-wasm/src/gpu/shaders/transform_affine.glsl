#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_floatTex;
uniform vec2 u_floatSize;
// Document position of the float texture's origin. The Move tool's float
// shares the layer's rect; a multi-layer transform's source does not.
uniform vec2 u_floatOffset;
uniform vec2 u_layerOffset;
uniform vec2 u_layerSize;
uniform mat3 u_invMatrix;
uniform vec2 u_srcCenter;   // original bounds center (where source pixels are)
uniform vec2 u_dstCenter;   // srcCenter + translate (where output should appear)
// Document rect (x, y, w, h) of the source pixels; w <= 0 when unknown.
uniform vec4 u_srcRect;

out vec4 fragColor;

//#include premul_sample

// Fraction of the pixel span [p - 0.5, p + 0.5] inside [e0, e1].
float spanCoverage(float p, float e0, float e1) {
    return clamp(min(p + 0.5, e1) - max(p - 0.5, e0), 0.0, 1.0);
}

void main() {
    vec2 layerPos = v_uv * u_layerSize;
    vec2 docPos = layerPos + u_layerOffset;

    // Inverse: input = srcCenter + M⁻¹ * (output - dstCenter)
    vec2 rel = docPos - u_dstCenter;
    vec3 srcRel = u_invMatrix * vec3(rel, 1.0);
    vec2 srcDoc = srcRel.xy + u_srcCenter;

    float a = u_invMatrix[0][0];
    float d = u_invMatrix[1][1];
    bool isAxisAligned = u_srcRect.z > 0.0 && u_srcRect.w > 0.0
        && abs(u_invMatrix[1][0]) < 1e-6 && abs(u_invMatrix[0][1]) < 1e-6
        && abs(a) > 1e-6 && abs(d) > 1e-6;

    // An axis-aligned scale maps the source rect onto a destination rect.
    // Bilinear taps across its edge would blend in the transparent texels
    // outside the source, so an edge on a whole pixel (a pinned side) came
    // out at 75% alpha and the far edge bled half a pixel (#1466). Instead,
    // keep the taps inside the source and weight by exact edge coverage.
    float coverage = 1.0;
    if (isAxisAligned) {
        vec2 s0 = u_srcRect.xy;
        vec2 s1 = u_srcRect.xy + u_srcRect.zw;
        vec2 t = u_invMatrix[2].xy;
        vec2 scale = vec2(a, d);
        vec2 e0 = u_dstCenter + (s0 - u_srcCenter - t) / scale;
        vec2 e1 = u_dstCenter + (s1 - u_srcCenter - t) / scale;
        vec2 lo = min(e0, e1);
        vec2 hi = max(e0, e1);
        coverage = spanCoverage(docPos.x, lo.x, hi.x) * spanCoverage(docPos.y, lo.y, hi.y);
        if (coverage <= 0.0) {
            fragColor = vec4(0.0);
            return;
        }
        vec2 inLo = s0 + 0.5;
        vec2 inHi = max(inLo, s1 - 0.5);
        srcDoc = clamp(srcDoc, inLo, inHi);
    }

    vec2 floatUV = (srcDoc - u_floatOffset) / u_floatSize;

    if (floatUV.x < 0.0 || floatUV.x > 1.0 || floatUV.y < 0.0 || floatUV.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        vec4 c = samplePremulBilinear(u_floatTex, floatUV);
        fragColor = vec4(c.rgb, c.a * coverage);
    }
}
