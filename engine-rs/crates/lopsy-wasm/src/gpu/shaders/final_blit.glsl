#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_compositeTex;
uniform vec2 u_resolution;
uniform float u_zoom;
uniform vec2 u_pan;
uniform vec2 u_docSize;
uniform float u_bgAlpha;
uniform float u_seamlessEnabled;
uniform float u_seamlessDim;
uniform vec4 u_channelMask;
// Document color mode: 0 = RGB (also grayscale/indexed), 1 = Lab, 2 = CMYK.
uniform int u_docColorMode;
out vec4 fragColor;

// ─── Native color mode display decode ──────────────────────────────────
// Lab documents store encoded CIELAB in the composite (L in R, a in G, b in B),
// so the screen needs the inverse transform. These constants mirror
// lopsy-core/src/lab.rs exactly — the CPU export path must agree with what the
// display shows.
const vec3 D50_WHITE = vec3(0.9642, 1.0000, 0.8249);
const float LAB_DELTA = 6.0 / 29.0;

const mat3 BRADFORD_D50_TO_D65 = mat3(
     0.9555766, -0.0282895,  0.0122982,
    -0.0230393,  1.0099416, -0.0204830,
     0.0631636,  0.0210077,  1.3299098
);

const mat3 XYZ_D65_TO_SRGB = mat3(
     3.2404542, -0.9692660,  0.0556434,
    -1.5371385,  1.8760108, -0.2040259,
    -0.4985314,  0.0415560,  1.0572252
);

float labFInv(float t) {
    return t > LAB_DELTA ? t * t * t : 3.0 * LAB_DELTA * LAB_DELTA * (t - 4.0 / 29.0);
}

float linearToSrgb(float v) {
    v = clamp(v, 0.0, 1.0);
    return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

vec3 labToSrgb(vec3 encoded) {
    float L = encoded.r * 255.0 / 2.55;
    float a = encoded.g * 255.0 - 128.0;
    float b = encoded.b * 255.0 - 128.0;

    float fy = (L + 16.0) / 116.0;
    vec3 f = vec3(fy + a / 500.0, fy, fy - b / 200.0);
    vec3 xyzD50 = vec3(labFInv(f.x), labFInv(f.y), labFInv(f.z)) * D50_WHITE;
    vec3 linear = XYZ_D65_TO_SRGB * (BRADFORD_D50_TO_D65 * xyzD50);

    return vec3(linearToSrgb(linear.r), linearToSrgb(linear.g), linearToSrgb(linear.b));
}

void main() {
    vec2 screenPos = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution;

    vec2 center = u_resolution * 0.5;
    vec2 canvasPos = (screenPos - center - u_pan) / u_zoom + u_docSize * 0.5;

    // At integer zoom levels, snap to texel centers so GL_LINEAR doesn't
    // interpolate between adjacent composited pixels. Without this, fractional
    // pan offsets cause visible artifacts on anti-aliased edges (text curves).
    float nearestIntZoom = floor(u_zoom + 0.5);
    if (abs(u_zoom - nearestIntZoom) < 0.01) {
        canvasPos = floor(canvasPos) + 0.5;
    }

    vec2 docUV = canvasPos / u_docSize;

    bool seamless = u_seamlessEnabled > 0.5;

    if (!seamless && (docUV.x < 0.0 || docUV.x > 1.0 || docUV.y < 0.0 || docUV.y > 1.0)) {
        fragColor = vec4(0.18, 0.18, 0.18, 1.0);
        return;
    }

    bool isCenterTile = docUV.x >= 0.0 && docUV.x <= 1.0 && docUV.y >= 0.0 && docUV.y <= 1.0;
    vec2 sampleUV = seamless ? fract(docUV) : docUV;

    vec4 color = texture(u_compositeTex, sampleUV);

    // Native color modes store encoded values in the composite; decode to sRGB
    // before the RGB-assuming steps below (channel mask, checkerboard, dither).
    if (u_docColorMode == 1) {
        color.rgb = labToSrgb(color.rgb);
    }

    color = vec4(color.rgb * u_channelMask.rgb, color.a * u_channelMask.a);

    bool isTransparentDoc = u_bgAlpha < 0.999;
    vec2 tileCanvasPos = seamless ? sampleUV * u_docSize : canvasPos;
    if (isTransparentDoc && color.a < 1.0 - 1.0/256.0) {
        vec2 checker = floor(tileCanvasPos / 8.0);
        float check = mod(checker.x + checker.y, 2.0);
        vec3 bg = mix(vec3(0.8), vec3(0.9), check);
        color.rgb = color.rgb * color.a + bg * (1.0 - color.a);
        color.a = 1.0;
    }

    if (seamless && !isCenterTile && u_seamlessDim > 0.5) {
        color = mix(vec4(0.18, 0.18, 0.18, 1.0), color, 0.75);
    }

    vec2 seed = gl_FragCoord.xy;
    float n0 = fract(sin(dot(seed, vec2(12.9898, 78.233))) * 43758.5453);
    float n1 = fract(sin(dot(seed, vec2(63.7264, 10.873))) * 28637.1136);
    float dither = (n0 + n1 - 1.0) / 255.0;
    color.rgb += dither;

    fragColor = color;
}
