// RGB <-> HSL helpers shared through `//#include hsl`.
fn hue2rgb(p: f32, q: f32, hue: f32) -> f32 {
    var t = hue;
    if (t < 0.0) { t += 1.0; }
    if (t > 1.0) { t -= 1.0; }
    if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
    if (t < 1.0 / 2.0) { return q; }
    if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
    return p;
}

fn rgb2hsl(c: vec3<f32>) -> vec3<f32> {
    let mx = max(max(c.r, c.g), c.b);
    let mn = min(min(c.r, c.g), c.b);
    let l = (mx + mn) * 0.5;
    if (mx - mn < 0.00001) { return vec3<f32>(0.0, 0.0, l); }
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
    h /= 6.0;
    return vec3<f32>(h, s, l);
}

fn hsl2rgb(hsl: vec3<f32>) -> vec3<f32> {
    if (hsl.y < 0.00001) { return vec3<f32>(hsl.z); }
    var q: f32;
    if (hsl.z < 0.5) { q = hsl.z * (1.0 + hsl.y); } else { q = hsl.z + hsl.y - hsl.z * hsl.y; }
    let p = 2.0 * hsl.z - q;
    return vec3<f32>(
        hue2rgb(p, q, hsl.x + 1.0 / 3.0),
        hue2rgb(p, q, hsl.x),
        hue2rgb(p, q, hsl.x - 1.0 / 3.0),
    );
}
