#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
layout(std140) uniform Params {
    float u_brightness;
    float u_contrast;
    float u_exposure;
    float u_highlights;
    float u_shadows;
    float u_whites;
    float u_blacks;
    float u_saturation;
    float u_vibrance;
    float u_hasLevels;
    float u_hasCurves;
    // Hue/Saturation: HSL-space adjustments applied after the standard pass.
    float u_hueShift; // degrees: -180..180
    float u_hslSaturation; // -100..100
    float u_lightness; // -100..100
    // Color Balance: per-tonal-range CMY→RGB shifts (-100..100 each channel).
    vec3 u_cbShadows;
    vec3 u_cbMidtones;
    vec3 u_cbHighlights;
    // Photo Filter: multiply+blend toward u_pfColor by u_pfDensity (0..1).
    vec3 u_pfColor;
    float u_pfDensity;
    float u_pfLuminosity; // 1 = preserve luminosity
    // Black & White: per-hue grayscale weights (default values ~ standard).
    float u_bwReds;
    float u_bwYellows;
    float u_bwGreens;
    float u_bwCyans;
    float u_bwBlues;
    float u_bwMagentas;
    float u_bwEnabled; // 0 or 1
    // Channel Mixer: 3x4 matrix (output R/G/B = mix(R,G,B) + constant/100).
    float u_cmRr;
    float u_cmRg;
    float u_cmRb;
    float u_cmRc;
    float u_cmGr;
    float u_cmGg;
    float u_cmGb;
    float u_cmGc;
    float u_cmBr;
    float u_cmBg;
    float u_cmBb;
    float u_cmBc;
    float u_cmEnabled;
    // Invert: flip all channels.
    float u_invert;
    float u_hasGradientMap;
    // Color Grading: per-wheel offsets, rgb = tint, a = luminance.
    float u_cgEnabled;
    vec4 u_cgShadows;
    vec4 u_cgMidtones;
    vec4 u_cgHighlights;
    vec4 u_cgGlobal;
    float u_cgExponent; // Balance: bends luma before the tone masks.
    float u_cgWidth; // Blending: half-width of the mask crossovers.
    // Document color mode: 1 = Lab, whose textures hold encoded CIELAB. Every
    // node below assumes sRGB channels, so Lab pixels are decoded first and
    // re-encoded at the end.
    int u_docColorMode;
};
// Levels: 256x1 RGBA texture. R/G/B = per-channel Levels LUTs,
// A = master RGB Levels LUT. u_hasLevels=0 skips the lookups.
// Levels are applied before Curves (matches Photoshop compositing order).
uniform sampler2D u_levelsLut;
// Curves: 256x1 RGBA texture. R/G/B = per-channel curve LUTs,
// A = master RGB curve LUT. u_hasCurves=0 skips the lookups so the
// common no-curves case stays identical to the old shader.
uniform sampler2D u_curveLut;
// Gradient Map: 256x1 RGBA LUT mapping luminosity → colour.
uniform sampler2D u_gradientLut;
out vec4 fragColor;

//#include hsl
//#include lab

// c + offset, easing into 0 and 1 rather than clipping. A hard clip leaves a
// channel flat and then rising fast, which reads as a line across a smooth
// ramp. The easing scales with the offset, so a channel left alone is exact.
vec3 softOffset(vec3 c, vec3 offset) {
    vec3 floorEase = 0.25 * max(-offset, 0.0);
    vec3 ceilEase = 0.25 * max(offset, 0.0);
    vec3 x = c + offset;
    vec3 eased = 0.5 * (x + sqrt(x * x + 4.0 * floorEase * floorEase));
    vec3 headroom = 1.0 - eased;
    return 1.0 - 0.5 * (headroom + sqrt(headroom * headroom + 4.0 * ceilEase * ceilEase));
}

float lumaOf(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Highlights / Whites. Pushing the bright end up uses a smoothstep weight,
// which only ever steepens the ramp. Pulling it down toward the anchor uses
// a quadratic weight whose slope tops out at 1 (at lum 1), so even at full
// strength the curve flattens at white instead of folding back below the
// tones beneath it. Each control re-reads luma, so stacked controls compose
// monotonic curves and stay monotonic.
float brightEndOffset(float lum, float anchor, float strength) {
    if (strength >= 0.0) return strength * smoothstep(anchor, 1.0, lum);
    float t = clamp(lum, anchor, 1.0) - anchor;
    return max(strength, -1.0) * t * t / (2.0 * (1.0 - anchor));
}

// Shadows / Blacks: the mirror image, anchored above black.
float darkEndOffset(float lum, float anchor, float strength) {
    if (strength <= 0.0) return strength * (1.0 - smoothstep(0.0, anchor, lum));
    float t = anchor - clamp(lum, 0.0, anchor);
    return min(strength, 1.0) * t * t / (2.0 * anchor);
}

void main() {
    vec4 c = texture(u_tex, v_uv);
    if (c.a < 0.001) {
        fragColor = c;
        return;
    }
    bool isLab = u_docColorMode == 1;
    if (isLab) c.rgb = labToSrgb(c.rgb);
    c.rgb *= pow(2.0, u_exposure);
    c.rgb = (c.rgb - 0.5) * max(u_contrast + 1.0, 0.0) + 0.5 + u_brightness;
    c.rgb += brightEndOffset(lumaOf(c.rgb), 0.5, u_highlights * 0.01);
    c.rgb += darkEndOffset(lumaOf(c.rgb), 0.5, u_shadows * 0.01);
    c.rgb += brightEndOffset(lumaOf(c.rgb), 0.7, u_whites * 0.01);
    c.rgb += darkEndOffset(lumaOf(c.rgb), 0.3, u_blacks * 0.01);

    // Saturation: lerp between grayscale and color
    if (abs(u_saturation) > 0.001) {
        float gray = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(gray), c.rgb, 1.0 + u_saturation);
    }

    // Vibrance: selectively boost saturation for less-saturated colors
    if (abs(u_vibrance) > 0.001) {
        float maxC = max(c.r, max(c.g, c.b));
        float minC = min(c.r, min(c.g, c.b));
        float sat = (maxC > 0.001) ? (maxC - minC) / maxC : 0.0;
        float boost = u_vibrance * (1.0 - sat);
        float gray2 = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(gray2), c.rgb, 1.0 + boost);
    }

    c.rgb = clamp(c.rgb, 0.0, 1.0);

    // Levels: master first on every channel, then per-channel remap.
    if (u_hasLevels > 0.5) {
        float ofs = 0.5 / 256.0;
        c.r = texture(u_levelsLut, vec2(c.r + ofs, 0.5)).a;
        c.g = texture(u_levelsLut, vec2(c.g + ofs, 0.5)).a;
        c.b = texture(u_levelsLut, vec2(c.b + ofs, 0.5)).a;
        c.r = texture(u_levelsLut, vec2(c.r + ofs, 0.5)).r;
        c.g = texture(u_levelsLut, vec2(c.g + ofs, 0.5)).g;
        c.b = texture(u_levelsLut, vec2(c.b + ofs, 0.5)).b;
    }

    // Curves: master first on every channel, then per-channel remap.
    if (u_hasCurves > 0.5) {
        float ofs = 0.5 / 256.0;
        c.r = texture(u_curveLut, vec2(c.r + ofs, 0.5)).a;
        c.g = texture(u_curveLut, vec2(c.g + ofs, 0.5)).a;
        c.b = texture(u_curveLut, vec2(c.b + ofs, 0.5)).a;
        c.r = texture(u_curveLut, vec2(c.r + ofs, 0.5)).r;
        c.g = texture(u_curveLut, vec2(c.g + ofs, 0.5)).g;
        c.b = texture(u_curveLut, vec2(c.b + ofs, 0.5)).b;
    }

    // Hue/Saturation: HSL-space adjustments.
    if (abs(u_hueShift) > 0.001 || abs(u_hslSaturation) > 0.001 || abs(u_lightness) > 0.001) {
        vec3 hsl = rgb2hsl(c.rgb);
        hsl.x = fract(hsl.x + u_hueShift / 360.0);
        hsl.y = clamp(hsl.y * (1.0 + u_hslSaturation / 100.0), 0.0, 1.0);
        c.rgb = hsl2rgb(hsl);
        // Lightness blends towards black or white (as Photoshop does) rather
        // than shifting HSL L, which turns pale tints into vivid colours.
        float light = u_lightness / 100.0;
        c.rgb = light < 0.0 ? c.rgb * (1.0 + light) : c.rgb + (1.0 - c.rgb) * light;
    }

    // Color Balance: shift colors in each tonal range toward CMY or RGB.
    if (dot(abs(u_cbShadows), vec3(1.0)) > 0.001 ||
        dot(abs(u_cbMidtones), vec3(1.0)) > 0.001 ||
        dot(abs(u_cbHighlights), vec3(1.0)) > 0.001) {
        float l2 = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        float shadowW    = clamp(1.0 - l2 * 2.0, 0.0, 1.0);
        float highlightW = clamp(l2 * 2.0 - 1.0, 0.0, 1.0);
        float midtoneW   = clamp(1.0 - shadowW - highlightW, 0.0, 1.0);
        c.rgb += (u_cbShadows * shadowW + u_cbMidtones * midtoneW + u_cbHighlights * highlightW) / 100.0;
        c.rgb = clamp(c.rgb, 0.0, 1.0);
    }

    // Black & White: per-hue weighted grayscale.
    if (u_bwEnabled > 0.5) {
        vec3 hsl = rgb2hsl(c.rgb);
        float h6 = hsl.x * 6.0;
        float w;
        if      (h6 < 1.0) w = mix(u_bwReds,     u_bwYellows,  h6);
        else if (h6 < 2.0) w = mix(u_bwYellows,  u_bwGreens,   h6 - 1.0);
        else if (h6 < 3.0) w = mix(u_bwGreens,   u_bwCyans,    h6 - 2.0);
        else if (h6 < 4.0) w = mix(u_bwCyans,    u_bwBlues,    h6 - 3.0);
        else if (h6 < 5.0) w = mix(u_bwBlues,    u_bwMagentas, h6 - 4.0);
        else               w = mix(u_bwMagentas,  u_bwReds,     h6 - 5.0);
        float stdLum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        float gray = mix(stdLum, clamp(w / 100.0 * hsl.z * 2.0, 0.0, 1.0), hsl.y);
        c.rgb = vec3(clamp(gray, 0.0, 1.0));
    }

    // Photo Filter: multiply toward a warm/cool colour at given density.
    // Runs after Black & White, which rebuilds RGB from a grey and would
    // otherwise discard the tint: a toned monochrome is the only useful
    // result of combining the two (#1277).
    if (u_pfDensity > 0.001) {
        vec3 filtered = c.rgb * u_pfColor;
        vec3 result = mix(c.rgb, filtered, u_pfDensity);
        if (u_pfLuminosity > 0.5) {
            // Scale result to match the original luminance rather than swapping
            // the HSL L channel. The L-swap causes unexpected hue shifts when
            // the filter and source are complementary (e.g. orange on blue sky).
            vec3 lum = vec3(0.2126, 0.7152, 0.0722);
            float origLum   = dot(c.rgb, lum);
            float resultLum = dot(result,  lum);
            if (resultLum > 0.001) {
                result *= origLum / resultLum;
            }
            result = clamp(result, 0.0, 1.0);
        }
        c.rgb = result;
    }

    // Channel Mixer: linear combination of input channels per output channel.
    if (u_cmEnabled > 0.5) {
        float r = clamp(c.r * u_cmRr + c.g * u_cmRg + c.b * u_cmRb + u_cmRc / 100.0, 0.0, 1.0);
        float g = clamp(c.r * u_cmGr + c.g * u_cmGg + c.b * u_cmGb + u_cmGc / 100.0, 0.0, 1.0);
        float b = clamp(c.r * u_cmBr + c.g * u_cmBg + c.b * u_cmBb + u_cmBc / 100.0, 0.0, 1.0);
        c.rgb = vec3(r, g, b);
    }

    // Invert: flip all channels.
    if (u_invert > 0.5) {
        c.rgb = 1.0 - c.rgb;
    }

    // Gradient Map: map luminosity to a colour gradient.
    if (u_hasGradientMap > 0.5) {
        float l3 = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        float ofs = 0.5 / 256.0;
        c.rgb = texture(u_gradientLut, vec2(l3 + ofs, 0.5)).rgb;
    }

    // Color Grading: runs last because Black & White and Gradient Map rebuild
    // RGB and would discard an earlier tint; a split-toned monochrome is one
    // of the main reasons to reach for it.
    if (u_cgEnabled > 0.5) {
        float tone = pow(clamp(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0), u_cgExponent);
        float shadowW    = 1.0 - smoothstep(1.0 / 3.0 - u_cgWidth, 1.0 / 3.0 + u_cgWidth, tone);
        float highlightW = smoothstep(2.0 / 3.0 - u_cgWidth, 2.0 / 3.0 + u_cgWidth, tone);
        float midtoneW   = 1.0 - shadowW - highlightW;
        vec4 grade = u_cgGlobal + u_cgShadows * shadowW + u_cgMidtones * midtoneW + u_cgHighlights * highlightW;
        c.rgb = softOffset(c.rgb, grade.rgb + grade.a);
    }

    if (isLab) c.rgb = srgbToLab(c.rgb);
    fragColor = vec4(c.rgb, c.a);
}
