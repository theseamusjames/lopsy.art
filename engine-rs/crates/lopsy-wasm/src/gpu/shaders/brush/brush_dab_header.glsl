#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec4 u_brushColor;
uniform float u_opacity;
uniform float u_flow;
uniform float u_hardness;
uniform vec2 u_center;
uniform float u_size;
uniform vec2 u_texSize;
uniform sampler2D u_selectionMask;
uniform int u_hasSelection;
uniform vec2 u_docSize;
uniform vec2 u_layerOffset;
uniform sampler2D u_brushTip;
uniform float u_angle;
uniform vec2 u_tipAspect;
uniform float u_sizeJitter;
uniform float u_angleJitter;
uniform float u_opacityJitter;
uniform sampler2D u_brushTexture;
uniform int u_hasBrushTexture;
uniform float u_textureScale;
uniform int u_textureBlendMode;
uniform vec2 u_brushTextureSize;
out vec4 fragColor;

float dabHash(vec2 center, float seed) {
    return fract(sin(dot(center + seed, vec2(12.9898, 78.233))) * 43758.5453);
}

// Compute rotated + aspect-corrected UV for tip-based brushes.
// Returns UV in [0,1] range. Caller must discard if out of bounds.
vec2 computeTipUV(vec2 fragPos, vec2 center, float jSize, float jAngle) {
    vec2 uv = (fragPos - center) / jSize;
    float ca = cos(jAngle);
    float sa = sin(jAngle);
    uv = mat2(ca, sa, -sa, ca) * uv;
    uv /= u_tipAspect;
    return uv + 0.5;
}

bool tipUVOutOfBounds(vec2 uv) {
    return uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
}

float sampleTipWithHardness(vec2 uv) {
    vec4 tip = texture(u_brushTip, uv);
    float sharp = tip.r;
    float glow = tip.g;
    float softness = (1.0 - u_hardness) * 1.5;
    return sharp * max(1.0 - glow * softness, 0.0);
}

// Distance-based stamp for procedural circles.
// Returns opacity multiplier including hardness falloff and edge AA.
float circleStamp(vec2 fragPos, vec2 center, float radius) {
    float dist = length(fragPos - center);
    if (dist > radius) return -1.0; // signal to discard
    float t = clamp(dist / radius, 0.0, 1.0);
    float stamp;
    if (t <= u_hardness) {
        stamp = 1.0;
    } else {
        float softT = (t - u_hardness) / max(1.0 - u_hardness, 0.001);
        stamp = 1.0 - smoothstep(0.0, 1.0, softT);
    }
    float edge = 1.0 - smoothstep(radius - 1.0, radius, dist);
    return stamp * edge;
}
