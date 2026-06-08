//! EXIF/TIFF orientation transforms for decoded RGBA f32 buffers.
//!
//! Raw decoders (RAF, DNG) read the sensor in its native scan order, which is
//! usually landscape. The camera records how the frame should be displayed in
//! the TIFF Orientation tag (0x0112). Both decoders apply it here so the rest
//! of the pipeline only ever sees upright pixels.

/// Apply an EXIF orientation value (1..=8) to an RGBA f32 buffer.
///
/// Returns the transformed `(width, height, pixels)`. For the four
/// "rotated 90°" orientations (5..=8) the width and height swap. Orientation
/// 1 (and the absent/0 case) is a no-op copy.
pub fn apply_exif_orientation(w: u32, h: u32, src: &[f32], orientation: u16) -> (u32, u32, Vec<f32>) {
    let wu = w as usize;
    let hu = h as usize;
    if orientation == 1 || orientation == 0 {
        return (w, h, src.to_vec());
    }

    // For 5..=8 the dimensions swap.
    let (out_w, out_h) = match orientation {
        5 | 6 | 7 | 8 => (h, w),
        _ => (w, h),
    };
    let owu = out_w as usize;
    let ohu = out_h as usize;
    let mut dst = vec![0.0f32; owu * ohu * 4];

    for y in 0..hu {
        for x in 0..wu {
            let s = (y * wu + x) * 4;
            // (out_x, out_y) given (x, y) for each orientation
            let (ox, oy) = match orientation {
                2 => (wu - 1 - x, y),              // flip horizontal
                3 => (wu - 1 - x, hu - 1 - y),     // rotate 180
                4 => (x, hu - 1 - y),              // flip vertical
                5 => (y, x),                        // transpose
                6 => (hu - 1 - y, x),              // rotate 90 CW
                7 => (hu - 1 - y, wu - 1 - x),     // transverse
                8 => (y, wu - 1 - x),              // rotate 90 CCW
                _ => (x, y),
            };
            let d = (oy * owu + ox) * 4;
            dst[d] = src[s];
            dst[d + 1] = src[s + 1];
            dst[d + 2] = src[s + 2];
            dst[d + 3] = src[s + 3];
        }
    }
    (out_w, out_h, dst)
}

#[cfg(test)]
mod tests {
    use super::*;

    // A 2×1 image: pixel (0,0) red, pixel (1,0) green.
    fn two_by_one() -> Vec<f32> {
        vec![
            1.0, 0.0, 0.0, 1.0, // (0,0) red
            0.0, 1.0, 0.0, 1.0, // (1,0) green
        ]
    }

    fn px(buf: &[f32], w: u32, x: u32, y: u32) -> [f32; 4] {
        let i = ((y * w + x) * 4) as usize;
        [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]
    }

    #[test]
    fn identity_is_noop() {
        let (w, h, out) = apply_exif_orientation(2, 1, &two_by_one(), 1);
        assert_eq!((w, h), (2, 1));
        assert_eq!(out, two_by_one());
    }

    #[test]
    fn absent_orientation_is_noop() {
        let (w, h, out) = apply_exif_orientation(2, 1, &two_by_one(), 0);
        assert_eq!((w, h), (2, 1));
        assert_eq!(out, two_by_one());
    }

    #[test]
    fn rotate_90_cw_swaps_dims() {
        // Orientation 6: a landscape 2×1 becomes a portrait 1×2.
        // Source (x,y)->(out_h-1-y, x); with h=1, out is 1 wide, 2 tall.
        let (w, h, out) = apply_exif_orientation(2, 1, &two_by_one(), 6);
        assert_eq!((w, h), (1, 2));
        // Red at source (0,0) -> (0,0); green at (1,0) -> (0,1).
        assert_eq!(px(&out, 1, 0, 0), [1.0, 0.0, 0.0, 1.0]);
        assert_eq!(px(&out, 1, 0, 1), [0.0, 1.0, 0.0, 1.0]);
    }

    #[test]
    fn flip_horizontal_preserves_dims() {
        let (w, h, out) = apply_exif_orientation(2, 1, &two_by_one(), 2);
        assert_eq!((w, h), (2, 1));
        // Red and green swap horizontally.
        assert_eq!(px(&out, 2, 0, 0), [0.0, 1.0, 0.0, 1.0]);
        assert_eq!(px(&out, 2, 1, 0), [1.0, 0.0, 0.0, 1.0]);
    }
}
