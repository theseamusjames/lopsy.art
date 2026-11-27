//! The opening exposure of a NEF, matched to the camera's own rendering of
//! the frame by `arw::exposure`'s method (the median luminance of the
//! preview, matched after the opening curve). Only where the previews are
//! differs: a NEF keeps its full-size JPEG and a 1620 × 1080 one in
//! IFD0's SubIFDs (`JPEGInterchangeFormat` in each), and IFD0 holds an
//! uncompressed thumbnail or, on the newest bodies, a 160 × 120 JPEG.

use super::linear::{develop_defaults, NefRenderParams};
use crate::arw::exposure::{match_rendered_median, preview_of, preview_sized_view, Preview, MAX_EV, MIN_EV};
use crate::dng::tiff::TiffReader;

/// The largest JPEG read, in bytes (`arw::exposure` reads up to the same).
const MAX_PREVIEW_BYTES: usize = 32 << 20;
/// The most IFDs of IFD0's chain looked at.
const MAX_CHAIN: usize = 8;

/// The JPEGs in IFD0's chain and in IFD0's SubIFDs as (offset, length),
/// inside the file.
pub fn jpeg_ranges(data: &[u8]) -> Vec<(usize, usize)> {
    let Ok(reader) = TiffReader::new(data) else { return Vec::new() };
    let mut ifds = Vec::new();
    for i in 0..MAX_CHAIN {
        let Ok(ifd) = reader.read_ifd(i) else { break };
        if i == 0 {
            ifds.extend(super::sub_ifds(&reader, &ifd));
        }
        ifds.push(ifd);
    }
    let mut out = Vec::new();
    for ifd in &ifds {
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

/// The camera's preview of the whole picture (`width` × `height` after
/// orientation) and its median, as `arw::exposure::whole_picture_preview`
/// chooses and measures it, or `None`.
pub fn whole_picture_preview(data: &[u8], width: u32, height: u32) -> Option<Preview> {
    preview_of(data, &jpeg_ranges(data), &[f64::from(width) / f64::from(height.max(1))], width.max(height))
}

/// The exposure (stops) at which the develop chain's rendering of a
/// prepared NEF with `settings` has the median brightness of the camera's
/// preview, or `None` without a usable preview: the method of
/// `arw::exposure::match_develop_exposure_with`.
pub fn match_develop_exposure_with(data: &[u8], params: &NefRenderParams, plane: &[f32], settings: &crate::raf::develop::RawDevelopSettings) -> Option<f32> {
    let (ow, oh) = params.oriented_size();
    let preview = whole_picture_preview(data, ow, oh)?;
    let (sw, sh, rgba) = preview_sized_view(plane, params, &preview)?;
    Some(match_rendered_median(&rgba, sw, sh, settings, preview.median, (MIN_EV, MAX_EV)))
}

/// [`match_develop_exposure_with`] at the develop defaults.
pub fn match_develop_exposure(data: &[u8], params: &NefRenderParams, plane: &[f32]) -> Option<f32> {
    match_develop_exposure_with(data, params, plane, &develop_defaults(params))
}
