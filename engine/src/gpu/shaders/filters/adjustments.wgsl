struct Params {
    u_brightness: f32,
    u_contrast: f32,
    u_exposure: f32,
    u_highlights: f32,
    u_shadows: f32,
    u_whites: f32,
    u_blacks: f32,
    u_saturation: f32,
    u_vibrance: f32,
    u_hasLevels: f32,
    u_hasCurves: f32,
    // Hue/Saturation: HSL-space adjustments applied after the standard pass.
    // degrees: -180..180
    u_hueShift: f32,
    // -100..100
    u_hslSaturation: f32,
    // -100..100
    u_lightness: f32,
    // Color Balance: per-tonal-range CMY->RGB shifts (-100..100 each channel).
    u_cbShadows: vec3<f32>,
    u_cbMidtones: vec3<f32>,
    u_cbHighlights: vec3<f32>,
    // Photo Filter: multiply+blend toward u_pfColor by u_pfDensity (0..1).
    u_pfColor: vec3<f32>,
    u_pfDensity: f32,
    // 1 = preserve luminosity
    u_pfLuminosity: f32,
    // Black & White: per-hue grayscale weights (default values ~ standard).
    u_bwReds: f32,
    u_bwYellows: f32,
    u_bwGreens: f32,
    u_bwCyans: f32,
    u_bwBlues: f32,
    u_bwMagentas: f32,
    // 0 or 1
    u_bwEnabled: f32,
    // Channel Mixer: 3x4 matrix (output R/G/B = mix(R,G,B) + constant/100).
    u_cmRr: f32,
    u_cmRg: f32,
    u_cmRb: f32,
    u_cmRc: f32,
    u_cmGr: f32,
    u_cmGg: f32,
    u_cmGb: f32,
    u_cmGc: f32,
    u_cmBr: f32,
    u_cmBg: f32,
    u_cmBb: f32,
    u_cmBc: f32,
    u_cmEnabled: f32,
    // Invert: flip all channels.
    u_invert: f32,
    u_hasGradientMap: f32,
    // Color Grading: per-wheel offsets, rgb = tint, a = luminance.
    u_cgEnabled: f32,
    u_cgShadows: vec4<f32>,
    u_cgMidtones: vec4<f32>,
    u_cgHighlights: vec4<f32>,
    u_cgGlobal: vec4<f32>,
    // Balance: bends luma before the tone masks.
    u_cgExponent: f32,
    // Blending: half-width of the mask crossovers.
    u_cgWidth: f32,
    // Document color mode: 1 = Lab, whose textures hold encoded CIELAB. Every
    // node below assumes sRGB channels, so Lab pixels are decoded first and
    // re-encoded at the end.
    u_docColorMode: i32,
    // 1 to keep what the tone controls push above white, for an HDR screen;
    // 0 to clip it, as every other use does.
    u_keepOverWhite: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;
// Levels: 256x1 RGBA texture. R/G/B = per-channel Levels LUTs,
// A = master RGB Levels LUT. u_hasLevels=0 skips the lookups.
// Levels are applied before Curves (matches Photoshop compositing order).
@group(0) @binding(3) var u_levelsLut: texture_2d<f32>;
@group(0) @binding(4) var u_levelsLut_sampler: sampler;
// Curves: 256x1 RGBA texture. R/G/B = per-channel curve LUTs,
// A = master RGB curve LUT. u_hasCurves=0 skips the lookups so the
// common no-curves case stays identical to the old shader.
@group(0) @binding(5) var u_curveLut: texture_2d<f32>;
@group(0) @binding(6) var u_curveLut_sampler: sampler;
// Gradient Map: 256x1 RGBA LUT mapping luminosity -> colour.
@group(0) @binding(7) var u_gradientLut: texture_2d<f32>;
@group(0) @binding(8) var u_gradientLut_sampler: sampler;

//#include hsl
//#include lab

const LUT_HALF_TEXEL: f32 = 0.5 / 256.0;

// The LUT reads come after an early return on the pixel's alpha, so they
// name their level: there is nothing to derive it from, and one level.
fn levelsAt(v: f32) -> vec4<f32> {
    return textureSampleLevel(u_levelsLut, u_levelsLut_sampler, vec2<f32>(v + LUT_HALF_TEXEL, 0.5), 0.0);
}

fn curveAt(v: f32) -> vec4<f32> {
    return textureSampleLevel(u_curveLut, u_curveLut_sampler, vec2<f32>(v + LUT_HALF_TEXEL, 0.5), 0.0);
}

// c + offset, easing into 0 and 1 rather than clipping. A hard clip leaves a
// channel flat and then rising fast, which reads as a line across a smooth
// ramp. The easing scales with the offset, so a channel left alone is exact.
fn softOffset(c: vec3<f32>, offset: vec3<f32>) -> vec3<f32> {
    let floorEase = 0.25 * max(-offset, vec3<f32>(0.0));
    let ceilEase = 0.25 * max(offset, vec3<f32>(0.0));
    let x = c + offset;
    let eased = 0.5 * (x + sqrt(x * x + 4.0 * floorEase * floorEase));
    let headroom = 1.0 - eased;
    return 1.0 - 0.5 * (headroom + sqrt(headroom * headroom + 4.0 * ceilEase * ceilEase));
}

fn lumaOf(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// Highlights / Whites. Pushing the bright end up uses a smoothstep weight,
// which only ever steepens the ramp. Pulling it down toward the anchor uses
// a quadratic weight whose slope tops out at 1 (at lum 1), so even at full
// strength the curve flattens at white instead of folding back below the
// tones beneath it. Each control re-reads luma, so stacked controls compose
// monotonic curves and stay monotonic.
fn brightEndOffset(lum: f32, anchor: f32, strength: f32) -> f32 {
    if (strength >= 0.0) { return strength * smoothstep(anchor, 1.0, lum); }
    let t = clamp(lum, anchor, 1.0) - anchor;
    return max(strength, -1.0) * t * t / (2.0 * (1.0 - anchor));
}

// Shadows / Blacks: the mirror image, anchored above black.
fn darkEndOffset(lum: f32, anchor: f32, strength: f32) -> f32 {
    if (strength <= 0.0) { return strength * (1.0 - smoothstep(0.0, anchor, lum)); }
    let t = anchor - clamp(lum, 0.0, anchor);
    return min(strength, 1.0) * t * t / (2.0 * anchor);
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let c = textureSample(u_tex, u_tex_sampler, uv);
    if (c.a < 0.001) {
        return c;
    }
    let isLab = params.u_docColorMode == 1;
    var rgb = c.rgb;
    if (isLab) { rgb = labToSrgb(rgb); }
    rgb *= pow(2.0, params.u_exposure);
    rgb = (rgb - 0.5) * max(params.u_contrast + 1.0, 0.0) + 0.5 + params.u_brightness;
    rgb += brightEndOffset(lumaOf(rgb), 0.5, params.u_highlights * 0.01);
    rgb += darkEndOffset(lumaOf(rgb), 0.5, params.u_shadows * 0.01);
    rgb += brightEndOffset(lumaOf(rgb), 0.7, params.u_whites * 0.01);
    rgb += darkEndOffset(lumaOf(rgb), 0.3, params.u_blacks * 0.01);

    // Saturation: lerp between grayscale and color
    if (abs(params.u_saturation) > 0.001) {
        let gray = dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
        rgb = mix(vec3<f32>(gray), rgb, 1.0 + params.u_saturation);
    }

    // Vibrance: selectively boost saturation for less-saturated colors
    if (abs(params.u_vibrance) > 0.001) {
        let maxC = max(rgb.r, max(rgb.g, rgb.b));
        let minC = min(rgb.r, min(rgb.g, rgb.b));
        var sat = 0.0;
        if (maxC > 0.001) { sat = (maxC - minC) / maxC; }
        let boost = params.u_vibrance * (1.0 - sat);
        let gray2 = dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
        rgb = mix(vec3<f32>(gray2), rgb, 1.0 + boost);
    }

    // Everything below works on values in 0..1. What exposure and the tone
    // controls pushed past white is set aside here and added back at the
    // end, where an HDR screen shows it brighter than white.
    let overWhite = max(rgb - vec3<f32>(1.0), vec3<f32>(0.0)) * params.u_keepOverWhite;
    rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));

    // Levels: master first on every channel, then per-channel remap.
    if (params.u_hasLevels > 0.5) {
        rgb.r = levelsAt(rgb.r).a;
        rgb.g = levelsAt(rgb.g).a;
        rgb.b = levelsAt(rgb.b).a;
        rgb.r = levelsAt(rgb.r).r;
        rgb.g = levelsAt(rgb.g).g;
        rgb.b = levelsAt(rgb.b).b;
    }

    // Curves: master first on every channel, then per-channel remap.
    if (params.u_hasCurves > 0.5) {
        rgb.r = curveAt(rgb.r).a;
        rgb.g = curveAt(rgb.g).a;
        rgb.b = curveAt(rgb.b).a;
        rgb.r = curveAt(rgb.r).r;
        rgb.g = curveAt(rgb.g).g;
        rgb.b = curveAt(rgb.b).b;
    }

    // Hue/Saturation: HSL-space adjustments.
    if (abs(params.u_hueShift) > 0.001 || abs(params.u_hslSaturation) > 0.001 || abs(params.u_lightness) > 0.001) {
        var hsl = rgb2hsl(rgb);
        hsl.x = fract(hsl.x + params.u_hueShift / 360.0);
        hsl.y = clamp(hsl.y * (1.0 + params.u_hslSaturation / 100.0), 0.0, 1.0);
        rgb = hsl2rgb(hsl);
        // Lightness blends towards black or white (as Photoshop does) rather
        // than shifting HSL L, which turns pale tints into vivid colours.
        let light = params.u_lightness / 100.0;
        if (light < 0.0) {
            rgb = rgb * (1.0 + light);
        } else {
            rgb = rgb + (1.0 - rgb) * light;
        }
    }

    // Color Balance: shift colors in each tonal range toward CMY or RGB.
    if (dot(abs(params.u_cbShadows), vec3<f32>(1.0)) > 0.001 ||
        dot(abs(params.u_cbMidtones), vec3<f32>(1.0)) > 0.001 ||
        dot(abs(params.u_cbHighlights), vec3<f32>(1.0)) > 0.001) {
        let l2 = dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
        let shadowW = clamp(1.0 - l2 * 2.0, 0.0, 1.0);
        let highlightW = clamp(l2 * 2.0 - 1.0, 0.0, 1.0);
        let midtoneW = clamp(1.0 - shadowW - highlightW, 0.0, 1.0);
        rgb += (params.u_cbShadows * shadowW + params.u_cbMidtones * midtoneW + params.u_cbHighlights * highlightW) / 100.0;
        rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
    }

    // Black & White: per-hue weighted grayscale.
    if (params.u_bwEnabled > 0.5) {
        let hsl = rgb2hsl(rgb);
        let h6 = hsl.x * 6.0;
        var w: f32;
        if (h6 < 1.0) {
            w = mix(params.u_bwReds, params.u_bwYellows, h6);
        } else if (h6 < 2.0) {
            w = mix(params.u_bwYellows, params.u_bwGreens, h6 - 1.0);
        } else if (h6 < 3.0) {
            w = mix(params.u_bwGreens, params.u_bwCyans, h6 - 2.0);
        } else if (h6 < 4.0) {
            w = mix(params.u_bwCyans, params.u_bwBlues, h6 - 3.0);
        } else if (h6 < 5.0) {
            w = mix(params.u_bwBlues, params.u_bwMagentas, h6 - 4.0);
        } else {
            w = mix(params.u_bwMagentas, params.u_bwReds, h6 - 5.0);
        }
        let stdLum = dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
        let gray = mix(stdLum, clamp(w / 100.0 * hsl.z * 2.0, 0.0, 1.0), hsl.y);
        rgb = vec3<f32>(clamp(gray, 0.0, 1.0));
    }

    // Photo Filter: multiply toward a warm/cool colour at given density.
    // Runs after Black & White, which rebuilds RGB from a grey and would
    // otherwise discard the tint: a toned monochrome is the only useful
    // result of combining the two (#1277).
    if (params.u_pfDensity > 0.001) {
        let filtered = rgb * params.u_pfColor;
        var result = mix(rgb, filtered, params.u_pfDensity);
        if (params.u_pfLuminosity > 0.5) {
            // Scale result to match the original luminance rather than swapping
            // the HSL L channel. The L-swap causes unexpected hue shifts when
            // the filter and source are complementary (e.g. orange on blue sky).
            let lum = vec3<f32>(0.2126, 0.7152, 0.0722);
            let origLum = dot(rgb, lum);
            let resultLum = dot(result, lum);
            if (resultLum > 0.001) {
                result *= origLum / resultLum;
            }
            result = clamp(result, vec3<f32>(0.0), vec3<f32>(1.0));
        }
        rgb = result;
    }

    // Channel Mixer: linear combination of input channels per output channel.
    if (params.u_cmEnabled > 0.5) {
        let r = clamp(rgb.r * params.u_cmRr + rgb.g * params.u_cmRg + rgb.b * params.u_cmRb + params.u_cmRc / 100.0, 0.0, 1.0);
        let g = clamp(rgb.r * params.u_cmGr + rgb.g * params.u_cmGg + rgb.b * params.u_cmGb + params.u_cmGc / 100.0, 0.0, 1.0);
        let b = clamp(rgb.r * params.u_cmBr + rgb.g * params.u_cmBg + rgb.b * params.u_cmBb + params.u_cmBc / 100.0, 0.0, 1.0);
        rgb = vec3<f32>(r, g, b);
    }

    // Invert: flip all channels.
    if (params.u_invert > 0.5) {
        rgb = 1.0 - rgb;
    }

    // Gradient Map: map luminosity to a colour gradient.
    if (params.u_hasGradientMap > 0.5) {
        let l3 = dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
        rgb = textureSampleLevel(u_gradientLut, u_gradientLut_sampler, vec2<f32>(l3 + LUT_HALF_TEXEL, 0.5), 0.0).rgb;
    }

    // Color Grading: runs last because Black & White and Gradient Map rebuild
    // RGB and would discard an earlier tint; a split-toned monochrome is one
    // of the main reasons to reach for it.
    if (params.u_cgEnabled > 0.5) {
        let tone = pow(clamp(dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0, 1.0), params.u_cgExponent);
        let shadowW = 1.0 - smoothstep(1.0 / 3.0 - params.u_cgWidth, 1.0 / 3.0 + params.u_cgWidth, tone);
        let highlightW = smoothstep(2.0 / 3.0 - params.u_cgWidth, 2.0 / 3.0 + params.u_cgWidth, tone);
        let midtoneW = 1.0 - shadowW - highlightW;
        let grade = params.u_cgGlobal + params.u_cgShadows * shadowW + params.u_cgMidtones * midtoneW + params.u_cgHighlights * highlightW;
        rgb = softOffset(rgb, grade.rgb + grade.a);
    }

    rgb += overWhite;

    if (isLab) { rgb = srgbToLab(rgb); }
    return vec4<f32>(rgb, c.a);
}
