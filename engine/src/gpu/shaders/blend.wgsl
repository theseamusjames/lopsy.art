// Built once per blend mode: BLEND_MODE is set by the build (see
// `VARIANTS` in lopsy-shaderc), so the mode is selected when the shader is
// compiled instead of per pixel.
struct Params {
    u_opacity: f32,
    // layer position in document pixels
    u_srcOffset: vec2<f32>,
    // layer texture size in pixels
    u_srcSize: vec2<f32>,
    // document size in pixels
    u_docSize: vec2<f32>,
    // 1 if source is premultiplied alpha
    u_srcPremultiplied: i32,
    // When 1, the layer texture wraps modularly across the document — content
    // that overhangs one edge appears on the opposite side. Enabled by the
    // "Wrap" checkbox next to "Dim pattern" in the seamless-preview options.
    u_wrapLayer: i32,
    // 1 if color overlay is active
    u_overlayEnabled: i32,
    // overlay color (RGB)
    u_overlayColor: vec3<f32>,
    // overlay mix factor
    u_overlayOpacity: f32,
    // 1 if layer mask is active
    u_hasMask: i32,
    // mask texture size in pixels
    u_maskSize: vec2<f32>,
    // Mask's own document-space origin. Distinct from u_srcOffset/effectiveOffset:
    // a raster layer's texture can be cropped to its content bounds while inactive
    // (a storage optimization, not a content move), which shifts u_srcOffset away
    // from the mask's fixed origin. The mask must stay anchored to where it was
    // created, not follow that crop (#850).
    u_maskOffset: vec2<f32>,
    // 1 = render mask as blue overlay (edit mode)
    u_maskOverlay: i32,
    // Document color mode: 1 = Lab, whose textures hold encoded CIELAB. Every
    // non-Normal formula below assumes sRGB channels, so the blend decodes both
    // sides first and re-encodes its result (#1372). Normal is a plain lerp and
    // needs no decode.
    u_docColorMode: i32,
    u_hasBackdrop: i32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_srcTex: texture_2d<f32>;
@group(0) @binding(2) var u_srcTex_sampler: sampler;
@group(0) @binding(3) var u_dstTex: texture_2d<f32>;
@group(0) @binding(4) var u_dstTex_sampler: sampler;
// layer mask texture
@group(0) @binding(5) var u_maskTex: texture_2d<f32>;
@group(0) @binding(6) var u_maskTex_sampler: sampler;
// The layer's own behind effects (outer glow, drop shadow, outside stroke)
// are already in u_dstTex. A non-Normal layer blends with the backdrop as it
// was *before* them (u_backdropTex), and the result covers the effects by the
// layer's coverage. Blending against its own knocked-out shadow multiplied
// the anti-aliased edge into it, a seam darker than the shadow (#1525).
@group(0) @binding(7) var u_backdropTex: texture_2d<f32>;
@group(0) @binding(8) var u_backdropTex_sampler: sampler;

//#include lab
//#include hsl

fn lum(c: vec3<f32>) -> f32 {
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

fn setLum(color: vec3<f32>, l: f32) -> vec3<f32> {
    let d = l - lum(color);
    var c = color + d;
    let n = min(min(c.r, c.g), c.b);
    let x = max(max(c.r, c.g), c.b);
    if (n < 0.0) {
        let ln = lum(c);
        c = ln + (c - ln) * ln / (ln - n);
    }
    if (x > 1.0) {
        let ln = lum(c);
        c = ln + (c - ln) * (1.0 - ln) / (x - ln);
    }
    return c;
}

fn sat(c: vec3<f32>) -> f32 {
    return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
}

// Overlay of `top` on `base`, switching on `base`. Hard Light is the same
// formula switching on the other argument.
fn overlayChannel(top: f32, base: f32, switchOn: f32) -> f32 {
    if (switchOn < 0.5) { return 2.0 * top * base; }
    return 1.0 - 2.0 * (1.0 - top) * (1.0 - base);
}

fn dodgeChannel(s: f32, d: f32) -> f32 {
    if (s >= 1.0) { return 1.0; }
    return min(1.0, d / (1.0 - s));
}

fn burnChannel(s: f32, d: f32) -> f32 {
    if (s <= 0.0) { return 0.0; }
    return max(0.0, 1.0 - (1.0 - d) / s);
}

fn blendMode(src: vec3<f32>, backdrop: vec3<f32>) -> vec3<f32> {
    // RGBA16F textures can hold slightly negative channels (a dithered
    // gradient ramping to 0, say). Soft Light's sqrt and the HSL helpers'
    // divisions turn those into NaN, and a NaN in the composite survives
    // every opaque layer above it (NaN * 0 = NaN) (#1557).
    let s = max(src, vec3<f32>(0.0));
    let d = max(backdrop, vec3<f32>(0.0));
//#if BLEND_MODE == 1
    // Multiply
    return s * d;
//#elif BLEND_MODE == 2
    // Screen
    return s + d - s * d;
//#elif BLEND_MODE == 3
    // Overlay
    return vec3<f32>(
        overlayChannel(s.r, d.r, d.r),
        overlayChannel(s.g, d.g, d.g),
        overlayChannel(s.b, d.b, d.b),
    );
//#elif BLEND_MODE == 4
    // Darken
    return min(s, d);
//#elif BLEND_MODE == 5
    // Lighten
    return max(s, d);
//#elif BLEND_MODE == 6
    // ColorDodge
    return vec3<f32>(dodgeChannel(s.r, d.r), dodgeChannel(s.g, d.g), dodgeChannel(s.b, d.b));
//#elif BLEND_MODE == 7
    // ColorBurn
    return vec3<f32>(burnChannel(s.r, d.r), burnChannel(s.g, d.g), burnChannel(s.b, d.b));
//#elif BLEND_MODE == 8
    // HardLight
    return vec3<f32>(
        overlayChannel(s.r, d.r, s.r),
        overlayChannel(s.g, d.g, s.g),
        overlayChannel(s.b, d.b, s.b),
    );
//#elif BLEND_MODE == 9
    // SoftLight (W3C)
    let dd = mix(sqrt(d), ((16.0 * d - 12.0) * d + 4.0) * d, step(d, vec3<f32>(0.25)));
    return mix(
        d - (1.0 - 2.0 * s) * d * (1.0 - d),
        d + (2.0 * s - 1.0) * (dd - d),
        step(vec3<f32>(0.5), s),
    );
//#elif BLEND_MODE == 10
    // Difference
    return abs(s - d);
//#elif BLEND_MODE == 11
    // Exclusion
    return s + d - 2.0 * s * d;
//#elif BLEND_MODE == 12
    // Hue
    let shsl = rgb2hsl(s);
    let dhsl = rgb2hsl(d);
    return setLum(hsl2rgb(vec3<f32>(shsl.x, dhsl.y, 0.5)), lum(d));
//#elif BLEND_MODE == 13
    // Saturation
    let ss = sat(s);
    var saturation = rgb2hsl(d).y;
    if (ss > 0.0) { saturation = ss; }
    return setLum(hsl2rgb(vec3<f32>(rgb2hsl(d).x, saturation, 0.5)), lum(d));
//#elif BLEND_MODE == 14
    // Color
    return setLum(s, lum(d));
//#elif BLEND_MODE == 15
    // Luminosity
    return setLum(d, lum(s));
//#else
    // Normal (0)
    return s;
//#endif
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let dst = textureSample(u_dstTex, u_dstTex_sampler, uv);

    // Map document UV to layer-local UV. When u_wrapLayer is on, pick the
    // integer shift `n` per axis that puts the fragment closest to the
    // nearest tiled copy of the layer's center — turning overhang on one
    // edge into coverage on the opposite edge. The shift is applied to
    // u_srcOffset (not to the layer texture), so repeated moves keep
    // sampling from the original pixels.
    let docPos = uv * params.u_docSize;
    var effectiveOffset = params.u_srcOffset;
    if (params.u_wrapLayer == 1) {
        let n = floor((docPos - params.u_srcOffset - params.u_srcSize * 0.5) / params.u_docSize + 0.5);
        effectiveOffset = params.u_srcOffset + n * params.u_docSize;
    }
    let layerUV = (docPos - effectiveOffset) / params.u_srcSize;

    // Outside layer bounds: pass through destination
    if (layerUV.x < 0.0 || layerUV.x > 1.0 || layerUV.y < 0.0 || layerUV.y > 1.0) {
        return dst;
    }

    // Everything below the bounds test names its level: a sample that takes
    // its level from derivatives is not allowed after a per-pixel return.
    let srcTexel = textureSampleLevel(u_srcTex, u_srcTex_sampler, layerUV, 0.0);

    // Mask overlay mode: render mask as translucent blue, skip normal blend
    if (params.u_maskOverlay == 1) {
        // mask stored as grayscale in R channel
        let maskVal = srcTexel.r;
        let overlayA = (1.0 - maskVal) * 0.5;
        if (overlayA < 0.001) { return dst; }
        let blue = vec3<f32>(0.0, 0.39, 1.0);
        let outA = overlayA + dst.a * (1.0 - overlayA);
        let outRGB = (overlayA * blue + dst.a * (1.0 - overlayA) * dst.rgb) / outA;
        return vec4<f32>(outRGB, outA);
    }

    var srcRGB = srcTexel.rgb;
    var srcA = srcTexel.a;

    // Un-premultiply if source is premultiplied (e.g. stroke texture)
    if (params.u_srcPremultiplied == 1 && srcA > 0.001) {
        srcRGB /= srcA;
    }

    // Apply color overlay inline — avoids the scratch buffer feedback loop
    if (params.u_overlayEnabled == 1) {
        srcRGB = mix(srcRGB, params.u_overlayColor, params.u_overlayOpacity);
    }

    // Apply layer mask: multiply source alpha by mask value.
    // Sampled at the mask's own fixed origin (u_maskOffset), NOT
    // effectiveOffset — see the u_maskOffset comment above.
    if (params.u_hasMask == 1) {
        let maskUV = (docPos - params.u_maskOffset) / params.u_maskSize;
        if (maskUV.x >= 0.0 && maskUV.x <= 1.0 && maskUV.y >= 0.0 && maskUV.y <= 1.0) {
            srcA *= textureSampleLevel(u_maskTex, u_maskTex_sampler, maskUV, 0.0).r;
        } else {
            srcA = 0.0;
        }
    }

    let sa = srcA * params.u_opacity;
    let da = dst.a;

    if (sa < 0.001) { return dst; }
    if (da < 0.001) { return vec4<f32>(srcRGB, sa); }

//#if BLEND_MODE == 0
    let blended = srcRGB;
    let ba = da;
//#else
    var backdrop = dst;
    if (params.u_hasBackdrop == 1) {
        backdrop = textureSampleLevel(u_backdropTex, u_backdropTex_sampler, uv, 0.0);
    }
    let ba = backdrop.a;
    var blended: vec3<f32>;
    if (params.u_docColorMode == 1) {
        blended = srgbToLab(blendMode(labToSrgb(srcRGB), labToSrgb(backdrop.rgb)));
    } else {
        blended = blendMode(srcRGB, backdrop.rgb);
    }
//#endif
    let outA = sa + da * (1.0 - sa);

    let outRGB = (sa * ba * blended + sa * (1.0 - ba) * srcRGB + da * (1.0 - sa) * dst.rgb) / outA;

    return vec4<f32>(outRGB, outA);
}
