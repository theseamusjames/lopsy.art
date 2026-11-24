// The sRGB transfer curve extended to every real value, as
// lopsy_core::working_space::srgb_encode and srgb_decode: odd about 0 and
// the same formula above 1, so negative and above-white values survive an
// encode and a decode.
fn srgbEncodeExt(v: f32) -> f32 {
    let a = abs(v);
    var e = a * 12.92;
    if (a > 0.0031308) {
        e = 1.055 * pow(a, 1.0 / f32(2.4)) - 0.055;
    }
    return select(e, -e, v < 0.0);
}

fn srgbDecodeExt(e: f32) -> f32 {
    let a = abs(e);
    var v = a / 12.92;
    if (a > 0.04045) {
        v = pow((a + 0.055) / 1.055, 2.4);
    }
    return select(v, -v, e < 0.0);
}
