//! Where the picture is in a mosaic whose maker note gives no crop.
//!
//! The older bodies (D200, D3, D7000 among the samples) record no crop,
//! and their mosaics are larger than the camera's picture by a few columns
//! and rows, not always evenly: the D7000's last 44 columns hold no
//! picture and its first eight do. `read_info` takes the size of the
//! camera's full-size JPEG, centred; once the mosaic is decoded,
//! [`place_by_preview`] moves that window to where the JPEG really is: the
//! offset at which the mosaic's green samples correlate best with the
//! JPEG's green over the middle of the picture. On the samples it agrees
//! with the centred guess on the D200 and moves the D3's by one column
//! and the D7000's by 24.

use super::{exposure, Crop, NefInfo};

use crate::arw::exposure::{preview_header_fits, MAX_DECODE_BYTES};

/// The correlation below which the match is not trusted.
const MIN_CORRELATION: f64 = 0.8;

/// Whether a full-size RGB preview of `width` × `height` may be decoded.
/// The JPEG decoder fills a plane per component before it checks its own
/// limit, so the size is bounded before decoding: by the decode buffer the
/// other preview decodes are held to (`arw::exposure`, 64 MB, about
/// 22 MP at three bytes a pixel), and by the RAW limits.
fn decodable(width: u32, height: u32) -> bool {
    let (Ok(w), Ok(h)) = (u16::try_from(width), u16::try_from(height)) else { return false };
    u64::from(width) * u64::from(height) * 3 <= MAX_DECODE_BYTES as u64 && preview_header_fits(w, h, 3, false, width.max(height))
}

/// The camera's full-size JPEG of the crop's size, decoded: 8-bit RGB.
fn full_size_preview(data: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    if !decodable(width, height) {
        return None;
    }
    for (o, n) in exposure::jpeg_ranges(data) {
        let mut dec = jpeg_decoder::Decoder::new(data.get(o..o.checked_add(n)?)?);
        if dec.read_info().is_err() {
            continue;
        }
        let Some(info) = dec.info() else { continue };
        if (u32::from(info.width), u32::from(info.height)) != (width, height) || info.pixel_format != jpeg_decoder::PixelFormat::RGB24 || info.coding_process == jpeg_decoder::CodingProcess::DctProgressive {
            continue;
        }
        dec.set_max_decoding_buffer_size(MAX_DECODE_BYTES);
        let px = dec.decode().ok()?;
        return (px.len() == width as usize * height as usize * 3).then_some(px);
    }
    None
}

/// The Pearson correlation of the mosaic's green samples (square root, to
/// be near the JPEG's encoding) with the JPEG's green, the JPEG placed at
/// (`left`, `top`) in the mosaic, over the middle 40 % of the JPEG.
fn correlation(mosaic: &[u16], info: &NefInfo, jpeg: &[u8], left: usize, top: usize) -> f64 {
    let (w, jw, jh) = (info.width as usize, info.crop.width as usize, info.crop.height as usize);
    // About 150 × 130 samples whatever the size, odd steps so both
    // parities of row and column are met.
    let odd = |s: usize| s | 1;
    let (sx, sy) = (odd((jw * 2 / 5 / 150).max(3)), odd((jh * 2 / 5 / 130).max(7)));
    let (mut sa, mut sb, mut saa, mut sbb, mut sab, mut n) = (0f64, 0f64, 0f64, 0f64, 0f64, 0f64);
    for y in (jh * 3 / 10..jh * 7 / 10).step_by(sy) {
        for x in (jw * 3 / 10..jw * 7 / 10).step_by(sx) {
            let (mx, my) = (x + left, y + top);
            if info.cfa[(my & 1) * 2 + (mx & 1)] != 1 {
                continue;
            }
            let (Some(&m), Some(&j)) = (mosaic.get(my * w + mx), jpeg.get((y * jw + x) * 3 + 1)) else { continue };
            let (a, b) = (f64::from(m).sqrt(), f64::from(j));
            sa += a;
            sb += b;
            saa += a * a;
            sbb += b * b;
            sab += a * b;
            n += 1.0;
        }
    }
    if n < 2.0 {
        return 0.0;
    }
    let var = (saa / n - (sa / n).powi(2)) * (sbb / n - (sb / n).powi(2));
    if var > 0.0 { (sab / n - sa / n * sb / n) / var.sqrt() } else { 0.0 }
}

/// How far the fine pass looks around the coarse pass's best offset.
const FINE_REACH: usize = 2;

/// The offset in `0..=spare_x` × `0..=spare_y` where `score` is highest,
/// with its score: every other offset each way first, then every offset
/// within [`FINE_REACH`] of the best of those. A match falls off over a
/// few pixels, so the coarse pass lands next to it; the work is about a
/// quarter of trying every offset (at most 65 × 65 + 25 tries for the 128
/// spare columns and rows `read_info` allows, not 129 × 129).
fn search(spare_x: usize, spare_y: usize, mut score: impl FnMut(usize, usize) -> f64) -> (f64, usize, usize) {
    let mut best = (f64::MIN, 0usize, 0usize);
    let mut consider = |left: usize, top: usize, best: &mut (f64, usize, usize)| {
        let r = score(left, top);
        if r > best.0 {
            *best = (r, left, top);
        }
    };
    for top in (0..=spare_y).step_by(2) {
        for left in (0..=spare_x).step_by(2) {
            consider(left, top, &mut best);
        }
    }
    let (cl, ct) = (best.1, best.2);
    for top in ct.saturating_sub(FINE_REACH)..=(ct + FINE_REACH).min(spare_y) {
        for left in cl.saturating_sub(FINE_REACH)..=(cl + FINE_REACH).min(spare_x) {
            if left % 2 == 1 || top % 2 == 1 {
                consider(left, top, &mut best);
            }
        }
    }
    best
}

/// Move a crop `read_info` centred on the camera's JPEG to where that JPEG
/// is in the decoded mosaic; any other crop, or a file without a usable
/// full-size JPEG, is left as it is. Bounded: `read_info` allows at most
/// 128 spare columns and rows.
pub fn place_by_preview(data: &[u8], info: &mut NefInfo, mosaic: &[u16]) {
    if !info.sources.crop.ends_with("preview, centred") || mosaic.len() != info.width as usize * info.height as usize {
        return;
    }
    let Crop { width, height, .. } = info.crop;
    let Some(jpeg) = full_size_preview(data, width, height) else { return };
    let (spare_x, spare_y) = ((info.width - width) as usize, (info.height - height) as usize);
    let best = search(spare_x, spare_y, |left, top| correlation(mosaic, info, &jpeg, left, top));
    if best.0 >= MIN_CORRELATION {
        info.crop.left = best.1 as u32;
        info.crop.top = best.2 as u32;
        info.sources.crop = format!("the {width}×{height} preview, placed where it matches (correlation {:.3})", best.0);
        info.debug_log.push(format!("[NEF] crop {:?} from {}", info.crop, info.sources.crop));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_search_finds_an_odd_offset_in_a_bounded_number_of_tries() {
        // A peak that falls off over a few pixels, at odd offsets.
        for (px, py) in [(1usize, 1usize), (15, 6), (127, 3), (64, 128), (0, 0), (128, 128)] {
            let mut tries = 0;
            let best = search(128, 128, |x, y| {
                tries += 1;
                let d = (x as f64 - px as f64).hypot(y as f64 - py as f64);
                1.0 / (1.0 + d / 2.0)
            });
            assert_eq!((best.1, best.2), (px, py));
            assert!(tries <= 65 * 65 + 25, "{tries} tries");
        }
        // No spare at all: the one offset.
        assert_eq!(search(0, 0, |_, _| 0.5), (0.5, 0, 0));
    }

    #[test]
    fn a_full_size_preview_is_decoded_only_within_the_preview_buffer() {
        // The samples that take this path: D200, D3, D7000.
        for (w, h) in [(3872, 2592), (4256, 2832), (4928, 3264)] {
            assert!(decodable(w, h), "{w} × {h}");
        }
        // A header claiming more (up to the old 32 MP cap) is not decoded:
        // its planes alone would be about 90 MB before any check.
        for (w, h) in [(6000, 4000), (6532, 4898), (8192, 3000), (0, 100), (70_000, 10)] {
            assert!(!decodable(w, h), "{w} × {h}");
        }
    }
}
