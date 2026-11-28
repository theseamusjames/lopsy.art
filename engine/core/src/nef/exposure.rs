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
/// inside the file: IFD0's SubIFDs first, then the chain. Each IFD's two
/// tags are taken as it is read, so no more than one IFD is held at once.
pub fn jpeg_ranges(data: &[u8]) -> Vec<(usize, usize)> {
    let Ok(reader) = TiffReader::new(data) else { return Vec::new() };
    let mut out = Vec::new();
    let mut take = |ifd: &[crate::dng::tiff::IfdEntry]| {
        let get = |tag: u16| ifd.iter().find(|e| e.tag == tag).and_then(|e| e.as_u32());
        if let (Some(o), Some(n)) = (get(0x201), get(0x202)) {
            let (o, n) = (o as usize, n as usize);
            if n > 0 && n <= MAX_PREVIEW_BYTES && o.checked_add(n).is_some_and(|end| end <= data.len()) {
                out.push((o, n));
            }
        }
    };
    for i in 0..MAX_CHAIN {
        let Ok(ifd) = reader.read_ifd(i) else { break };
        if i == 0 {
            let subs = super::u32s(&ifd, crate::dng::tiff::TagId::SubIFDs as u16).unwrap_or_default();
            for &o in subs.iter().take(super::MAX_SUB_IFDS) {
                if let Ok(sub) = reader.read_ifd_at(o) {
                    take(&sub);
                }
            }
        }
        take(&ifd);
    }
    out
}

/// The camera's preview of the whole picture (`width` × `height` after
/// orientation) and its median, as `arw::exposure::whole_picture_preview`
/// chooses and measures it, or `None`. Nikon stores its previews unturned
/// (a portrait frame's is landscape, with the orientation tag), so either
/// aspect is the picture's; the median does not depend on which.
pub fn whole_picture_preview(data: &[u8], width: u32, height: u32) -> Option<Preview> {
    let aspect = f64::from(width) / f64::from(height.max(1));
    preview_of(data, &jpeg_ranges(data), &[aspect, 1.0 / aspect], width.max(height))
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

#[cfg(test)]
mod tests {
    use super::*;

    /// IFD0 names a JPEG, lists itself 16 times as its SubIFDs and is its
    /// own next IFD: every IFD read is IFD0 again.
    fn self_looping() -> Vec<u8> {
        let entry = |tag: u16, typ: u16, count: u32, value: u32| [tag.to_le_bytes().as_slice(), &typ.to_le_bytes(), &count.to_le_bytes(), &value.to_le_bytes()].concat();
        let subs_at = 8 + 2 + 3 * 12 + 4;
        let jpeg_at = subs_at + 16 * 4;
        let mut d = b"II*\0".to_vec();
        d.extend_from_slice(&8u32.to_le_bytes());
        d.extend_from_slice(&3u16.to_le_bytes());
        d.extend(entry(0x14A, 4, 16, subs_at as u32));
        d.extend(entry(0x201, 4, 1, jpeg_at as u32));
        d.extend(entry(0x202, 4, 1, 1000));
        d.extend_from_slice(&8u32.to_le_bytes());
        for _ in 0..16 {
            d.extend_from_slice(&8u32.to_le_bytes());
        }
        d.resize(jpeg_at + 1000, 0);
        d
    }

    #[test]
    fn a_chain_that_loops_gives_its_jpeg_once_per_ifd_read_in_order() {
        let d = self_looping();
        let jpeg = (8 + 2 + 3 * 12 + 4 + 16 * 4, 1000);
        // The 16 SubIFDs, then the 8 IFDs of the chain looked at, each IFD0.
        assert_eq!(jpeg_ranges(&d), vec![jpeg; 16 + MAX_CHAIN]);
    }
}
