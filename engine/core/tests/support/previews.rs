//! The embedded preview of a raw file, turned upright, for the real-file
//! tests that compare a render with the picture the camera (or a
//! converter) made: the largest JPEG of the whole picture a RAF, DNG or
//! ARW holds.
#![allow(dead_code)]

use lopsy_core::dng::tiff::TiffReader;
use lopsy_core::raw::{Prepared, PreparedRaw, RawFormatId};

use super::raw_compare::Picture;

/// The JPEG previews a TIFF-based raw holds: `JPEGInterchangeFormat` in
/// IFD0's chain or a SubIFD, and every one-strip, JPEG-compressed,
/// reduced-resolution (`NewSubFileType` 1) RGB or YCbCr image. The raw
/// image itself (a lossless JPEG, CFA or LinearRaw) is never one.
pub fn tiff_jpegs(data: &[u8]) -> Vec<(usize, usize)> {
    let Ok(reader) = TiffReader::new(data) else { return Vec::new() };
    let mut ifds = Vec::new();
    for i in 0..8 {
        let Ok(ifd) = reader.read_ifd(i) else { break };
        let subs: Vec<u32> = ifd.iter().find(|e| e.tag == 0x14a).and_then(|e| e.as_u32_vec()).unwrap_or_default();
        ifds.extend(subs.iter().filter_map(|&o| reader.read_ifd_at(o).ok()));
        ifds.push(ifd);
    }
    let mut out = Vec::new();
    for ifd in &ifds {
        let get = |tag: u16| ifd.iter().find(|e| e.tag == tag).and_then(|e| e.as_u32());
        let count = |tag: u16| ifd.iter().find(|e| e.tag == tag).map_or(0, |e| e.count);
        if let (Some(o), Some(n)) = (get(0x201), get(0x202)) {
            out.push((o as usize, n as usize));
        } else if get(0xfe) == Some(1) && get(0x103) == Some(7) && matches!(get(0x106), Some(2 | 6)) && count(0x111) == 1 {
            if let (Some(o), Some(n)) = (get(0x111), get(0x117)) {
                out.push((o as usize, n as usize));
            }
        }
    }
    out
}

fn orientation(prep: &PreparedRaw) -> u16 {
    match &prep.prepared {
        Prepared::Raf(p) => p.params.orientation,
        Prepared::Dng(p) => p.params.orientation,
        Prepared::Arw(p) => p.params.orientation,
        Prepared::Cr2(p) => p.params.orientation,
    }
}

/// The largest embedded JPEG of the whole picture, its bytes.
pub fn preview_jpeg(data: &[u8], prep: &PreparedRaw) -> Option<Vec<u8>> {
    let aspect = f64::from(prep.description.width) / f64::from(prep.description.height);
    let blobs: Vec<Vec<u8>> = if prep.format == RawFormatId::Raf {
        vec![lopsy_core::raf::extract_jpeg_preview(data).ok()?]
    } else {
        tiff_jpegs(data).into_iter().filter_map(|(o, n)| data.get(o..o + n).map(<[u8]>::to_vec)).collect()
    };
    let mut best: Option<(usize, u32)> = None;
    for (i, bytes) in blobs.iter().enumerate() {
        let mut dec = jpeg_decoder::Decoder::new(&bytes[..]);
        if dec.read_info().is_err() {
            continue;
        }
        let Some(info) = dec.info() else { continue };
        let (w, h) = (u32::from(info.width), u32::from(info.height));
        let a = f64::from(w) / f64::from(h);
        let whole = (a / aspect - 1.0).abs() < 0.01 || (a * aspect - 1.0).abs() < 0.01;
        if whole && best.is_none_or(|b| w * h > b.1) {
            best = Some((i, w * h));
        }
    }
    let (i, _) = best?;
    blobs.into_iter().nth(i)
}

/// The colour space an embedded ICC profile names, when the JPEG carries
/// one: the profile's description tag text, else `None` (taken as sRGB).
pub fn icc_description(jpeg: &[u8]) -> Option<String> {
    let at = jpeg.windows(12).position(|w| w == b"ICC_PROFILE\0")?;
    let icc = &jpeg[at + 14..];
    let tag_count = u32::from_be_bytes(icc.get(128..132)?.try_into().ok()?) as usize;
    for t in 0..tag_count.min(64) {
        let e = icc.get(132 + 12 * t..144 + 12 * t)?;
        if &e[0..4] == b"desc" {
            let off = u32::from_be_bytes(e[4..8].try_into().ok()?) as usize;
            let len = u32::from_be_bytes(e[8..12].try_into().ok()?) as usize;
            let body = icc.get(off..off + len)?;
            let text: String = body.iter().filter(|b| b.is_ascii_graphic() || **b == b' ').map(|&b| b as char).collect();
            return Some(text.trim().to_string());
        }
    }
    None
}

/// The largest embedded JPEG of the whole picture, decoded to linear light
/// (its values as sRGB-encoded) and turned upright.
pub fn preview_picture(data: &[u8], prep: &PreparedRaw) -> Option<Picture> {
    let jpeg = preview_jpeg(data, prep)?;
    let aspect = f64::from(prep.description.width) / f64::from(prep.description.height);
    let mut dec = jpeg_decoder::Decoder::new(&jpeg[..]);
    let px = dec.decode().ok()?;
    let info = dec.info()?;
    if info.pixel_format != jpeg_decoder::PixelFormat::RGB24 {
        return None;
    }
    let (w, h) = (u32::from(info.width), u32::from(info.height));
    let pic = Picture::from_rgb8(w as usize, h as usize, &px);
    // Stored in the sensor's orientation: turn it as the raw is turned.
    if (f64::from(w) / f64::from(h) / aspect - 1.0).abs() < 0.01 {
        return Some(pic);
    }
    let rgba: Vec<f32> = pic.rgb.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 1.0]).collect();
    let (rw, rh, turned) = lopsy_core::orientation::apply_exif_orientation(w, h, &rgba, orientation(prep));
    Some(Picture { w: rw as usize, h: rh as usize, rgb: turned.chunks_exact(4).flat_map(|c| [c[0], c[1], c[2]]).collect() })
}

/// The primaries a preview's values are in: Display P3 when its ICC
/// profile names P3, else sRGB. Both use the sRGB curve.
pub fn preview_gamut(jpeg: &[u8]) -> lopsy_core::working_space::Gamut {
    use lopsy_core::working_space::Gamut;
    if icc_description(jpeg).is_some_and(|d| d.contains("P3")) { Gamut::DisplayP3 } else { Gamut::Srgb }
}

/// [`preview_picture`] and the primaries its linear values are in.
pub fn preview_with_gamut(data: &[u8], prep: &PreparedRaw) -> Option<(Picture, lopsy_core::working_space::Gamut)> {
    let gamut = preview_gamut(&preview_jpeg(data, prep)?);
    Some((preview_picture(data, prep)?, gamut))
}

/// A picture in linear `gamut` as linear sRGB, for showing beside an sRGB
/// render: colours outside sRGB are clipped (a P3 preview's most saturated
/// colours lose a little).
pub fn to_srgb(p: &Picture, gamut: lopsy_core::working_space::Gamut) -> Picture {
    use lopsy_core::working_space::{apply, conversion, Gamut};
    if gamut == Gamut::Srgb {
        return Picture { w: p.w, h: p.h, rgb: p.rgb.clone() };
    }
    let m = conversion(gamut, Gamut::Srgb);
    let rgb = p.rgb.chunks_exact(3).flat_map(|c| apply(&m, [c[0], c[1], c[2]]).map(|v| v.clamp(0.0, 1.0))).collect();
    Picture { w: p.w, h: p.h, rgb }
}

/// Cells across the chroma grid.
pub const CHROMA_GRID: usize = 48;

/// Each cell's Oklab, the picture (linear `gamut`) box-averaged in linear
/// light to [`CHROMA_GRID`] cells across.
pub fn oklab_grid(p: &Picture, gamut: lopsy_core::working_space::Gamut) -> Vec<[f32; 3]> {
    use lopsy_core::working_space::{apply, conversion, Gamut};
    let m = lopsy_core::look::oklab_matrices();
    let to_2020 = conversion(gamut, Gamut::Rec2020);
    let gw = CHROMA_GRID;
    let gh = ((p.h as f64 * gw as f64 / p.w as f64).round() as usize).max(1);
    let mut sum = vec![[0f64; 3]; gw * gh];
    let mut n = vec![0f64; gw * gh];
    for y in 0..p.h {
        let gy = (y * gh / p.h).min(gh - 1);
        for x in 0..p.w {
            let g = gy * gw + (x * gw / p.w).min(gw - 1);
            for c in 0..3 {
                sum[g][c] += f64::from(p.rgb[(y * p.w + x) * 3 + c]);
            }
            n[g] += 1.0;
        }
    }
    sum.iter().zip(&n).map(|(s, n)| lopsy_core::look::to_oklab(&m, apply(&to_2020, s.map(|v| (v / n.max(1.0)) as f32)))).collect()
}

/// Ours against a preview on the Oklab grid: Σ chroma ours / Σ chroma
/// preview over the cells where the preview's chroma is at least 0.03.
pub fn chroma_ratio(ours: &[[f32; 3]], preview: &[[f32; 3]]) -> f32 {
    let c = |l: &[f32; 3]| l[1].hypot(l[2]);
    let (mut a, mut b) = (0f64, 0f64);
    for (o, p) in ours.iter().zip(preview) {
        if c(p) >= 0.03 {
            a += f64::from(c(o));
            b += f64::from(c(p));
        }
    }
    (a / b) as f32
}
