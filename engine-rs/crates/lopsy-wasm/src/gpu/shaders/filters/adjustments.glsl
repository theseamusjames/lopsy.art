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
out vec4 fragColor;
void main() {
    vec4 c = texture(u_tex, v_uv);
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
        // Sample at the centre of each texel column for crisp lookups.
        float ofs = 0.5 / 256.0;
        c.r = texture(u_curveLut, vec2(c.r + ofs, 0.5)).a;
        c.g = texture(u_curveLut, vec2(c.g + ofs, 0.5)).a;
        c.b = texture(u_curveLut, vec2(c.b + ofs, 0.5)).a;
        c.r = texture(u_curveLut, vec2(c.r + ofs, 0.5)).r;
        c.g = texture(u_curveLut, vec2(c.g + ofs, 0.5)).g;
        c.b = texture(u_curveLut, vec2(c.b + ofs, 0.5)).b;
    }

    fragColor = vec4(c.rgb, c.a);
}
