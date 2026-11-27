//! An uncompressed NEF mosaic's bytes to one `u16` a pixel, in each of the
//! layouts of [`NefLayout`]: 16-bit words in the file's byte order, or 12
//! or 14 bits a pixel packed into rows of a fixed length, high bit first
//! (each byte's top bits are the earlier pixel's) or low bit first (the
//! bytes of a row read as one little-endian number, the first pixel in its
//! lowest bits). A packed row's bytes past its last pixel are padding.

use super::NefLayout;

/// The mosaic of `width × height` pixels stored in `bytes` with `layout`.
/// An error when `bytes` is shorter than the layout needs (longer is
/// fine: the rest is not read).
pub fn unpack(bytes: &[u8], width: usize, height: usize, layout: NefLayout) -> Result<Vec<u16>, String> {
    let pixels = width.checked_mul(height).ok_or("the mosaic's size overflows")?;
    let (row_bytes, bits) = match layout {
        NefLayout::Words { .. } => (width.checked_mul(2).ok_or("the mosaic's size overflows")?, 16usize),
        NefLayout::Packed { bits, row_bytes, .. } => (row_bytes as usize, usize::from(bits)),
    };
    if !(1..=16).contains(&bits) || width.checked_mul(bits).is_none_or(|b| b.div_ceil(8) > row_bytes) {
        return Err(format!("rows of {row_bytes} bytes cannot hold {width} pixels of {bits} bits"));
    }
    if row_bytes.checked_mul(height).is_none_or(|n| n > bytes.len()) {
        return Err("This Nikon RAW is cut short: its sensor data is smaller than its size says".into());
    }
    let mut out: Vec<u16> = Vec::new();
    out.try_reserve_exact(pixels).map_err(|_| "not enough memory for the Nikon RAW's pixels".to_string())?;
    for row in bytes.chunks_exact(row_bytes).take(height) {
        match layout {
            NefLayout::Words { big_endian: true } => out.extend(row.chunks_exact(2).map(|b| u16::from_be_bytes([b[0], b[1]]))),
            NefLayout::Words { big_endian: false } => out.extend(row.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]]))),
            NefLayout::Packed { msb_first, .. } => {
                let mask = (1u32 << bits) - 1;
                let (mut acc, mut held, mut next) = (0u32, 0usize, 0usize);
                for _ in 0..width {
                    while held < bits {
                        let byte = u32::from(row[next]);
                        next += 1;
                        if msb_first {
                            acc = (acc << 8) | byte;
                        } else {
                            acc |= byte << held;
                        }
                        held += 8;
                    }
                    let v = if msb_first {
                        held -= bits;
                        let v = (acc >> held) & mask;
                        acc &= (1u32 << held) - 1;
                        v
                    } else {
                        let v = acc & mask;
                        acc >>= bits;
                        held -= bits;
                        v
                    };
                    out.push(v as u16);
                }
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_in_either_byte_order() {
        let b = [0x12, 0x34, 0x56, 0x78];
        assert_eq!(unpack(&b, 2, 1, NefLayout::Words { big_endian: true }).unwrap(), vec![0x1234, 0x5678]);
        assert_eq!(unpack(&b, 2, 1, NefLayout::Words { big_endian: false }).unwrap(), vec![0x3412, 0x7856]);
    }

    #[test]
    fn twelve_bits_high_bit_first_and_low_bit_first() {
        // Pixels 0xABC and 0x123.
        let msb = [0xAB, 0xC1, 0x23];
        assert_eq!(unpack(&msb, 2, 1, NefLayout::Packed { bits: 12, row_bytes: 3, msb_first: true }).unwrap(), vec![0xABC, 0x123]);
        let lsb = [0xBC, 0x3A, 0x12];
        assert_eq!(unpack(&lsb, 2, 1, NefLayout::Packed { bits: 12, row_bytes: 3, msb_first: false }).unwrap(), vec![0xABC, 0x123]);
    }

    #[test]
    fn fourteen_bits_low_bit_first_with_padded_rows() {
        // Four 14-bit pixels a row (7 bytes) padded to 8, two rows.
        let px = [0x3FFFu64, 0x0001, 0x2AAA, 0x1555, 0x0000, 0x3FFF, 0x0400, 0x0123];
        let mut bytes = Vec::new();
        for row in px.chunks(4) {
            let n = row.iter().enumerate().fold(0u64, |a, (i, &v)| a | v << (14 * i));
            bytes.extend_from_slice(&n.to_le_bytes()[..7]);
            bytes.push(0xEE);
        }
        let got = unpack(&bytes, 4, 2, NefLayout::Packed { bits: 14, row_bytes: 8, msb_first: false }).unwrap();
        assert_eq!(got, px.map(|v| v as u16).to_vec());
    }

    #[test]
    fn too_few_bytes_or_rows_too_short_are_errors() {
        assert!(unpack(&[0; 5], 2, 2, NefLayout::Packed { bits: 12, row_bytes: 3, msb_first: true }).is_err());
        assert!(unpack(&[0; 8], 4, 2, NefLayout::Packed { bits: 12, row_bytes: 4, msb_first: false }).is_err());
        assert!(unpack(&[0; 3], 2, 1, NefLayout::Words { big_endian: true }).is_err());
        assert!(unpack(&[], usize::MAX, 2, NefLayout::Words { big_endian: true }).is_err());
    }
}
