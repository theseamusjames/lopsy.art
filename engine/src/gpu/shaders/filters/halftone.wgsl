struct Params {
    u_dotSize: f32,
    u_angle: f32,
    u_contrast: f32,
    u_density: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;

//#include premul_sample

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let texSize = vec2<f32>(textureDimensions(u_tex, 0));
    let pixelCoord = uv * texSize;

    // Cell spacing: higher density = tighter packing
    let spacing = params.u_dotSize / params.u_density;

    // Rotate coordinates by the halftone angle
    let rad = params.u_angle * 3.14159265 / 180.0;
    let cosA = cos(rad);
    let sinA = sin(rad);
    let rot = mat2x2<f32>(cosA, sinA, -sinA, cosA);
    let rotated = rot * pixelCoord;

    // Find the center of the nearest halftone cell
    let cellIndex = floor(rotated / spacing);
    let cellCenter = (cellIndex + 0.5) * spacing;

    // Rotate cell center back to sample the original image
    let invRot = mat2x2<f32>(cosA, -sinA, sinA, cosA);
    let samplePos = invRot * cellCenter;

    // Clamp UV to avoid sampling outside texture
    let sampleUV = clamp(samplePos / texSize, vec2<f32>(0.0), vec2<f32>(1.0));

    // Cell centres can land between texels on an anti-aliased edge. A
    // straight-alpha LINEAR fetch averages in the transparent neighbours'
    // black RGB, which darkens lum and blows the dot up past the
    // silhouette as a faint ghost (#1195).
    let c = samplePremulBilinear(u_tex, sampleUV);

    // Convert to luminance for dot size calculation
    let lum = dot(c.rgb, vec3<f32>(0.299, 0.587, 0.114));

    // Distance from pixel to cell center in rotated space
    let delta = rotated - cellCenter;
    let dist = length(delta);

    // Dot radius is proportional to luminance (brighter = smaller dot for CMYK-style)
    // Invert so dark areas get big dots, light areas get small dots
    let maxRadius = params.u_dotSize * 0.5;
    let dotRadius = maxRadius * max(1.0 - lum, 0.0);

    // Softness is the half-width of the ramp centred on the dot radius.
    // #1177: a ramp wider than the dot reached past the cell centre, so a
    // zero-radius (pure white) dot still printed a soft dot of radius
    // ~softness. Narrow the ramp to the dot radius so small dots stay
    // proportional and white cells stay empty; dots at least `softness`
    // wide are unchanged.
    //
    // smoothstep() is undefined when its two edges are equal, which happens
    // at Softness 0 (#878); floor the half-width at a tiny epsilon so the
    // edges are always distinct, indistinguishable from a hard step at
    // dist == dotRadius. Dots under 1e-3 px (white, give or take float
    // rounding of the luminance weights) print nothing.
    let halfWidth = max(min(params.u_contrast, dotRadius), 1e-4);
    var edge = 0.0;
    if (dotRadius > 1e-3) {
        // A falling ramp from 1 inside the dot to 0 outside. Written out
        // because WGSL's smoothstep is only defined for low < high.
        let hi = dotRadius + halfWidth;
        let lo = dotRadius - halfWidth;
        let t = clamp((dist - hi) / (lo - hi), 0.0, 1.0);
        edge = t * t * (3.0 - 2.0 * t);
    }

    // Output: dot color where inside dot, transparent where outside
    return vec4<f32>(c.rgb, c.a * edge);
}
