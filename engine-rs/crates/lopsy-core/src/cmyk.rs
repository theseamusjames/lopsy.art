//! Naive (non-ICC) CMYK ink conversions for the "CMYK Color" document mode.
//!
//! This is a device-independent, ink-on-white approximation — the same
//! `k = 255 - max(r,g,b)` maximum-black-generation model used by
//! `psd/reader.rs` for PSD import. It has NO ICC profile, does not model
//! dot gain, ink limiting, or any specific press/paper combination, and is
//! therefore **not colorimetrically accurate for print**. ICC-based
//! conversion (reading the document's CMYK working profile) is future work;
//! this module exists so the engine has a well-defined, reversible mapping
//! between the CMYK ink planes it stores in a texture and the sRGB values
//! it displays on screen.
//!
//! Texture layout: the engine packs CMYK into an RGBA8 texture as
//! R=C, G=M, B=Y, A=K, with real (compositing) alpha kept in a separate
//! plane — see `srgb_pixels_to_cmyk` / `cmyk_pixels_to_srgb`.

/// Naive (non-ICC) CMYK → sRGB. Ink values are 0..=255 where 255 = full ink.
#[inline]
pub fn cmyk_to_srgb(c: u8, m: u8, y: u8, k: u8) -> (u8, u8, u8) {
    let white = 255 - k as u32;
    let r = ((255 - c as u32) * white / 255) as u8;
    let g = ((255 - m as u32) * white / 255) as u8;
    let b = ((255 - y as u32) * white / 255) as u8;
    (r, g, b)
}

/// Naive (non-ICC) sRGB → CMYK with maximum black generation (GCR): the
/// black channel absorbs as much of the color as the darkest of the three
/// primaries allows, and the channel matching the lightest primary always
/// carries zero ink. This is the inverse of `cmyk_to_srgb` and round-trips
/// exactly at 8-bit precision (see cmyk.rs tests).
#[inline]
pub fn srgb_to_cmyk(r: u8, g: u8, b: u8) -> (u8, u8, u8, u8) {
    let max = r.max(g).max(b) as u32;
    let k = 255 - max;

    // Pure black has no achromatic headroom left to derive c/m/y from —
    // dividing by (255 - k) would divide by zero.
    if max == 0 {
        return (0, 0, 0, 255);
    }

    let c = ((max - r as u32) * 255 / max) as u8;
    let m = ((max - g as u32) * 255 / max) as u8;
    let y = ((max - b as u32) * 255 / max) as u8;
    (c, m, y, k as u8)
}

/// Split an RGBA8 sRGB buffer into a CMYK buffer (R=C,G=M,B=Y,A=K) and a
/// separate alpha plane (one byte per pixel). Both outputs are pixel-count
/// sized. Trailing bytes that don't form a full RGBA pixel are ignored
/// rather than causing a panic.
pub fn srgb_pixels_to_cmyk(pixels: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let pixel_count = pixels.len() / 4;
    let mut cmyk = Vec::with_capacity(pixel_count * 4);
    let mut alpha = Vec::with_capacity(pixel_count);

    for px in pixels.chunks_exact(4) {
        let (c, m, y, k) = srgb_to_cmyk(px[0], px[1], px[2]);
        cmyk.push(c);
        cmyk.push(m);
        cmyk.push(y);
        cmyk.push(k);
        alpha.push(px[3]);
    }

    (cmyk, alpha)
}

/// Recombine a CMYK buffer (R=C,G=M,B=Y,A=K) and an alpha plane into RGBA8
/// sRGB. If `alpha` is shorter than the pixel count, missing pixels are
/// treated as opaque (255) rather than panicking on an out-of-bounds read.
pub fn cmyk_pixels_to_srgb(cmyk: &[u8], alpha: &[u8]) -> Vec<u8> {
    let pixel_count = cmyk.len() / 4;
    let mut out = Vec::with_capacity(pixel_count * 4);

    for (i, px) in cmyk.chunks_exact(4).enumerate() {
        let (r, g, b) = cmyk_to_srgb(px[0], px[1], px[2], px[3]);
        let a = alpha.get(i).copied().unwrap_or(255);
        out.push(r);
        out.push(g);
        out.push(b);
        out.push(a);
    }

    out
}

/// Bake an sRGB buffer through a CMYK round trip in place, so the pixels
/// hold only colors the ink model can reproduce. Alpha untouched.
/// `chunks_exact_mut` silently skips a trailing partial pixel instead of
/// panicking on buffers whose length isn't a multiple of 4.
pub fn bake_cmyk_gamut(pixels: &mut [u8]) {
    for px in pixels.chunks_exact_mut(4) {
        let (c, m, y, k) = srgb_to_cmyk(px[0], px[1], px[2]);
        let (r, g, b) = cmyk_to_srgb(c, m, y, k);
        px[0] = r;
        px[1] = g;
        px[2] = b;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn white_has_no_ink_and_round_trips_exactly() {
        assert_eq!(srgb_to_cmyk(255, 255, 255), (0, 0, 0, 0));
        assert_eq!(cmyk_to_srgb(0, 0, 0, 0), (255, 255, 255));
    }

    #[test]
    fn black_is_full_k_and_round_trips_exactly() {
        assert_eq!(srgb_to_cmyk(0, 0, 0), (0, 0, 0, 255));
        assert_eq!(cmyk_to_srgb(0, 0, 0, 255), (0, 0, 0));
    }

    #[test]
    fn red_maps_to_full_magenta_and_yellow_and_round_trips_exactly() {
        assert_eq!(srgb_to_cmyk(255, 0, 0), (0, 255, 255, 0));
        assert_eq!(cmyk_to_srgb(0, 255, 255, 0), (255, 0, 0));
    }

    #[test]
    fn primaries_and_grays_round_trip_exactly() {
        let colors = [
            (0, 255, 0),     // green
            (0, 0, 255),     // blue
            (255, 255, 0),   // yellow
            (0, 255, 255),   // cyan
            (255, 0, 255),   // magenta
            (128, 128, 128), // mid gray
            (1, 0, 0),       // near-black, extreme k
            (254, 255, 255), // near-white
        ];
        for (r, g, b) in colors {
            let (c, m, y, k) = srgb_to_cmyk(r, g, b);
            let (r2, g2, b2) = cmyk_to_srgb(c, m, y, k);
            assert_eq!((r2, g2, b2), (r, g, b), "round trip failed for ({r},{g},{b})");
        }
    }

    /// Sampled sweep over the sRGB cube. The ink-on-white formula turns out
    /// to round-trip exactly at 8-bit precision (see the algebraic note
    /// below), but the contract only promises ±2 — assert the looser bound
    /// while tracking the true observed maximum.
    #[test]
    fn round_trip_sweep_stays_within_tolerance() {
        let mut max_err = 0i32;
        let mut count = 0;
        for r in (0..=255u16).step_by(17) {
            for g in (0..=255u16).step_by(23) {
                for b in (0..=255u16).step_by(29) {
                    let (r, g, b) = (r as u8, g as u8, b as u8);
                    let (c, m, y, k) = srgb_to_cmyk(r, g, b);
                    let (r2, g2, b2) = cmyk_to_srgb(c, m, y, k);
                    max_err = max_err
                        .max((r as i32 - r2 as i32).abs())
                        .max((g as i32 - g2 as i32).abs())
                        .max((b as i32 - b2 as i32).abs());
                    assert!(
                        (r as i32 - r2 as i32).abs() <= 2
                            && (g as i32 - g2 as i32).abs() <= 2
                            && (b as i32 - b2 as i32).abs() <= 2,
                        "round trip drifted too far for ({r},{g},{b}) -> ({r2},{g2},{b2})"
                    );
                    count += 1;
                }
            }
        }
        assert!(count > 100, "sweep should cover 100+ colors, covered {count}");
        // Observed bound in practice is 0 (exact); keep this assertion loose
        // so future formula tweaks (e.g. dot gain) don't need this test edited.
        assert!(max_err <= 2, "max observed round-trip error was {max_err}");
    }

    #[test]
    fn pixel_buffer_round_trip_preserves_alpha_and_color_within_tolerance() {
        let pixels: Vec<u8> = vec![
            10, 20, 30, 40, // arbitrary color, arbitrary alpha
            255, 255, 255, 255, // white, opaque
            0, 0, 0, 0, // black, transparent
            200, 100, 50, 128,
        ];
        let (cmyk, alpha) = srgb_pixels_to_cmyk(&pixels);
        assert_eq!(cmyk.len(), pixels.len() / 4 * 4);
        assert_eq!(alpha, vec![40, 255, 0, 128]);

        let recombined = cmyk_pixels_to_srgb(&cmyk, &alpha);
        assert_eq!(recombined.len(), pixels.len());
        for i in 0..pixels.len() / 4 {
            for ch in 0..3 {
                let orig = pixels[i * 4 + ch] as i32;
                let round_tripped = recombined[i * 4 + ch] as i32;
                assert!(
                    (orig - round_tripped).abs() <= 2,
                    "pixel {i} channel {ch} drifted: {orig} -> {round_tripped}"
                );
            }
            assert_eq!(
                recombined[i * 4 + 3],
                pixels[i * 4 + 3],
                "alpha must be preserved exactly for pixel {i}"
            );
        }
    }

    #[test]
    fn short_alpha_plane_is_treated_as_opaque_not_a_panic() {
        let cmyk = vec![0, 0, 0, 0, 0, 255, 255, 0];
        let alpha = vec![10]; // only one alpha byte for two pixels
        let rgba = cmyk_pixels_to_srgb(&cmyk, &alpha);
        assert_eq!(rgba.len(), 8);
        assert_eq!(rgba[3], 10);
        assert_eq!(rgba[7], 255, "missing alpha byte must default to opaque");
    }

    #[test]
    fn empty_alpha_plane_is_treated_as_opaque_not_a_panic() {
        let cmyk = vec![0, 0, 0, 0];
        let rgba = cmyk_pixels_to_srgb(&cmyk, &[]);
        assert_eq!(rgba, vec![255, 255, 255, 255]);
    }

    #[test]
    fn non_multiple_of_four_buffers_do_not_panic() {
        let (cmyk, alpha) = srgb_pixels_to_cmyk(&[1, 2, 3, 4, 5, 6, 7]);
        assert_eq!(cmyk.len(), 4);
        assert_eq!(alpha.len(), 1);

        let (cmyk2, alpha2) = srgb_pixels_to_cmyk(&[1, 2]);
        assert_eq!(cmyk2.len(), 0);
        assert_eq!(alpha2.len(), 0);

        let mut buf = vec![10u8, 20, 30, 40, 50, 60];
        bake_cmyk_gamut(&mut buf);
        assert_eq!(buf.len(), 6);
        assert_eq!(&buf[4..], &[50, 60], "trailing partial pixel must be left untouched");
    }

    #[test]
    fn empty_input_does_not_panic() {
        let (cmyk, alpha) = srgb_pixels_to_cmyk(&[]);
        assert!(cmyk.is_empty());
        assert!(alpha.is_empty());

        let rgba = cmyk_pixels_to_srgb(&[], &[]);
        assert!(rgba.is_empty());

        let mut empty: Vec<u8> = Vec::new();
        bake_cmyk_gamut(&mut empty);
        assert!(empty.is_empty());
    }

    #[test]
    fn bake_cmyk_gamut_is_idempotent() {
        let original: Vec<u8> = vec![
            10, 20, 30, 255,
            255, 255, 255, 255,
            0, 0, 0, 0,
            200, 100, 50, 128,
            17, 233, 89, 60,
            1, 254, 3, 200,
        ];

        let mut once = original.clone();
        bake_cmyk_gamut(&mut once);

        let mut twice = once.clone();
        bake_cmyk_gamut(&mut twice);

        assert_eq!(once, twice, "a second bake must be a no-op on already-baked pixels");
    }
}
