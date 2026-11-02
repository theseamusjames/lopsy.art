//! Banded RAF rendering must reproduce the whole-frame decode exactly: the
//! import path renders bands on separate workers and stitches them on the
//! GPU, so any seam would show up as a visible line in the image.

mod support;

use lopsy_core::raf::{
    plan_bands, prepare_raf, read_raf, render_band, RafBand, RafDecodeOpts, RafRenderParams, BAND_HALO_ROWS,
};
use support::synthetic_raf::SyntheticRaf;

/// Renders `bands` and pastes them into an oriented full-size buffer.
fn render_banded(data: &[u8], bands: &[RafBand]) -> (u32, u32, Vec<f32>) {
    let prep = prepare_raf(data, RafDecodeOpts::default()).unwrap();
    // Workers get the params as JSON, so render from the round-tripped copy.
    let json = serde_json::to_string(&prep.params).unwrap();
    let params: RafRenderParams = serde_json::from_str(&json).unwrap();
    let p = &params;
    let (ow, oh) = p.oriented_size();
    let mut out = vec![f32::NAN; (ow * oh * 4) as usize];
    let w = p.width as usize;
    for &band in bands {
        let src = &prep.mosaic[band.src_y0 as usize * w..band.src_y1 as usize * w];
        let px = render_band(src, p, band).unwrap();
        assert_eq!(px.pixels.len(), (px.width * px.height * 4) as usize);
        assert!(px.x + px.width <= ow && px.y + px.height <= oh, "{band:?} lands outside the image");
        for row in 0..px.height {
            let dst = (((px.y + row) * ow + px.x) * 4) as usize;
            let src = (row * px.width * 4) as usize;
            let len = (px.width * 4) as usize;
            out[dst..dst + len].copy_from_slice(&px.pixels[src..src + len]);
        }
    }
    (ow, oh, out)
}

fn assert_bit_identical(name: &str, expected: &[f32], actual: &[f32]) {
    assert_eq!(expected.len(), actual.len(), "{name}: length");
    let mismatches = expected
        .iter()
        .zip(actual)
        .filter(|(e, a)| e.to_bits() != a.to_bits())
        .count();
    assert_eq!(mismatches, 0, "{name}: {mismatches} values differ from the whole-frame decode");
}

#[test]
fn halo_covers_the_render_reach_and_keeps_cfa_phase() {
    assert!(BAND_HALO_ROWS >= lopsy_core::raf::RENDER_REACH_ROWS);
    assert_eq!(BAND_HALO_ROWS % 6, 0);
}

#[test]
fn planned_bands_match_whole_frame_decode_in_every_orientation() {
    for orientation in 1..=8u16 {
        let mut cfg = SyntheticRaf::small(331, 418);
        cfg.orientation = orientation;
        let data = cfg.build();
        let whole = read_raf(&data).unwrap();
        let bands = plan_bands(418, 4);
        assert_eq!(bands.len(), 4);
        let (w, h, banded) = render_banded(&data, &bands);
        assert_eq!((w, h), (whole.width, whole.height), "orientation {orientation}");
        assert_bit_identical(&format!("orientation {orientation}"), &whole.pixels, &banded);
    }
}

#[test]
fn thin_bands_match_whole_frame_decode() {
    // Six-row bands put every output row within the halo of a band edge.
    let mut cfg = SyntheticRaf::small(205, 160);
    cfg.crop_top = 4;
    cfg.crop_left = 9;
    let data = cfg.build();
    let whole = read_raf(&data).unwrap();
    let height = 160;
    let bands: Vec<RafBand> = (0..height)
        .step_by(6)
        .map(|y0| {
            let y1 = (y0 + 6).min(height);
            RafBand {
                y0,
                y1,
                src_y0: y0.saturating_sub(BAND_HALO_ROWS),
                src_y1: (y1 + BAND_HALO_ROWS).min(height),
            }
        })
        .collect();
    let (_, _, banded) = render_banded(&data, &bands);
    assert_bit_identical("thin bands", &whole.pixels, &banded);
}

#[test]
fn bayer_bands_match_whole_frame_decode() {
    let mut cfg = SyntheticRaf::small(240, 300);
    cfg.model = "X-A5";
    let data = cfg.build();
    let whole = read_raf(&data).unwrap();
    let (_, _, banded) = render_banded(&data, &plan_bands(300, 3));
    assert_bit_identical("bayer", &whole.pixels, &banded);
}

#[test]
fn plan_bands_tiles_the_frame_on_cfa_boundaries() {
    for (height, max) in [(5152u32, 16u32), (418, 4), (97, 8), (7, 3), (1, 4), (600, 1)] {
        let bands = plan_bands(height, max);
        assert!(!bands.is_empty() && bands.len() as u32 <= max);
        assert_eq!(bands[0].y0, 0);
        assert_eq!(bands.last().unwrap().y1, height);
        for pair in bands.windows(2) {
            assert_eq!(pair[0].y1, pair[1].y0);
        }
        for b in &bands {
            assert!(b.y0 < b.y1, "{height}/{max}: empty band {b:?}");
            assert_eq!(b.y0 % 6, 0);
            assert_eq!(b.src_y0 % 6, 0);
        }
    }
}

#[test]
fn render_band_rejects_a_misaligned_source() {
    let data = SyntheticRaf::small(64, 64).build();
    let prep = prepare_raf(&data, RafDecodeOpts::default()).unwrap();
    let band = RafBand { y0: 9, y1: 20, src_y0: 3, src_y1: 40 };
    let src = &prep.mosaic[3 * 64..40 * 64];
    assert!(render_band(src, &prep.params, band).is_err());
}
