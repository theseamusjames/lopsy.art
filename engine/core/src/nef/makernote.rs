//! Nikon's maker note: the Exif `MakerNote` of a NEF.
//!
//! It starts with the bytes "Nikon", a NUL, a two-byte version (2.10 on
//! the older samples, 2.11 on the newer) and two zero bytes; then comes a
//! whole TIFF of its own, header and first IFD, whose offsets count from
//! that header, and whose byte order is its own (little-endian on every
//! sample from the D500 on, big-endian before). So the maker note is read
//! as a TIFF over its own bytes: an offset that points outside it is
//! outside the slice, and the entry is skipped as any damaged entry is.

use crate::dng::tiff::{IfdEntry, TiffReader};

/// Where the maker note's own TIFF header starts.
const TIFF_START: usize = 10;

/// The entries of a Nikon maker note's IFD, or `None` for bytes that are
/// not one (another maker's, Nikon's older formats without the header, or
/// damaged).
pub fn read(maker_note: &[u8]) -> Option<Vec<IfdEntry>> {
    if maker_note.len() < TIFF_START + 8 || !maker_note.starts_with(b"Nikon\0") || maker_note[6] != 2 {
        return None;
    }
    let reader = TiffReader::new(&maker_note[TIFF_START..]).ok()?;
    reader.read_ifd(0).ok().filter(|e| !e.is_empty())
}

/// Whether the maker note's own TIFF is little-endian ("II"): the byte
/// order of the values in its UNDEFINED entries (tag 0x0096's predictors
/// and curve).
pub fn is_little_endian(maker_note: &[u8]) -> bool {
    maker_note.get(TIFF_START..TIFF_START + 2) == Some(b"II")
}

/// A SHORT entry's values.
pub fn u16s(entries: &[IfdEntry], tag: u16) -> Option<Vec<u16>> {
    entries.iter().find(|e| e.tag == tag).and_then(|e| e.as_u16_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A hand-built maker note (not a camera's): one SHORT entry, 0x003D,
    /// four values stored past the IFD, big-endian.
    fn note() -> Vec<u8> {
        let mut d = b"Nikon\0\x02\x10\0\0".to_vec();
        d.extend_from_slice(b"MM\0*\0\0\0\x08");
        d.extend_from_slice(&1u16.to_be_bytes());
        d.extend_from_slice(&0x003Du16.to_be_bytes());
        d.extend_from_slice(&3u16.to_be_bytes());
        d.extend_from_slice(&4u32.to_be_bytes());
        d.extend_from_slice(&26u32.to_be_bytes());
        d.extend_from_slice(&0u32.to_be_bytes());
        for v in [400u16, 401, 402, 403] {
            d.extend_from_slice(&v.to_be_bytes());
        }
        d
    }

    #[test]
    fn a_maker_note_reads_as_its_own_tiff() {
        let e = read(&note()).unwrap();
        assert_eq!(u16s(&e, 0x003D), Some(vec![400, 401, 402, 403]));
        assert_eq!(u16s(&e, 0x0045), None);
    }

    #[test]
    fn other_or_damaged_maker_notes_are_none() {
        assert!(read(b"").is_none());
        assert!(read(b"Nikon\0\x01\0\0\0MM\0*\0\0\0\x08").is_none(), "Nikon's older form");
        assert!(read(b"Canon...............").is_none());
        let n = note();
        for cut in 0..n.len() {
            let _ = read(&n[..cut]);
        }
        // The values cut off: the entry is skipped, not read past the end.
        assert_eq!(read(&n[..n.len() - 2]).map(|e| u16s(&e, 0x003D)), None);
    }
}
