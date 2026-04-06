#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_floatTex;
uniform vec2 u_floatSize;
uniform vec2 u_layerOffset;
uniform vec2 u_layerSize;
uniform mat3 u_invMatrix;
uniform vec2 u_srcCenter;   // original bounds center (where source pixels are)
uniform vec2 u_dstCenter;   // srcCenter + translate (where output should appear)

out vec4 fragColor;

void main() {
    vec2 layerPos = v_uv * u_layerSize;
    vec2 docPos = layerPos + u_layerOffset;

    // Inverse: input = srcCenter + M⁻¹ * (output - dstCenter)
    vec2 rel = docPos - u_dstCenter;
    vec3 srcRel = u_invMatrix * vec3(rel, 1.0);
    vec2 srcDoc = srcRel.xy + u_srcCenter;

    vec2 floatUV = (srcDoc - u_layerOffset) / u_floatSize;

    if (floatUV.x < 0.0 || floatUV.x > 1.0 || floatUV.y < 0.0 || floatUV.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = texture(u_floatTex, floatUV);
    }
}
