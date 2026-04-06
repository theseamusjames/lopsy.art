#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_floatTex;
uniform vec2 u_floatSize;
uniform vec2 u_layerOffset;
uniform vec2 u_layerSize;
uniform vec4 u_origRect;   // x, y, w, h
uniform vec2 u_cornerTL;
uniform vec2 u_cornerTR;
uniform vec2 u_cornerBR;
uniform vec2 u_cornerBL;

out vec4 fragColor;

void main() {
    vec2 docPos = v_uv * u_layerSize + u_layerOffset;

    // Inverse bilinear interpolation via Newton's method.
    // Find (u, v) in [0,1]^2 such that bilerp(corners, u, v) = docPos.
    vec2 uv = vec2(0.5);
    bool converged = false;
    for (int i = 0; i < 6; i++) {
        vec2 top = mix(u_cornerTL, u_cornerTR, uv.x);
        vec2 bot = mix(u_cornerBL, u_cornerBR, uv.x);
        vec2 pos = mix(top, bot, uv.y);

        vec2 dTop = u_cornerTR - u_cornerTL;
        vec2 dBot = u_cornerBR - u_cornerBL;
        vec2 dpdu = mix(dTop, dBot, uv.y);
        vec2 dpdv = mix(u_cornerBL - u_cornerTL, u_cornerBR - u_cornerTR, uv.x);

        float det = dpdu.x * dpdv.y - dpdu.y * dpdv.x;
        if (abs(det) < 1e-6) break;

        vec2 diff = docPos - pos;
        vec2 step = vec2(
            dpdv.y * diff.x - dpdv.x * diff.y,
            dpdu.x * diff.y - dpdu.y * diff.x
        ) / det;
        uv += step;

        if (dot(diff, diff) < 0.01) {
            converged = true;
        }
    }

    // Reject pixels where Newton didn't converge or UV is outside the quad
    if (!converged || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        fragColor = vec4(0.0);
        return;
    }

    vec2 srcDoc = u_origRect.xy + uv * u_origRect.zw;
    vec2 floatUV = (srcDoc - u_layerOffset) / u_floatSize;

    if (floatUV.x < 0.0 || floatUV.x > 1.0 || floatUV.y < 0.0 || floatUV.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = texture(u_floatTex, floatUV);
    }
}
