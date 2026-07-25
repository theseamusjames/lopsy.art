#version 300 es
precision highp float;

// BLEND_MODE is injected as a compile-time #define by shader.rs
// (compile_program_with_defines) — one program variant per blend mode,
// so the mode is selected at compile time instead of per pixel.
#ifndef BLEND_MODE
#define BLEND_MODE 0
#endif

in vec2 v_uv;
uniform sampler2D u_srcTex;
uniform sampler2D u_dstTex;
uniform float u_opacity;
uniform vec2 u_srcOffset;  // layer position in document pixels
uniform vec2 u_srcSize;    // layer texture size in pixels
uniform vec2 u_docSize;    // document size in pixels
uniform int u_srcPremultiplied; // 1 if source is premultiplied alpha
// When 1, the layer texture wraps modularly across the document — content
// that overhangs one edge appears on the opposite side. Enabled by the
// "Wrap" checkbox next to "Dim pattern" in the seamless-preview options.
uniform int u_wrapLayer;
uniform int u_overlayEnabled;   // 1 if color overlay is active
uniform vec3 u_overlayColor;    // overlay color (RGB)
uniform float u_overlayOpacity; // overlay mix factor
uniform sampler2D u_maskTex;    // layer mask texture
uniform int u_hasMask;          // 1 if layer mask is active
uniform vec2 u_maskSize;        // mask texture size in pixels
uniform int u_maskOverlay;      // 1 = render mask as blue overlay (edit mode)
// Optional brush texture (modulates stroke alpha during composite)
uniform sampler2D u_brushTexture;
uniform int u_hasBrushTexture;
uniform float u_textureScale;
uniform int u_textureBlendMode;
uniform vec2 u_brushTextureSize;
out vec4 fragColor;

//#include hsl

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

vec3 setLum(vec3 c, float l) {
    float d = l - lum(c);
    c += d;
    float n = min(min(c.r, c.g), c.b);
    float x = max(max(c.r, c.g), c.b);
    if (n < 0.0) { float ln = lum(c); c = ln + (c - ln) * ln / (ln - n); }
    if (x > 1.0) { float ln = lum(c); c = ln + (c - ln) * (1.0 - ln) / (x - ln); }
    return c;
}

float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }

vec3 blendMode(vec3 s, vec3 d) {
#if BLEND_MODE == 1
    return s * d; // Multiply
#elif BLEND_MODE == 2
    return s + d - s * d; // Screen
#elif BLEND_MODE == 3
    // Overlay
    return vec3(
        d.r < 0.5 ? 2.0*s.r*d.r : 1.0-2.0*(1.0-s.r)*(1.0-d.r),
        d.g < 0.5 ? 2.0*s.g*d.g : 1.0-2.0*(1.0-s.g)*(1.0-d.g),
        d.b < 0.5 ? 2.0*s.b*d.b : 1.0-2.0*(1.0-s.b)*(1.0-d.b)
    );
#elif BLEND_MODE == 4
    return min(s, d); // Darken
#elif BLEND_MODE == 5
    return max(s, d); // Lighten
#elif BLEND_MODE == 6
    // ColorDodge
    return vec3(
        s.r >= 1.0 ? 1.0 : min(1.0, d.r / (1.0 - s.r)),
        s.g >= 1.0 ? 1.0 : min(1.0, d.g / (1.0 - s.g)),
        s.b >= 1.0 ? 1.0 : min(1.0, d.b / (1.0 - s.b))
    );
#elif BLEND_MODE == 7
    // ColorBurn
    return vec3(
        s.r <= 0.0 ? 0.0 : max(0.0, 1.0 - (1.0 - d.r) / s.r),
        s.g <= 0.0 ? 0.0 : max(0.0, 1.0 - (1.0 - d.g) / s.g),
        s.b <= 0.0 ? 0.0 : max(0.0, 1.0 - (1.0 - d.b) / s.b)
    );
#elif BLEND_MODE == 8
    // HardLight
    return vec3(
        s.r < 0.5 ? 2.0*s.r*d.r : 1.0-2.0*(1.0-s.r)*(1.0-d.r),
        s.g < 0.5 ? 2.0*s.g*d.g : 1.0-2.0*(1.0-s.g)*(1.0-d.g),
        s.b < 0.5 ? 2.0*s.b*d.b : 1.0-2.0*(1.0-s.b)*(1.0-d.b)
    );
#elif BLEND_MODE == 9
    // SoftLight (W3C)
    vec3 dd = mix(sqrt(d), ((16.0*d - 12.0)*d + 4.0)*d, step(d, vec3(0.25)));
    return mix(
        d - (1.0 - 2.0*s) * d * (1.0 - d),
        d + (2.0*s - 1.0) * (dd - d),
        step(vec3(0.5), s)
    );
#elif BLEND_MODE == 10
    return abs(s - d); // Difference
#elif BLEND_MODE == 11
    return s + d - 2.0*s*d; // Exclusion
#elif BLEND_MODE == 12
    // Hue
    vec3 shsl = rgb2hsl(s);
    vec3 dhsl = rgb2hsl(d);
    return setLum(hsl2rgb(vec3(shsl.x, dhsl.y, 0.5)), lum(d));
#elif BLEND_MODE == 13
    // Saturation
    float ss = sat(s);
    return setLum(hsl2rgb(vec3(rgb2hsl(d).x, ss > 0.0 ? ss : rgb2hsl(d).y, 0.5)), lum(d));
#elif BLEND_MODE == 14
    // Color
    return setLum(s, lum(d));
#elif BLEND_MODE == 15
    // Luminosity
    return setLum(d, lum(s));
#else
    return s; // Normal (0) — also the fallback the old uniform branch had
#endif
}

void main() {
    vec4 dst = texture(u_dstTex, v_uv);

    // Map document UV to layer-local UV. When u_wrapLayer is on, pick the
    // integer shift `n` per axis that puts the fragment closest to the
    // nearest tiled copy of the layer's center — turning overhang on one
    // edge into coverage on the opposite edge. The shift is applied to
    // u_srcOffset (not to the layer texture), so repeated moves keep
    // sampling from the original pixels.
    vec2 docPos = v_uv * u_docSize;
    vec2 effectiveOffset = u_srcOffset;
    if (u_wrapLayer == 1) {
        vec2 n = floor((docPos - u_srcOffset - u_srcSize * 0.5) / u_docSize + 0.5);
        effectiveOffset = u_srcOffset + n * u_docSize;
    }
    vec2 layerUV = (docPos - effectiveOffset) / u_srcSize;

    // Outside layer bounds: pass through destination
    if (layerUV.x < 0.0 || layerUV.x > 1.0 || layerUV.y < 0.0 || layerUV.y > 1.0) {
        fragColor = dst;
        return;
    }

    vec4 src = texture(u_srcTex, layerUV);

    // Mask overlay mode: render mask as translucent blue, skip normal blend
    if (u_maskOverlay == 1) {
        float maskVal = src.r; // mask stored as grayscale in R channel
        float overlayA = (1.0 - maskVal) * 0.5;
        if (overlayA < 0.001) { fragColor = dst; return; }
        vec3 blue = vec3(0.0, 0.39, 1.0);
        float outA = overlayA + dst.a * (1.0 - overlayA);
        vec3 outRGB = (overlayA * blue + dst.a * (1.0 - overlayA) * dst.rgb) / outA;
        fragColor = vec4(outRGB, outA);
        return;
    }

    // Un-premultiply if source is premultiplied (e.g. stroke texture)
    if (u_srcPremultiplied == 1 && src.a > 0.001) {
        src.rgb /= src.a;
    }

    // Apply color overlay inline — avoids the scratch buffer feedback loop
    if (u_overlayEnabled == 1) {
        src.rgb = mix(src.rgb, u_overlayColor, u_overlayOpacity);
    }

    // Apply layer mask: multiply source alpha by mask value.
    // Use the same effectiveOffset so the mask wraps with the layer.
    if (u_hasMask == 1) {
        vec2 maskUV = (docPos - effectiveOffset) / u_maskSize;
        if (maskUV.x >= 0.0 && maskUV.x <= 1.0 && maskUV.y >= 0.0 && maskUV.y <= 1.0) {
            float maskVal = texture(u_maskTex, maskUV).r;
            src.a *= maskVal;
        } else {
            src.a = 0.0;
        }
    }

    float sa = src.a * u_opacity;
    float da = dst.a;

    if (sa < 0.001) { fragColor = dst; return; }
    if (da < 0.001) { fragColor = vec4(src.rgb, sa); return; }

    vec3 blended = blendMode(src.rgb, dst.rgb);
    float outA = sa + da * (1.0 - sa);

    vec3 outRGB = (sa * da * blended + sa * (1.0 - da) * src.rgb + da * (1.0 - sa) * dst.rgb) / outA;

    fragColor = vec4(outRGB, outA);
}
