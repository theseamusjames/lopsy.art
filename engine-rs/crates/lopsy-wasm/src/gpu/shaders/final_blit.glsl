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
    // before the RGB-assuming steps below. Mode 0 is passthrough; the Lab and
    // CMYK phases fill in these branches.
    if (u_docColorMode == 1) {
        // Lab → sRGB decode.
    } else if (u_docColorMode == 2) {
        // CMYK → sRGB decode.
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
