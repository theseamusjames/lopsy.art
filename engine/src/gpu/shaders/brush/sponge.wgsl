struct Params {
    u_mode: i32,
    u_exposure: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_layerTex: texture_2d<f32>;
@group(0) @binding(2) var u_layerTex_sampler: sampler;
@group(0) @binding(3) var u_stampTex: texture_2d<f32>;
@group(0) @binding(4) var u_stampTex_sampler: sampler;

// Its own HSL helpers rather than `//#include hsl`: these test for exact
// grey (mx == mn, s == 0), where the shared ones use a 1e-5 threshold.
fn rgbToHsl(c: vec3<f32>) -> vec3<f32> {
    let mx = max(c.r, max(c.g, c.b));
    let mn = min(c.r, min(c.g, c.b));
    let l = (mx + mn) * 0.5;
    if (mx == mn) { return vec3<f32>(0.0, 0.0, l); }
    let d = mx - mn;
    var s: f32;
    if (l > 0.5) { s = d / (2.0 - mx - mn); } else { s = d / (mx + mn); }
    var h: f32;
    if (mx == c.r) {
        var wrap = 0.0;
        if (c.g < c.b) { wrap = 6.0; }
        h = (c.g - c.b) / d + wrap;
    } else if (mx == c.g) {
        h = (c.b - c.r) / d + 2.0;
    } else {
        h = (c.r - c.g) / d + 4.0;
    }
    return vec3<f32>(h / 6.0, s, l);
}

fn hue2rgb(p: f32, q: f32, t: f32) -> f32 {
    var tt = t;
    if (tt < 0.0) { tt += 1.0; }
    if (tt > 1.0) { tt -= 1.0; }
    if (tt < 1.0 / 6.0) { return p + (q - p) * 6.0 * tt; }
    if (tt < 0.5) { return q; }
    if (tt < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - tt) * 6.0; }
    return p;
}

fn hslToRgb(hsl: vec3<f32>) -> vec3<f32> {
    if (hsl.y == 0.0) { return vec3<f32>(hsl.z); }
    var q: f32;
    if (hsl.z < 0.5) { q = hsl.z * (1.0 + hsl.y); } else { q = hsl.z + hsl.y - hsl.z * hsl.y; }
    let p = 2.0 * hsl.z - q;
    return vec3<f32>(
        hue2rgb(p, q, hsl.x + 1.0 / 3.0),
        hue2rgb(p, q, hsl.x),
        hue2rgb(p, q, hsl.x - 1.0 / 3.0),
    );
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let c = textureSample(u_layerTex, u_layerTex_sampler, uv);
    let stamp = textureSample(u_stampTex, u_stampTex_sampler, uv).r;
    let strength = stamp * params.u_exposure;
    if (strength < 0.001 || c.a < 0.001) {
        return c;
    }
    var hsl = rgbToHsl(c.rgb);
    if (params.u_mode == 0) {
        hsl.y = min(1.0, hsl.y + strength);
    } else {
        hsl.y = max(0.0, hsl.y - strength);
    }
    return vec4<f32>(clamp(hslToRgb(hsl), vec3<f32>(0.0), vec3<f32>(1.0)), c.a);
}
