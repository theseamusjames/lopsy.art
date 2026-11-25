// An area's mask at a document pixel, 0..1 times its amount: the maths of
// lopsy_core::areas::mask, the CPU reference; change the two together.
// a0, a1 and a2 are the first three vectors of the area's 16 floats:
// (kind, invert, amount, x0), (y0, x1, y1, rotation), (feather, ...).
fn smoothstep1(e0: f32, e1: f32, x: f32) -> f32 {
    let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

fn areaMask(a0: vec4<f32>, a1: vec4<f32>, a2: vec4<f32>, p: vec2<f32>) -> f32 {
    var m = 0.0;
    if (a0.x == 1.0) {
        let q = p - vec2<f32>(a0.w, a1.x);
        let s = sin(a1.w);
        let c = cos(a1.w);
        let u = (q.x * c + q.y * s) / max(abs(a1.y), 1e-3);
        let v = (-q.x * s + q.y * c) / max(abs(a1.z), 1e-3);
        let r = sqrt(u * u + v * v);
        m = 1.0 - smoothstep1(1.0 - max(a2.x, 1e-3), 1.0, r);
    } else {
        let d = vec2<f32>(a1.y - a0.w, a1.z - a1.x);
        let len2 = dot(d, d);
        if (len2 >= 1e-6) {
            let t = dot(p - vec2<f32>(a0.w, a1.x), d) / len2;
            m = 1.0 - smoothstep1(0.0, 1.0, t);
        }
    }
    if (a0.y >= 0.5) {
        m = 1.0 - m;
    }
    return m * a0.z;
}
