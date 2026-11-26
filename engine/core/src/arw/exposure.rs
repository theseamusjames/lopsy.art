//! The baked ARW decode's exposure: matched to the camera's own rendering
//! of the same frame, the JPEG preview Sony embeds in every ARW, so a file
//! opens as bright as the camera showed it.
//!
//! **The preview.** Of the JPEGs in IFD0's chain (`JPEGInterchangeFormat`),
//! those that are the whole picture: the crop's aspect, after orientation,
//! within 1 % (the EXIF thumbnail is 4:3 with bands, and is left out). Of
//! those, the smallest whose long edge is at least 1000 pixels (the
//! 1616 × 1080 preview on every sample), else the largest of at least 256.
//! It is decoded at the first scale (1, 1/2, 1/4, 1/8) whose long edge is
//! at least 800 pixels. None, or one that does not decode: no lift, and
//! the decode is what it was before exposure matching.
//!
//! **The median.** Luminance is Rec. 709 Y of linear sRGB, encoded with the
//! sRGB curve, so a median is "a middle grey as seen". The preview's comes
//! from its decoded pixels. Ours comes from a copy of the decode, after the
//! camera matrix, box-averaged in linear light to the preview's pixel
//! count, put through exactly the per-pixel steps the full decode takes for
//! a given exposure ([`render_pixel`]).
//!
//! **The exposure** is the one at which the two medians are equal, found
//! by bisection on that small copy (16 steps over the bounds, far finer
//! than a visible difference), never by re-running the full decode. Its
//! bounds are −1 and +3 stops: the camera's JPEG can be darker than a
//! neutral rendering (a scene the photographer exposed to the right, or a
//! dark creative style), but rarely by more than a stop; and on the
//! samples it is up to +1.75 brighter, so +3 leaves room for an
//! underexposed frame without letting a black or blank preview push a
//! file to a white sheet. A preview whose median is nearly black or white
//! (below 0.02 or above 0.98 encoded) says nothing about exposure: no lift.
//!
//! **Highlights** roll off instead of clipping, with the develop chain's
//! output-step roll-off (`output::rolloff` on luminance, the three channels
//! scaled together so hue is kept, then `output::gamut_map` toward white
//! for a channel still above 1). Neither of its two numbers is fitted to
//! anything; both come from the file and the gain `g`:
//! - the knee is the picture's median luminance after the gain, so the
//!   darker half of the picture takes the gain alone (a pure exposure
//!   change) and only the brighter half is compressed;
//! - the peak is the one at which the brightest value the sensor recorded
//!   (white after the clip below, luminance `g` after the gain) lands at
//!   `CLIP_WHITE`, just under white: what the camera clipped stays white,
//!   everything under it stays under it.
//! With `g ≤ 1` nothing is above white and there is no roll-off. Before
//! the matrix, every channel is clipped at the lowest clip level, so a
//! clipped highlight is white whatever the white-balance gains.
//!
//! **Auto-levels** (the DNG baked decode's percentile stretch) is not used
//! when the exposure is matched: it is a second adaptation of the same
//! brightness, and would move the median off the camera's. A file without
//! a usable preview keeps it, as before.

use crate::dng::tiff::TiffReader;
use crate::output::{gamut_map, rolloff};
use crate::working_space::{luma, srgb_decode, srgb_encode, Gamut};

/// The bounds on the exposure, in stops.
pub const MIN_EV: f32 = -1.0;
pub const MAX_EV: f32 = 3.0;
/// Where the sensor's clipped white lands after the roll-off (linear; 254
/// of 255 encoded).
pub const CLIP_WHITE: f32 = 0.99;
/// A preview's median outside this range is not used.
const MEDIAN_RANGE: (f32, f32) = (0.02, 0.98);
const MIN_LONG_EDGE: u32 = 1000;
const FALLBACK_LONG_EDGE: u32 = 256;
const DECODE_LONG_EDGE: u16 = 800;
/// The largest JPEG preview read, in bytes, and its decode buffer.
const MAX_PREVIEW_BYTES: usize = 32 << 20;
const MAX_DECODE_BYTES: usize = 64 << 20;

/// The embedded preview's luminance: encoded Y of each pixel.
pub struct Preview {
    pub width: u32,
    pub height: u32,
    pub median: f32,
}

fn encoded_luma(rgb: [f32; 3]) -> f32 {
    let w = luma(Gamut::Srgb);
    srgb_encode((w[0] * rgb[0] + w[1] * rgb[1] + w[2] * rgb[2]).clamp(0.0, 1.0))
}

/// The median of `v` (reordered), or `None` when empty.
pub fn median(v: &mut [f32]) -> Option<f32> {
    if v.is_empty() {
        return None;
    }
    let mid = v.len() / 2;
    let (_, m, _) = v.select_nth_unstable_by(mid, f32::total_cmp);
    Some(*m)
}

/// The JPEGs in IFD0's chain as (offset, length), inside the file.
fn jpeg_ranges(data: &[u8]) -> Vec<(usize, usize)> {
    let Ok(reader) = TiffReader::new(data) else { return Vec::new() };
    let mut out = Vec::new();
    for i in 0..8 {
        let Ok(ifd) = reader.read_ifd(i) else { break };
        let get = |tag: u16| ifd.iter().find(|e| e.tag == tag).and_then(|e| e.as_u32());
        if let (Some(o), Some(n)) = (get(0x201), get(0x202)) {
            let (o, n) = (o as usize, n as usize);
            if n > 0 && n <= MAX_PREVIEW_BYTES && o.checked_add(n).is_some_and(|end| end <= data.len()) {
                out.push((o, n));
            }
        }
    }
    out
}

/// The camera's preview of the whole picture (`aspect` = width / height
/// after orientation), its luminance median, or `None` (see the module
/// notes). Never fails: a JPEG that does not decode is skipped.
pub fn whole_picture_preview(data: &[u8], aspect: f64) -> Option<Preview> {
    // Headers first, to choose without decoding every candidate.
    let mut candidates: Vec<(usize, usize, u32, u32)> = Vec::new();
    for (o, n) in jpeg_ranges(data) {
        let mut dec = jpeg_decoder::Decoder::new(&data[o..o + n]);
        if dec.read_info().is_err() {
            continue;
        }
        let Some(info) = dec.info() else { continue };
        let (w, h) = (u32::from(info.width), u32::from(info.height));
        if w == 0 || h == 0 || (f64::from(w) / f64::from(h) / aspect - 1.0).abs() > 0.01 {
            continue;
        }
        candidates.push((o, n, w, h));
    }
    let long = |c: &(usize, usize, u32, u32)| c.2.max(c.3);
    let chosen = candidates
        .iter()
        .filter(|c| long(c) >= MIN_LONG_EDGE)
        .min_by_key(|c| long(c))
        .or_else(|| candidates.iter().filter(|c| long(c) >= FALLBACK_LONG_EDGE).max_by_key(|c| long(c)))?;
    let (o, n, w, h) = *chosen;
    let mut dec = jpeg_decoder::Decoder::new(&data[o..o + n]);
    dec.set_max_decoding_buffer_size(MAX_DECODE_BYTES);
    let scale = f64::from(DECODE_LONG_EDGE) / f64::from(w.max(h));
    let (rw, rh) = ((f64::from(w) * scale).ceil() as u16, (f64::from(h) * scale).ceil() as u16);
    dec.scale(rw.max(1), rh.max(1)).ok()?;
    let px = dec.decode().ok()?;
    let info = dec.info()?;
    let (dw, dh) = (u32::from(info.width), u32::from(info.height));
    let lut: Vec<f32> = (0..256).map(|i| srgb_decode(i as f32 / 255.0)).collect();
    let mut lum: Vec<f32> = match info.pixel_format {
        jpeg_decoder::PixelFormat::RGB24 => px.chunks_exact(3).map(|p| encoded_luma([lut[p[0] as usize], lut[p[1] as usize], lut[p[2] as usize]])).collect(),
        jpeg_decoder::PixelFormat::L8 => px.iter().map(|&v| encoded_luma([lut[v as usize]; 3])).collect(),
        _ => return None,
    };
    if lum.len() != (dw * dh) as usize {
        return None;
    }
    let m = median(&mut lum)?;
    (MEDIAN_RANGE.0..=MEDIAN_RANGE.1).contains(&m).then_some(Preview { width: dw, height: dh, median: m })
}

/// The roll-off for a gain `gain` on a picture whose median linear
/// luminance before the gain is `median`: (knee, peak) for
/// `output::rolloff`, `None` for none (see the module notes).
pub fn rolloff_for(gain: f32, median: f32) -> Option<(f32, f32)> {
    let t = CLIP_WHITE;
    if gain <= 1.0 || !(median.is_finite() && median >= 0.0) {
        return None;
    }
    let knee = (gain * median).min(t * 0.9);
    // rolloff(gain, knee, peak) = t: knee + e / (1 + e / (peak − knee)) = t.
    let (e, room) = (gain - knee, t - knee);
    (e > room).then(|| (knee, knee + e * room / (e - room)))
}

/// One pixel of linear sRGB (after the camera matrix) through the gain, the
/// roll-off and the gamut map: what the decode then gives the base curve.
pub fn render_pixel(c: [f32; 3], gain: f32, roll: Option<(f32, f32)>) -> [f32; 3] {
    let w = luma(Gamut::Srgb);
    let mut c = c.map(|v| v * gain);
    let y = w[0] * c[0] + w[1] * c[1] + w[2] * c[2];
    if let Some((knee, peak)) = roll {
        if y > knee {
            let rolled = rolloff(y, knee, peak);
            c = c.map(|v| v * (rolled / y));
        }
    }
    gamut_map(c, w, 1.0, 1.0)
}

/// The median linear luminance of interleaved linear sRGB.
pub fn median_luminance(rgb: &[f32]) -> f32 {
    let w = luma(Gamut::Srgb);
    let mut lum: Vec<f32> = rgb.chunks_exact(3).map(|c| w[0] * c[0] + w[1] * c[1] + w[2] * c[2]).collect();
    median(&mut lum).unwrap_or(0.0)
}

/// Box-average interleaved RGB (`w` × `h`) in linear light down to about
/// `pixels` pixels (never up).
pub fn downscale(rgb: &[f32], w: usize, h: usize, pixels: usize) -> (usize, usize, Vec<f32>) {
    let s = ((pixels as f64) / (w * h) as f64).sqrt().min(1.0);
    let (ow, oh) = (((w as f64 * s).round() as usize).max(1), ((h as f64 * s).round() as usize).max(1));
    let mut sum = vec![0f64; ow * oh * 3];
    let mut n = vec![0u32; ow * oh];
    for y in 0..h {
        let oy = (y * oh / h).min(oh - 1);
        for x in 0..w {
            let o = oy * ow + (x * ow / w).min(ow - 1);
            for k in 0..3 {
                sum[o * 3 + k] += f64::from(rgb[(y * w + x) * 3 + k]);
            }
            n[o] += 1;
        }
    }
    let out = sum.iter().enumerate().map(|(i, s)| (s / f64::from(n[i / 3].max(1))) as f32).collect();
    (ow, oh, out)
}

/// The median encoded luminance of `small` (linear sRGB after the matrix)
/// rendered with `ev`, through the base curve `curve` (a table on
/// luminance 0..1, as `dng::color::apply_lut` takes it).
pub fn rendered_median(small: &[f32], ev: f32, curve: &[f32]) -> f32 {
    let gain = ev.exp2();
    let roll = rolloff_for(gain, median_luminance(small));
    let mut rgb: Vec<f32> = small.chunks_exact(3).flat_map(|c| render_pixel([c[0], c[1], c[2]], gain, roll)).collect();
    crate::dng::color::apply_lut(&mut rgb, curve);
    let mut lum: Vec<f32> = rgb.chunks_exact(3).map(|c| encoded_luma([c[0].min(1.0), c[1].min(1.0), c[2].min(1.0)])).collect();
    median(&mut lum).unwrap_or(0.0)
}

/// The exposure in [`MIN_EV`]..[`MAX_EV`] at which `small`'s rendered
/// median is `target`, by bisection (the median rises with the exposure).
pub fn match_exposure(small: &[f32], target: f32, curve: &[f32]) -> f32 {
    let (mut lo, mut hi) = (MIN_EV, MAX_EV);
    if rendered_median(small, lo, curve) >= target {
        return lo;
    }
    if rendered_median(small, hi, curve) <= target {
        return hi;
    }
    for _ in 0..16 {
        let mid = (lo + hi) / 2.0;
        if rendered_median(small, mid, curve) < target {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    (lo + hi) / 2.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_roll_off_keeps_the_dark_half_and_brings_the_sensor_white_just_under_white() {
        assert_eq!(rolloff_for(0.7, 0.1), None);
        assert_eq!(rolloff_for(1.0, 0.1), None);
        for (g, m) in [(1.2f32, 0.1f32), (2.0, 0.05), (2.83, 0.2), (8.0, 0.02)] {
            let (k, p) = rolloff_for(g, m).unwrap();
            assert!((k - g * m).abs() < 1e-6 && p > k);
            assert!((rolloff(g, k, p) - CLIP_WHITE).abs() < 1e-4, "{g}: {k} {p}");
        }
        // Below the knee nothing moves but the gain; a grey stays grey.
        let roll = rolloff_for(2.0, 0.2);
        let c = render_pixel([0.1, 0.1, 0.1], 2.0, roll);
        assert!((c[0] - 0.2).abs() < 1e-6 && c[0] == c[1] && c[1] == c[2]);
        let white = render_pixel([1.0, 1.0, 1.0], 2.0, roll);
        assert!(white.iter().all(|&v| (v - CLIP_WHITE).abs() < 1e-3), "{white:?}");
    }

    #[test]
    fn the_matched_exposure_reaches_the_target_median_within_bounds() {
        // A ramp of greys, linear 0.001..0.5.
        let small: Vec<f32> = (0..1000).flat_map(|i| [0.001 + 0.0005 * i as f32; 3]).collect();
        let curve: Vec<f32> = (0..4096).map(|i| i as f32 / 4095.0).collect();
        let ev = match_exposure(&small, 0.6, &curve);
        assert!((rendered_median(&small, ev, &curve) - 0.6).abs() < 1e-3, "{ev}");
        assert_eq!(match_exposure(&small, 0.999, &curve), MAX_EV);
        assert_eq!(match_exposure(&small, 0.0001, &curve), MIN_EV);
        let mut v = vec![3.0, 1.0, 2.0];
        assert_eq!(median(&mut v), Some(2.0));
        assert_eq!(median(&mut []), None);
    }

    #[test]
    fn no_preview_in_bytes_that_hold_none() {
        assert!(whole_picture_preview(b"not a tiff", 1.5).is_none());
        assert!(whole_picture_preview(&[], 1.5).is_none());
    }
}
