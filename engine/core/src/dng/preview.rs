//! A prototype: the opening exposure of a DNG that relies on a gain map
//! the develop chain does not apply, matched to the camera's own preview
//! the way an ARW's is (`arw::exposure`). Only with an opening look's
//! `dng_preview_exposure` (`raw::OpeningLook`); by default a DNG opens at
//! its BaselineExposure, as before.
//!
//! **Why.** Apple's ProRAW records a large BaselineExposure for a dark
//! scene (+4.1 stops on the concert sample) and a `ProfileGainTableMap`, a
//! local tone map that holds the lights back again. Applied globally
//! without the map, the baseline blows the lights out; the camera's
//! preview shows the brightness the camera meant.
//!
//! **When** ([`camera_preview_for_exposure`]), all of:
//! - the file carries `ProfileGainTableMap` (in IFD0 or any SubIFD);
//! - its preview was made by the camera, not by a converter. The tags
//!   cannot say so in general; the rule used is that the file has neither
//!   `OriginalRawFileName` (a converter that wrote the DNG from another
//!   RAW names the original) nor `PreviewApplicationName` (written by
//!   converters, which re-render the preview). Every Adobe DNG Converter
//!   sample has both; both iPhone ProRAW samples have neither. A camera
//!   that writes either tag into its own DNG is treated as a converter
//!   (no match), which is the safe side;
//! - a JPEG preview of the whole picture is found: IFD0 or a SubIFD with
//!   `NewSubFileType` 1 (a reduced-resolution image), JPEG-compressed in
//!   one strip, or IFD0's `JPEGInterchangeFormat`; its aspect within 1 %
//!   of the picture's either way round (a DNG's previews follow the raw's
//!   orientation), chosen and decoded as `arw::exposure::preview_of` does.
//!   Its colour space is taken as sRGB (an iPhone's may be Display P3: the
//!   median luminance differs little).
//!
//! **The exposure** is the one at which the develop chain's rendering, with
//! the opening look's curve, has the preview's median
//! (`arw::exposure::match_rendered_median`), bounded to
//! [`MIN_BELOW_BASELINE`] below and [`MAX_ABOVE_BASELINE`] above the
//! BaselineExposure: ARW's widest bound (+3) both ways, since a local tone
//! map can lift a frame (the rose sample's preview is a stop brighter
//! than its baseline) as well as hold it back (the concert's is about a stop
//! darker). A first choice of −3..+1, on the idea that the map mostly
//! takes light away, bound on the rose and was wrong. A preview whose
//! median is nearly black or white is not used (`arw::exposure`), so a
//! blank preview cannot push a file to either end.

use super::tiff::{IfdEntry, TagId, TiffReader};
use crate::arw::exposure::{preview_of, Preview};

/// The matched exposure lies within `baseline − 3` and `baseline + 3`.
pub const MIN_BELOW_BASELINE: f32 = 3.0;
pub const MAX_ABOVE_BASELINE: f32 = 3.0;

const NEW_SUBFILE_TYPE: u16 = 0xFE;
const ORIGINAL_RAW_FILE_NAME: u16 = 0xC68B;
const PREVIEW_APPLICATION_NAME: u16 = 0xC716;
const JPEG_INTERCHANGE: (u16, u16) = (0x201, 0x202);

fn get(ifd: &[IfdEntry], tag: u16) -> Option<u32> {
    ifd.iter().find(|e| e.tag == tag).and_then(|e| e.as_u32())
}

fn has(ifd: &[IfdEntry], tag: u16) -> bool {
    ifd.iter().any(|e| e.tag == tag)
}

/// IFD0 and every SubIFD it lists, IFD0 first.
fn ifds(data: &[u8]) -> Vec<Vec<IfdEntry>> {
    let Ok(reader) = TiffReader::new(data) else { return Vec::new() };
    let Ok(ifd0) = reader.read_ifd(0) else { return Vec::new() };
    let subs: Vec<u32> = ifd0.iter().find(|e| e.tag == TagId::SubIFDs as u16).and_then(|e| e.as_u32_vec()).unwrap_or_default();
    let mut out = vec![ifd0];
    out.extend(subs.iter().take(16).filter_map(|&o| reader.read_ifd_at(o).ok()));
    out
}

/// Whether the file's tags say a converter wrote it (see the module notes).
pub fn written_by_a_converter(data: &[u8]) -> bool {
    ifds(data).iter().any(|ifd| has(ifd, ORIGINAL_RAW_FILE_NAME) || has(ifd, PREVIEW_APPLICATION_NAME))
}

/// Whether the file carries a `ProfileGainTableMap`.
pub fn has_gain_map(data: &[u8]) -> bool {
    ifds(data).iter().any(|ifd| has(ifd, TagId::ProfileGainTableMap as u16))
}

/// The JPEG previews' (offset, length) in the file.
fn preview_ranges(data: &[u8]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    for (i, ifd) in ifds(data).iter().enumerate() {
        if i == 0 {
            if let (Some(o), Some(n)) = (get(ifd, JPEG_INTERCHANGE.0), get(ifd, JPEG_INTERCHANGE.1)) {
                out.push((o as usize, n as usize));
            }
        }
        let one_strip = ifd.iter().find(|e| e.tag == TagId::StripOffsets as u16).is_some_and(|e| e.count == 1);
        if get(ifd, NEW_SUBFILE_TYPE) == Some(1) && get(ifd, TagId::Compression as u16) == Some(7) && one_strip {
            if let (Some(o), Some(n)) = (get(ifd, TagId::StripOffsets as u16), get(ifd, TagId::StripByteCounts as u16)) {
                out.push((o as usize, n as usize));
            }
        }
    }
    out
}

/// The camera's preview of a DNG whose opening exposure should be matched
/// to it, or `None` (see the module notes). `aspect` is the picture's
/// width over height, either orientation.
pub fn camera_preview_for_exposure(data: &[u8], aspect: f64) -> Option<Preview> {
    if !has_gain_map(data) || written_by_a_converter(data) {
        return None;
    }
    preview_of(data, &preview_ranges(data), &[aspect, 1.0 / aspect])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_that_are_not_a_dng_have_no_preview_and_no_gain_map() {
        assert!(camera_preview_for_exposure(b"not a tiff", 1.5).is_none());
        assert!(!has_gain_map(&[]));
        assert!(!written_by_a_converter(b"II*\0"));
    }
}
