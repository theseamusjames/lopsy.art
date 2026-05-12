#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_exposure;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_whites;
uniform float u_blacks;
uniform float u_saturation;
uniform float u_vibrance;
// Levels: 256x1 RGBA texture. R/G/B = per-channel Levels LUTs,
// A = master RGB Levels LUT. u_hasLevels=0 skips the lookups.
// Levels are applied before Curves (matches Photoshop compositing order).
uniform sampler2D u_levelsLut;
uniform float u_hasLevels;
// Curves: 256x1 RGBA texture. R/G/B = per-channel curve LUTs,
// A = master RGB curve LUT. u_hasCurves=0 skips the lookups so the
// common no-curves case stays identical to the old shader.
uniform sampler2D u_curveLut;
uniform float u_hasCurves;
// Hue/Saturation: HSL-space adjustments applied after the standard pass.
uniform float u_hue_shift;       // degrees: -180..180
uniform float u_hsl_saturation;  // -100..100
uniform float u_lightness;       // -100..100
// Color Balance: per-tonal-range CMY→RGB shifts (-100..100 each channel).
uniform vec3 u_cb_shadows;
uniform vec3 u_cb_midtones;
uniform vec3 u_cb_highlights;
// Photo Filter: multiply+blend toward u_pf_color by u_pf_density (0..1).
uniform vec3 u_pf_color;
uniform float u_pf_density;
uniform float u_pf_luminosity;  // 1 = preserve luminosity
// Black & White: per-hue grayscale weights (default values ~ standard).
uniform float u_bw_reds;
uniform float u_bw_yellows;
uniform float u_bw_greens;
uniform float u_bw_cyans;
uniform float u_bw_blues;
uniform float u_bw_magentas;
uniform float u_bw_enabled;     // 0 or 1
// Channel Mixer: 3x4 matrix (output R/G/B = mix(R,G,B) + constant/100).
uniform float u_cm_rr; uniform float u_cm_rg; uniform float u_cm_rb; uniform float u_cm_rc;
uniform float u_cm_gr; uniform float u_cm_gg; uniform float u_cm_gb; uniform float u_cm_gc;
uniform float u_cm_br; uniform float u_cm_bg; uniform float u_cm_bb; uniform float u_cm_bc;
uniform float u_cm_enabled;
// Invert: flip all channels.
uniform float u_invert;
// Gradient Map: 256x1 RGBA LUT mapping luminosity → colour.
uniform sampler2D u_gradientLut;
uniform float u_hasGradientMap;
out vec4 fragColor;

// ── HSL helpers (shared by Hue/Saturation, Photo Filter, Black & White) ──────
vec3 rgb2hsl(vec3 c) {
    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    float l = (mx + mn) * 0.5;
    if (mx - mn < 0.00001) return vec3(0.0, 0.0, l);
    float d = mx - mn;
    float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    float h;
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    return vec3(h / 6.0, s, l);
}
float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
    if (t < 0.5)      return q;
    if (t < 2.0/3.0)  return p + (q - p) * (2.0/3.0 - t) * 6.0;
    return p;
}
vec3 hsl2rgb(vec3 hsl) {
    if (hsl.y < 0.00001) return vec3(hsl.z);
    float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
    float p = 2.0 * hsl.z - q;
    return vec3(hue2rgb(p, q, hsl.x + 1.0/3.0), hue2rgb(p, q, hsl.x), hue2rgb(p, q, hsl.x - 1.0/3.0));
}

void main() {
    vec4 c = texture(u_tex, v_uv);
    if (c.a < 0.001) {
        fragColor = c;
        return;
    }
    c.rgb *= pow(2.0, u_exposure);
    c.rgb = (c.rgb - 0.5) * max(u_contrast + 1.0, 0.0) + 0.5 + u_brightness;
    float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    c.rgb += u_highlights * smoothstep(0.5, 1.0, lum) * 0.01;
    c.rgb += u_shadows * (1.0 - smoothstep(0.0, 0.5, lum)) * 0.01;
    c.rgb += u_whites * smoothstep(0.7, 1.0, lum) * 0.01;
    c.rgb += u_blacks * (1.0 - smoothstep(0.0, 0.3, lum)) * 0.01;

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
    if (abs(u_hue_shift) > 0.001 || abs(u_hsl_saturation) > 0.001 || abs(u_lightness) > 0.001) {
        vec3 hsl = rgb2hsl(c.rgb);
        hsl.x = fract(hsl.x + u_hue_shift / 360.0);
        hsl.y = clamp(hsl.y * (1.0 + u_hsl_saturation / 100.0), 0.0, 1.0);
        hsl.z = clamp(hsl.z + u_lightness / 100.0, 0.0, 1.0);
        c.rgb = hsl2rgb(hsl);
    }

    // Color Balance: shift colors in each tonal range toward CMY or RGB.
    if (dot(abs(u_cb_shadows), vec3(1.0)) > 0.001 ||
        dot(abs(u_cb_midtones), vec3(1.0)) > 0.001 ||
        dot(abs(u_cb_highlights), vec3(1.0)) > 0.001) {
        float l2 = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        float shadowW    = clamp(1.0 - l2 * 2.0, 0.0, 1.0);
        float highlightW = clamp(l2 * 2.0 - 1.0, 0.0, 1.0);
        float midtoneW   = clamp(1.0 - shadowW - highlightW, 0.0, 1.0);
        c.rgb += (u_cb_shadows * shadowW + u_cb_midtones * midtoneW + u_cb_highlights * highlightW) / 100.0;
        c.rgb = clamp(c.rgb, 0.0, 1.0);
    }

    // Photo Filter: multiply toward a warm/cool colour at given density.
    if (u_pf_density > 0.001) {
        vec3 filtered = c.rgb * u_pf_color;
        vec3 result = mix(c.rgb, filtered, u_pf_density);
        if (u_pf_luminosity > 0.5) {
            vec3 origHsl   = rgb2hsl(c.rgb);
            vec3 resultHsl = rgb2hsl(result);
            resultHsl.z = origHsl.z;
            result = hsl2rgb(resultHsl);
        }
        c.rgb = result;
    }

    // Black & White: per-hue weighted grayscale.
    if (u_bw_enabled > 0.5) {
        vec3 hsl = rgb2hsl(c.rgb);
        float h6 = hsl.x * 6.0;
        float w;
        if      (h6 < 1.0) w = mix(u_bw_reds,     u_bw_yellows,  h6);
        else if (h6 < 2.0) w = mix(u_bw_yellows,  u_bw_greens,   h6 - 1.0);
        else if (h6 < 3.0) w = mix(u_bw_greens,   u_bw_cyans,    h6 - 2.0);
        else if (h6 < 4.0) w = mix(u_bw_cyans,    u_bw_blues,    h6 - 3.0);
        else if (h6 < 5.0) w = mix(u_bw_blues,    u_bw_magentas, h6 - 4.0);
        else               w = mix(u_bw_magentas,  u_bw_reds,     h6 - 5.0);
        float stdLum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        float gray = mix(stdLum, clamp(w / 100.0 * hsl.z * 2.0, 0.0, 1.0), hsl.y);
        c.rgb = vec3(clamp(gray, 0.0, 1.0));
    }

    // Channel Mixer: linear combination of input channels per output channel.
    if (u_cm_enabled > 0.5) {
        float r = clamp(c.r * u_cm_rr + c.g * u_cm_rg + c.b * u_cm_rb + u_cm_rc / 100.0, 0.0, 1.0);
        float g = clamp(c.r * u_cm_gr + c.g * u_cm_gg + c.b * u_cm_gb + u_cm_gc / 100.0, 0.0, 1.0);
        float b = clamp(c.r * u_cm_br + c.g * u_cm_bg + c.b * u_cm_bb + u_cm_bc / 100.0, 0.0, 1.0);
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

    fragColor = vec4(c.rgb, c.a);
}
