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

/// The largest preview decoded at full size for this, in pixels.
const MAX_PREVIEW_PIXELS: u64 = 32_000_000;
/// The correlation below which the match is not trusted.
const MIN_CORRELATION: f64 = 0.8;

/// The camera's full-size JPEG of the crop's size, decoded: 8-bit RGB.
fn full_size_preview(data: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    if u64::from(width) * u64::from(height) > MAX_PREVIEW_PIXELS {
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
    let mut best = (f64::MIN, 0usize, 0usize);
    for top in 0..=spare_y {
        for left in 0..=spare_x {
            let r = correlation(mosaic, info, &jpeg, left, top);
            if r > best.0 {
                best = (r, left, top);
            }
        }
    }
    if best.0 >= MIN_CORRELATION {
        info.crop.left = best.1 as u32;
        info.crop.top = best.2 as u32;
        info.sources.crop = format!("the {width}×{height} preview, placed where it matches (correlation {:.3})", best.0);
        info.debug_log.push(format!("[NEF] crop {:?} from {}", info.crop, info.sources.crop));
    }
}
