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
uniform int u_hasBrushTip;
uniform float u_angle;
uniform vec2 u_tipAspect; // (tipWidth/max, tipHeight/max) for non-square tips
// Jitter uniforms (0.0–1.0 range, mapped from 0–100%)
uniform float u_sizeJitter;
uniform float u_angleJitter;
uniform float u_opacityJitter;
// Texture uniforms
uniform sampler2D u_brushTexture;
uniform int u_hasBrushTexture;
uniform float u_textureScale;
uniform int u_textureBlendMode; // 0=multiply, 1=subtract, 2=overlay
uniform vec2 u_brushTextureSize;
out vec4 fragColor;

float dabHash(vec2 center, float seed) {
    return fract(sin(dot(center + seed, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec2 fragPos = v_uv * u_texSize;

    // Per-dab deterministic random values seeded from dab center
    float h1 = dabHash(u_center, 0.0);
    float h2 = dabHash(u_center, 127.1);
    float h3 = dabHash(u_center, 269.5);

    float jSize = u_size * (1.0 - u_sizeJitter * (1.0 - h1));
    jSize = max(1.0, jSize);
    // Base opacity is applied at stroke composite time, not per-dab.
    // Opacity jitter modulates per-dab intensity (0–1) within MAX accumulation.
    float jOpacity = u_opacityJitter > 0.0
        ? (1.0 - u_opacityJitter * (1.0 - h2))
        : 1.0;
    float jAngle = u_angle + (h3 - 0.5) * 2.0 * u_angleJitter * 3.14159265;

    float radius = jSize * 0.5;
    float dist = length(fragPos - u_center);

    float a;

    if (u_hasBrushTip == 1) {
        // Custom brush tip texture mode
        vec2 uv = (fragPos - u_center) / jSize;
        float ca = cos(jAngle);
        float sa = sin(jAngle);
        uv = mat2(ca, sa, -sa, ca) * uv;
        uv /= u_tipAspect;
        uv = uv + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;

        float stamp = texture(u_brushTip, uv).r;
        // Apply hardness as a radial falloff on tip — softens edges
        // without clipping non-circular shapes
        if (u_hardness < 0.99) {
            float tipDist = length(uv - 0.5) * 2.0;
            if (tipDist > u_hardness) {
                float ft = (tipDist - u_hardness) / max(1.0 - u_hardness, 0.001);
                float fs = ft * ft * (3.0 - 2.0 * ft);
                stamp *= clamp(1.0 - fs, 0.0, 1.0);
            }
        }
        a = stamp * u_flow * jOpacity;
    } else {
        // Procedural circle mode
        if (dist > radius) discard;

        float t = clamp(dist / radius, 0.0, 1.0);
        float stamp;
        if (t <= u_hardness) {
            stamp = 1.0;
        } else {
            float softT = (t - u_hardness) / max(1.0 - u_hardness, 0.001);
            stamp = 1.0 - smoothstep(0.0, 1.0, softT);
        }

        // Smooth antialiasing at circle edge (1px feather)
        float edge = 1.0 - smoothstep(radius - 1.0, radius, dist);
        stamp *= edge;

        a = stamp * u_flow * jOpacity;
    }

    // Selection mask constraint
    if (u_hasSelection == 1) {
        vec2 docPos = fragPos + u_layerOffset;
        vec2 selUV = docPos / u_docSize;
        if (selUV.x < 0.0 || selUV.x > 1.0 || selUV.y < 0.0 || selUV.y > 1.0) discard;
        float selMask = texture(u_selectionMask, selUV).r;
        if (selMask < 0.004) discard;
        a *= selMask;
    }

    // Premultiplied alpha output for (ONE, ONE_MINUS_SRC_ALPHA) blending
    // during dab accumulation on the stroke texture.
    fragColor = vec4(u_brushColor.rgb * a, a);
}
