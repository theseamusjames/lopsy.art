// A document that is one rectangle of a larger picture (lopsy_core::tile).
// `region` is (x, y, whole width, whole height) in whole-document pixels, or
// all zeros for none; with none, each function below is today's arithmetic.

// The point of the whole picture at document point `p` (a pixel's centre):
// `p` moved by the region's origin. The origin is a whole number, so the
// sum is exact and equals the whole render's own `position.xy`.
fn wholePoint(p: vec2<f32>, region: vec4<f32>) -> vec2<f32> {
    if (region.z > 0.0) {
        return p + region.xy;
    }
    return p;
}

// Where a combining shader reads a blurred texture for the pixel at `p`.
// `grid` is all zeros for a texture of the document's own size, read at
// `p / docSize`; or, for a blur image on the whole picture's grid (one as
// large as the whole's, with the part the tile needs drawn), the region,
// read at the whole render's own coordinate.
fn blurUv(p: vec2<f32>, grid: vec4<f32>, docSize: vec2<f32>) -> vec2<f32> {
    if (grid.z > 0.0) {
        return (p + grid.xy) / grid.zw;
    }
    return p / docSize;
}
