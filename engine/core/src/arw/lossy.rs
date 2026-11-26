//! Sony's lossy compressed raw data ("ARW 2", `Compression` 32767 with
//! eight bits a pixel): what the bytes hold and how they unpack.
//!
//! Each row of the mosaic is stored on its own, `width` bytes long, as
//! groups of 32 pixels. A group is two 16-byte blocks: the first holds the
//! group's 16 even columns (one colour of the Bayer row), the second its 16
//! odd columns (the other colour). A block is a 128-bit little-endian
//! number read from its lowest bit up:
//!
//! | bits    | field |
//! |---------|-------|
//! | 0–10    | the block's largest code (11 bits) |
//! | 11–21   | its smallest code (11 bits) |
//! | 22–25   | the position (0–15) of the largest |
//! | 26–29   | the position of the smallest |
//! | 30–127  | fourteen 7-bit deltas, one for each other position in order |
//!
//! A delta is scaled by `2^shift` and added to the smallest code, where
//! `shift` (0–4) is the smallest that lets 7 bits span the block's range:
//! the first with `128 << shift > largest − smallest`. A code above 2047 is
//! taken as 2047.
//!
//! The codes are not linear: the camera compressed its 14-bit values with
//! a tone curve before packing them, and `SonyCurve` (tag 0x7010, four
//! knees) says which. [`code_to_linear`] undoes it. The curve is piecewise
//! linear in five segments whose slopes double, 1, 2, 4, 8 and 16; the
//! knees, in units of a quarter of a 14-bit code, are the four tag values
//! divided by 4, and 4095 ends the last segment. An 11-bit code `c` sits
//! at `2c` on that axis, and the curve's value there is the linear sample
//! in the 14-bit units the file's black and white levels use.
//!
//! This is written from the published description of the format (the
//! block layout above and the meaning of the `SonyCurve` knees), and every
//! choice was checked against real files (ILCE-7M4 and ILCE-7M3 at 14
//! bits, ILCE-6000 and DSC-RX100M3 at 12; all four carry the same knees):
//! the darkest samples sit around the file's black level (512, or 800 on
//! the RX100 III) on this curve's scale, clipped highlights pile up at the
//! white level (16383 on the 14-bit files), no block has its two
//! positions equal, and the decoded pictures have none of the defects a
//! mis-read block gives (neighbouring pixels differ no more inside a
//! group than across its edges; no salt-and-pepper, no 16-pixel pattern).
//! No code of another raw decoder was used.

/// Bytes in one block: 16 pixels of one colour.
pub const BLOCK_BYTES: usize = 16;
/// Pixels in a group of two blocks.
pub const GROUP_PIXELS: usize = 32;
/// The largest 11-bit code.
pub const MAX_CODE: u16 = 0x7ff;

/// The 16 codes of one block, in position order.
pub fn unpack_block(block: &[u8; BLOCK_BYTES]) -> [u16; 16] {
    let v = u128::from_le_bytes(*block);
    let field = |at: u32, bits: u32| ((v >> at) & ((1u128 << bits) - 1)) as u16;
    let max = field(0, 11);
    let min = field(11, 11);
    let imax = field(22, 4) as usize;
    let imin = field(26, 4) as usize;
    let range = max.saturating_sub(min);
    let mut shift = 0u32;
    while shift < 4 && (0x80u16 << shift) <= range {
        shift += 1;
    }
    let mut out = [0u16; 16];
    let mut next_delta = 0u32;
    for (i, code) in out.iter_mut().enumerate() {
        *code = if i == imax {
            max
        } else if i == imin {
            min
        } else if next_delta < 14 {
            let d = field(30 + 7 * next_delta, 7);
            next_delta += 1;
            (min + (d << shift)).min(MAX_CODE)
        } else {
            // Only when both positions are the same, which leaves a
            // fifteenth position without a delta: the block's floor.
            min
        };
    }
    out
}

/// Decode `height` rows of `width` codes from `data` (`width × height`
/// bytes, row after row). `width` must be a whole number of groups.
pub fn decode_codes(data: &[u8], width: usize, height: usize) -> Result<Vec<u16>, String> {
    if width == 0 || height == 0 || !width.is_multiple_of(GROUP_PIXELS) {
        return Err(format!("a row of {width} pixels is not a whole number of Sony's {GROUP_PIXELS}-pixel groups"));
    }
    let need = width.checked_mul(height).ok_or("the image size overflows")?;
    if data.len() < need {
        return Err(format!("the compressed data is {} bytes; {width}×{height} needs {need}", data.len()));
    }
    let mut codes: Vec<u16> = Vec::new();
    codes.try_reserve_exact(need).map_err(|_| "not enough memory for the Sony RAW's pixels".to_string())?;
    codes.resize(need, 0);
    for (row_in, row_out) in data[..need].chunks_exact(width).zip(codes.chunks_exact_mut(width)) {
        for (group_in, group_out) in row_in.chunks_exact(GROUP_PIXELS).zip(row_out.chunks_exact_mut(GROUP_PIXELS)) {
            for half in 0..2 {
                let block: &[u8; BLOCK_BYTES] = group_in[half * BLOCK_BYTES..(half + 1) * BLOCK_BYTES].try_into().unwrap();
                for (i, code) in unpack_block(block).into_iter().enumerate() {
                    group_out[2 * i + half] = code;
                }
            }
        }
    }
    Ok(codes)
}

/// The table from an 11-bit code to its linear value, from `SonyCurve`'s
/// four knees: entry `c` is the value of code `c`. An error when the knees
/// are not increasing inside 0..4095.
pub fn code_to_linear(knees: &[u16]) -> Result<Vec<u16>, String> {
    if knees.len() != 4 {
        return Err(format!("SonyCurve has {} values, not 4", knees.len()));
    }
    let mut points = [0usize, 0, 0, 0, 0, 4095];
    for (i, &k) in knees.iter().enumerate() {
        points[i + 1] = usize::from(k >> 2);
    }
    if points.windows(2).any(|w| w[0] > w[1]) {
        return Err(format!("SonyCurve's knees {knees:?} do not increase"));
    }
    // The curve on its own axis, 0..=4095.
    let mut curve = [0u32; 4096];
    for seg in 0..5 {
        for j in points[seg] + 1..=points[seg + 1] {
            curve[j] = curve[j - 1] + (1 << seg);
        }
    }
    Ok((0..=usize::from(MAX_CODE)).map(|c| curve[2 * c].min(u32::from(u16::MAX)) as u16).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pack fields into a block the way the layout above describes. Only
    /// arithmetic coverage of the unpacking; the real file is the evidence
    /// about the format (`tests/arw_decode.rs`).
    fn pack(max: u16, min: u16, imax: u8, imin: u8, deltas: [u8; 14]) -> [u8; 16] {
        let mut v: u128 = u128::from(max) | u128::from(min) << 11 | u128::from(imax) << 22 | u128::from(imin) << 26;
        for (i, &d) in deltas.iter().enumerate() {
            v |= u128::from(d & 0x7f) << (30 + 7 * i);
        }
        v.to_le_bytes()
    }

    #[test]
    fn a_block_unpacks_its_fields_in_position_order() {
        let deltas = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 127];
        // Range 1900 − 1000 = 900: 128 << 3 = 1024 is the first above it.
        let codes = unpack_block(&pack(1900, 1000, 3, 0, deltas));
        assert_eq!(codes[0], 1000);
        assert_eq!(codes[3], 1900);
        let others: Vec<u16> = codes.iter().enumerate().filter(|(i, _)| *i != 0 && *i != 3).map(|(_, &c)| c).collect();
        let expected: Vec<u16> = deltas.iter().map(|&d| 1000 + (u16::from(d) << 3)).collect();
        assert_eq!(others, expected);
    }

    #[test]
    fn the_shift_is_the_smallest_that_spans_the_range_and_codes_saturate() {
        assert_eq!(unpack_block(&pack(100, 0, 0, 1, [127; 14]))[2], 127, "range 100: no shift");
        assert_eq!(unpack_block(&pack(128, 0, 0, 1, [1; 14]))[2], 2, "range 128: shift 1");
        // Shift 4 at most, and min + delta above 2047 is 2047.
        assert_eq!(unpack_block(&pack(2047, 0, 0, 1, [127; 14]))[2], 127 << 4);
        assert_eq!(unpack_block(&pack(2047, 1500, 0, 1, [127; 14]))[2], 2047);
    }

    #[test]
    fn the_same_position_for_both_ends_does_not_read_past_the_block() {
        let codes = unpack_block(&pack(50, 10, 5, 5, [7; 14]));
        assert_eq!(codes[5], 50);
        assert_eq!(codes[15], 10);
        assert_eq!(codes[4], 17);
    }

    #[test]
    fn groups_interleave_the_two_colours() {
        let even = pack(20, 10, 0, 1, [0; 14]);
        let odd = pack(40, 30, 0, 1, [0; 14]);
        let row: Vec<u8> = even.iter().chain(odd.iter()).copied().collect();
        let codes = decode_codes(&row, 32, 1).unwrap();
        assert_eq!(&codes[..6], &[20, 40, 10, 30, 10, 30]);
        assert!(decode_codes(&row, 16, 2).is_err());
        assert!(decode_codes(&row[..31], 32, 1).is_err());
    }

    #[test]
    fn the_curve_doubles_its_slope_at_each_knee() {
        let t = code_to_linear(&[8000, 10400, 12900, 14100]).unwrap();
        assert_eq!(t.len(), 2048);
        assert_eq!(t[0], 0);
        assert_eq!(t[1000], 2000, "slope 1 on the curve's axis, which is twice the code");
        assert_eq!(t[1300] - t[1000], 1200);
        assert!(t.windows(2).all(|w| w[0] <= w[1]));
        assert!(code_to_linear(&[8000, 7000, 12900, 14100]).is_err());
        assert!(code_to_linear(&[8000]).is_err());
    }
}
