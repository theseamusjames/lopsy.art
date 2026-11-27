//! Sony's private block in an ARW: the "SR2" sub-IFD, which holds the
//! camera's colour and level tags, stored enciphered.
//!
//! IFD0's `DNGPrivateData` (tag 0xC634) holds the offset of a small IFD
//! (`SR2Private`) whose tags say where the sub-IFD is and how to read it:
//! 0x7200 its offset, 0x7201 its length in bytes, 0x7221 the 32-bit key
//! (four bytes, in the file's byte order). The sub-IFD is an ordinary TIFF
//! IFD once deciphered; its value offsets count from the start of the file.
//!
//! The cipher, as Sony's format is publicly described: a keystream of
//! 32-bit words, each new word the XOR of the words 127 and 63 places
//! before it, whose first 127 words are made from the key by a linear
//! congruential generator (multiplier 48828125, increment 1) and a
//! one-bit-rotating mix; the data is XORed with it as big-endian 32-bit
//! words. Written from that description, not from another decoder's code.
//! It was checked on six real files (ILCE-7M4 ×3, ILCE-7M3, ILCE-6000,
//! DSC-RX100M3): each block deciphers to an IFD of 169 or 209 well-formed
//! entries, the black levels and as-shot white balance it holds are
//! exactly those the raw IFD stores in the clear where the raw IFD has
//! them (the A7 III and A7 IV), and its crop (0x74C3) is the size macOS
//! renders the older bodies at (`tests/arw_decode.rs`).

use crate::dng::tiff::{IfdEntry, TiffReader};

/// The largest SR2 block read: real ones are a few tens of kilobytes.
const MAX_SR2_BYTES: usize = 1 << 20;

/// `DNGPrivateData`, which Sony uses for the offset of `SR2Private`.
const TAG_DNG_PRIVATE_DATA: u16 = 0xC634;
const TAG_SR2_SUB_IFD_OFFSET: u16 = 0x7200;
const TAG_SR2_SUB_IFD_LENGTH: u16 = 0x7201;
const TAG_SR2_SUB_IFD_KEY: u16 = 0x7221;

/// The sub-IFD's colour matrix, nine signed values in 1024ths.
pub const TAG_COLOR_MATRIX: u16 = 0x7800;

/// Decipher `buf` in place with `key`: every whole 32-bit word of it.
pub fn decipher(buf: &mut [u8], key: u32) {
    let mut pad = [0u32; 128];
    let mut state = key;
    for word in pad.iter_mut().take(4) {
        state = state.wrapping_mul(48_828_125).wrapping_add(1);
        *word = state;
    }
    pad[3] = pad[3] << 1 | (pad[0] ^ pad[2]) >> 31;
    for p in 4..127 {
        pad[p] = (pad[p - 4] ^ pad[p - 2]) << 1 | (pad[p - 3] ^ pad[p - 1]) >> 31;
    }
    let mut p = 127usize;
    for chunk in buf.chunks_exact_mut(4) {
        pad[p & 127] = pad[(p + 1) & 127] ^ pad[(p + 65) & 127];
        let word = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]) ^ pad[p & 127];
        chunk.copy_from_slice(&word.to_be_bytes());
        p += 1;
    }
}

fn type_size(typ: u16) -> Option<usize> {
    Some(match typ {
        1 | 2 | 6 | 7 => 1,
        3 | 8 => 2,
        4 | 9 | 11 | 13 => 4,
        5 | 10 | 12 => 8,
        _ => return None,
    })
}

/// Parse the deciphered sub-IFD (little-endian), whose value offsets are
/// file offsets and `base` is where the block starts in the file. Entries
/// whose values fall outside the block are skipped.
fn parse_block(block: &[u8], base: usize) -> Result<Vec<IfdEntry>, String> {
    let u16_at = |o: usize| block.get(o..o + 2).map(|b| u16::from_le_bytes([b[0], b[1]]));
    let u32_at = |o: usize| block.get(o..o + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]));
    let count = u16_at(0).ok_or("the SR2 block is empty")? as usize;
    if 2 + count * 12 > block.len() {
        return Err("the SR2 block's IFD runs past its end".into());
    }
    let mut entries = Vec::with_capacity(count);
    for i in 0..count {
        let e = 2 + i * 12;
        let (Some(tag), Some(typ), Some(n)) = (u16_at(e), u16_at(e + 2), u32_at(e + 4)) else { continue };
        let Some(size) = type_size(typ).and_then(|s| s.checked_mul(n as usize)) else { continue };
        let bytes = if size <= 4 {
            block[e + 8..e + 8 + size].to_vec()
        } else {
            let Some(at) = u32_at(e + 8).and_then(|o| (o as usize).checked_sub(base)) else { continue };
            match at.checked_add(size).filter(|&end| end <= block.len()) {
                Some(end) => block[at..end].to_vec(),
                None => continue,
            }
        };
        entries.push(IfdEntry { tag, typ, count: n, raw_bytes: bytes });
    }
    Ok(entries)
}

/// The deciphered SR2 sub-IFD of a little-endian ARW, `Ok(None)` when the
/// file has none, an error when it has one that cannot be read.
pub fn read_sr2(data: &[u8], ifd0: &[IfdEntry]) -> Result<Option<Vec<IfdEntry>>, String> {
    let Some(private) = ifd0.iter().find(|e| e.tag == TAG_DNG_PRIVATE_DATA) else {
        return Ok(None);
    };
    let at = match (private.typ, private.raw_bytes.as_slice()) {
        (1 | 4 | 7, [a, b, c, d, ..]) => u32::from_le_bytes([*a, *b, *c, *d]),
        _ => return Err("Sony's private data pointer is not an offset".into()),
    };
    let reader = TiffReader::new(data)?;
    let private_ifd = reader.read_ifd_at(at).map_err(|e| format!("Sony's private IFD: {e}"))?;
    let get = |tag: u16| private_ifd.iter().find(|e| e.tag == tag);
    let (Some(offset), Some(length), Some(key)) = (
        get(TAG_SR2_SUB_IFD_OFFSET).and_then(|e| e.as_u32()),
        get(TAG_SR2_SUB_IFD_LENGTH).and_then(|e| e.as_u32()),
        get(TAG_SR2_SUB_IFD_KEY).and_then(|e| e.raw_bytes.get(..4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))),
    ) else {
        return Ok(None);
    };
    let (offset, length) = (offset as usize, length as usize);
    if length < 2 || length > MAX_SR2_BYTES {
        return Err(format!("Sony's SR2 block is {length} bytes long"));
    }
    let Some(block) = offset.checked_add(length).filter(|&end| end <= data.len()).map(|end| &data[offset..end]) else {
        return Err("Sony's SR2 block lies outside the file".into());
    };
    let mut block = block.to_vec();
    decipher(&mut block, key);
    parse_block(&block, offset).map(Some)
}

/// Sony's colour matrix from the SR2 sub-IFD (tag 0x7800, nine signed
/// 1024ths), row-major, when it is there and each row sums to one (the
/// shape of a matrix applied to white-balanced camera RGB, which keeps
/// neutral neutral).
pub fn color_matrix(sr2: &[IfdEntry]) -> Option<[f32; 9]> {
    let e = sr2.iter().find(|e| e.tag == TAG_COLOR_MATRIX && e.typ == 8 && e.count == 9)?;
    let v: Vec<f32> = e.raw_bytes.chunks_exact(2).map(|b| f32::from(i16::from_le_bytes([b[0], b[1]])) / 1024.0).collect();
    let m: [f32; 9] = v.try_into().ok()?;
    let rows_sum_to_one = m.chunks_exact(3).all(|r| (r.iter().sum::<f32>() - 1.0).abs() < 0.02);
    let det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    (rows_sum_to_one && det.abs() > 0.05).then_some(m)
}

/// A tag of the SR2 sub-IFD as unsigned or signed 16-bit values.
pub fn values_i32(sr2: &[IfdEntry], tag: u16) -> Option<Vec<i32>> {
    let e = sr2.iter().find(|e| e.tag == tag)?;
    match e.typ {
        3 => Some(e.raw_bytes.chunks_exact(2).map(|b| i32::from(u16::from_le_bytes([b[0], b[1]]))).collect()),
        8 => Some(e.raw_bytes.chunks_exact(2).map(|b| i32::from(i16::from_le_bytes([b[0], b[1]]))).collect()),
        4 => Some(e.raw_bytes.chunks_exact(4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as i32).collect()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deciphering_twice_with_the_same_key_restores_the_bytes() {
        let original: Vec<u8> = (0..64u8).collect();
        let mut buf = original.clone();
        decipher(&mut buf, 0x4433_2211);
        assert_ne!(buf, original);
        decipher(&mut buf, 0x4433_2211);
        assert_eq!(buf, original, "an XOR keystream is its own inverse");
        // A trailing partial word is left alone.
        let mut odd = vec![7u8; 6];
        decipher(&mut odd, 1);
        assert_eq!(&odd[4..], &[7, 7]);
    }

    #[test]
    fn a_block_whose_values_point_outside_it_loses_those_entries() {
        // Two entries: one inline SHORT, one LONG array pointing past the end.
        let mut b = vec![2u8, 0];
        b.extend_from_slice(&[0x10, 0x73, 3, 0, 1, 0, 0, 0, 0, 2, 0, 0]);
        b.extend_from_slice(&[0x11, 0x73, 4, 0, 9, 0, 0, 0, 0xff, 0xff, 0, 0]);
        let entries = parse_block(&b, 0).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(values_i32(&entries, 0x7310), Some(vec![512]));
        assert!(parse_block(&[9, 0, 1], 0).is_err());
    }

    #[test]
    fn a_matrix_must_keep_neutral_neutral() {
        let entry = |m: [i16; 9]| IfdEntry { tag: TAG_COLOR_MATRIX, typ: 8, count: 9, raw_bytes: m.iter().flat_map(|v| v.to_le_bytes()).collect() };
        let ok = color_matrix(&[entry([1144, -198, 78, 30, 1067, -73, 139, -59, 944])]).unwrap();
        assert!((ok[0] - 1144.0 / 1024.0).abs() < 1e-6);
        assert!(color_matrix(&[entry([2000, 0, 0, 0, 1024, 0, 0, 0, 1024])]).is_none());
        assert!(color_matrix(&[entry([0; 9])]).is_none());
    }
}
