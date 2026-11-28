//! Nikon's compressed NEF: lossless and lossy, 12 and 14 bits.
//!
//! The mosaic is one bitstream (high bit first, no byte stuffing, rows not
//! aligned to bytes). Each sample is a difference from a predictor, coded
//! as in lossless JPEG (ITU-T T.81, H.1.2): a Huffman-coded size, then that
//! many bits of the difference, its sign carried by the top bit. (A size
//! symbol's high nibble, when not 0, is a shift: only the lossy tables
//! used after a split row have such symbols.) The predictor of a sample is the
//! sample two columns before it in the same row; the first two samples of
//! a row take the first two of the row two above, starting from four
//! values the file gives. A predicted value is a code; the lossy forms map
//! codes to linear values through the curve the file carries.
//!
//! **What the file carries** is the maker note's tag 0x0096: a version
//! (0x46 lossless; 0x44 lossy, then 0x20 for a curve sampled at even steps
//! over the codes, 0x40 the same over a quarter as many codes, or 0x10 for
//! a whole curve, one value a code),
//! the four starting predictors in the maker note's byte order, the
//! curve's length and the curve. A sampled-curve file may also name a row
//! (at byte 562) from which on a second table applies; no sample has one,
//! so such a file is refused.
//!
//! Checked on real files (raw.pixls.us, CC0) against the camera's JPEG:
//! lossless 12-bit (D3) and 14-bit (Z 6, Z 30), lossy with a sampled curve
//! 12-bit (D7000, D850) and 14-bit (D3), and over a quarter of the codes,
//! 12-bit (Z 7II). The whole-curve form (0x10, the D70's) is read but no
//! such file opens: its white balance is not in the clear.
//!
//! **What it does not carry** are the Huffman tables ([`TREES`]): Nikon's
//! constants, one per form and depth, fixed in the cameras. Their values
//! were taken from dcraw (Dave Coffin's `dcraw.c`, revision 1.478, whose
//! Nikon functions are "free for all uses"), as was the layout of the
//! bitstream above; the 0x40 form's quarter range from LibRaw (LGPL 2.1 or
//! CDDL 1.0). This decoder is written for this code base.
//!
//! The bytes are untrusted: a code not in the table, a value outside the
//! curve's range, a stream that ends before the last sample and a curve
//! that does not fit are errors, and the work is one table lookup per
//! sample of a frame whose size was checked before anything was allocated.

/// Nikon's Huffman tables, as 16 counts of codes of each length (1..=16)
/// and the size symbols in code order (unused entries 0): 12-bit lossy,
/// 12-bit lossy after a split row (not used: such files are refused),
/// 12-bit lossless, then the same for 14 bits. A symbol's low nibble is
/// the size, its high nibble a shift.
pub const TREES: [[u8; 32]; 6] = [
    [0, 1, 5, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 5, 4, 3, 6, 2, 7, 1, 0, 8, 9, 11, 10, 12, 0, 0, 0],
    [0, 1, 5, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0x39, 0x5a, 0x38, 0x27, 0x16, 5, 4, 3, 2, 1, 0, 11, 12, 12, 0, 0],
    [0, 1, 4, 2, 3, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 4, 6, 3, 7, 2, 8, 1, 9, 0, 10, 11, 12, 0, 0, 0],
    [0, 1, 4, 3, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 5, 6, 4, 7, 8, 3, 9, 2, 1, 0, 10, 11, 12, 13, 14, 0],
    [0, 1, 5, 1, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 8, 0x5c, 0x4b, 0x3a, 0x29, 7, 6, 5, 4, 3, 2, 1, 0, 13, 14, 0],
    [0, 1, 4, 2, 2, 3, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 7, 6, 8, 5, 9, 4, 10, 3, 11, 12, 2, 0, 1, 13, 14, 0],
];

/// Codes run to 2^14; the curve has one more entry, the top of a sampled
/// curve's last step.
const CURVE_LEN: usize = (1 << 14) + 1;
/// Where the split row is in a sampled-curve file's tag 0x0096.
const SPLIT_AT: usize = 562;

/// What a compressed NEF's tag 0x0096 says, settled for the decode.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NefCompression {
    pub lossless: bool,
    /// The starting predictors of even and odd rows, first two columns.
    pub start: [[u16; 2]; 2],
    /// Code → linear value, [`CURVE_LEN`] entries (the identity for the
    /// lossless form).
    pub curve: Vec<u16>,
    /// Codes from this one on are errors.
    pub code_limit: u32,
    /// The largest linear value: the curve at the last code.
    pub white: u32,
}

impl NefCompression {
    /// Read tag 0x0096's bytes (`little_endian` as the maker note) for a
    /// mosaic of `bits`. An error is a sentence a person can read.
    pub fn read(tag: &[u8], little_endian: bool, bits: u16) -> Result<Self, String> {
        let short = |at: usize| -> Option<u16> {
            let b = tag.get(at..at + 2)?;
            Some(if little_endian { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) })
        };
        let damaged = || "This Nikon RAW's compression data is damaged".to_string();
        let (version, form) = match tag {
            [v, f, ..] => (*v, *f),
            _ => return Err(damaged()),
        };
        if !matches!(bits, 12 | 14) {
            return Err(format!("This Nikon RAW stores {bits}-bit compressed data, which is not supported"));
        }
        let lossless = match (version, form) {
            (0x46, _) => true,
            (0x44, 0x10 | 0x20 | 0x40) => false,
            _ => return Err(format!("This Nikon RAW uses a compressed form ({version:#04x} {form:#04x}) that is not supported yet")),
        };
        let start = [[short(2).ok_or_else(damaged)?, short(4).ok_or_else(damaged)?], [short(6).ok_or_else(damaged)?, short(8).ok_or_else(damaged)?]];
        let full = 1usize << bits;
        let mut curve: Vec<u16> = (0..CURVE_LEN).map(|i| i as u16).collect();
        let mut code_limit = full;
        if !lossless {
            let count = usize::from(short(10).ok_or_else(damaged)?);
            if form == 0x20 || form == 0x40 {
                // A sampled curve: `count` values at even steps over the
                // codes, joined by straight lines. The 0x40 form's codes
                // run to a quarter of the depth's range.
                let codes = if form == 0x40 { full / 4 } else { full };
                let steps = count.checked_sub(1).filter(|&s| s > 0 && codes % s == 0).ok_or_else(damaged)?;
                let step = codes / steps;
                let samples: Vec<u16> = (0..count).map(|i| short(12 + 2 * i)).collect::<Option<_>>().ok_or_else(damaged)?;
                for (i, v) in curve.iter_mut().enumerate().take(codes + 1) {
                    let (k, r) = (i / step, (i % step) as u32);
                    let a = u32::from(samples[k]);
                    let b = samples.get(k + 1).map_or(a, |&b| u32::from(b));
                    *v = ((a * (step as u32 - r) + b * r) / step as u32) as u16;
                }
                code_limit = codes;
                if short(SPLIT_AT).is_some_and(|s| s > 0) {
                    return Err("This Nikon RAW uses a lossy compressed form that changes tables part way down, which is not supported yet".into());
                }
            } else {
                // The whole curve: one value a code.
                if !(2..=CURVE_LEN).contains(&count) {
                    return Err(damaged());
                }
                for (i, v) in curve.iter_mut().enumerate().take(count) {
                    *v = short(12 + 2 * i).ok_or_else(damaged)?;
                }
                code_limit = count;
            }
        }
        // Codes past the curve's last rise all give its top value.
        while code_limit >= 2 && curve[code_limit - 2] == curve[code_limit - 1] {
            code_limit -= 1;
        }
        let white = u32::from(curve[code_limit - 1]);
        if white == 0 {
            return Err(damaged());
        }
        Ok(NefCompression { lossless, start, curve, code_limit: code_limit as u32, white })
    }
}

/// A Huffman table as a lookup on the next `max_len` bits: each entry the
/// length of the code those bits start with and its symbol, or length 0
/// where no code starts (an error).
struct Huffman {
    max_len: u32,
    entries: Vec<(u8, u8)>,
    /// The shortest code, for the bound on what a stream can hold.
    min_len: u32,
}

impl Huffman {
    /// Canonical codes in order of length, then of symbol position.
    fn new(tree: &[u8; 32]) -> Self {
        let (counts, symbols) = tree.split_at(16);
        let max_len = (1..=16u32).rev().find(|&l| counts[l as usize - 1] > 0).unwrap_or(1);
        let min_len = (1..=16u32).find(|&l| counts[l as usize - 1] > 0).unwrap_or(1);
        let mut entries = vec![(0u8, 0u8); 1 << max_len];
        let (mut code, mut next) = (0usize, 0usize);
        for len in 1..=max_len {
            for _ in 0..counts[len as usize - 1] {
                let span = 1usize << (max_len - len);
                let first = code << (max_len - len);
                if let (Some(slots), Some(&symbol)) = (entries.get_mut(first..first + span), symbols.get(next)) {
                    slots.fill((len as u8, symbol));
                }
                code += 1;
                next += 1;
            }
            code <<= 1;
        }
        Huffman { max_len, entries, min_len }
    }
}

/// The stream's bits, high bit first. Bits past the end read as 0 when
/// looked at, but taking one is an error.
struct Bits<'a> {
    data: &'a [u8],
    next: usize,
    buf: u64,
    held: u32,
}

const TRUNCATED: &str = "This Nikon RAW is cut short: its compressed sensor data ends before the picture does";

impl<'a> Bits<'a> {
    fn new(data: &'a [u8]) -> Self {
        Bits { data, next: 0, buf: 0, held: 0 }
    }

    /// The next `n` bits (at most 32), without taking them.
    fn peek(&mut self, n: u32) -> u32 {
        while self.held <= 56 {
            let Some(&b) = self.data.get(self.next) else { break };
            self.buf = (self.buf << 8) | u64::from(b);
            self.next += 1;
            self.held += 8;
        }
        if n == 0 {
            return 0;
        }
        if self.held >= n {
            ((self.buf >> (self.held - n)) & ((1u64 << n) - 1)) as u32
        } else {
            ((self.buf << (n - self.held)) & ((1u64 << n) - 1)) as u32
        }
    }

    fn take(&mut self, n: u32) -> Result<(), &'static str> {
        if n > self.held {
            return Err(TRUNCATED);
        }
        self.held -= n;
        self.buf &= if self.held == 0 { 0 } else { (1u64 << self.held) - 1 };
        Ok(())
    }

    fn read(&mut self, n: u32) -> Result<u32, &'static str> {
        let v = self.peek(n);
        self.take(n)?;
        Ok(v)
    }
}

/// Decode a compressed mosaic of `width × height` samples of `bits` from
/// `stream`: linear values (through the curve), row by row.
pub fn decode(stream: &[u8], width: usize, height: usize, bits: u16, c: &NefCompression) -> Result<Vec<u16>, String> {
    let table = Huffman::new(&TREES[if c.lossless { 2 } else { 0 } + if bits == 14 { 3 } else { 0 }]);
    let pixels = width.checked_mul(height).ok_or("the mosaic's size overflows")?;
    if width < 2 || height == 0 {
        return Err("This Nikon RAW's sensor data has no pixels".into());
    }
    // Every sample takes at least the shortest code: a stream too short to
    // hold the frame is refused before the frame is allocated.
    let least_bits = pixels.checked_mul(table.min_len as usize).ok_or("the mosaic's size overflows")?;
    if stream.len().saturating_mul(8) < least_bits {
        return Err(TRUNCATED.into());
    }
    let mut out: Vec<u16> = Vec::new();
    out.try_reserve_exact(pixels).map_err(|_| "not enough memory for the Nikon RAW's pixels".to_string())?;
    let mut bits_in = Bits::new(stream);
    let mut start = c.start;
    for row in 0..height {
        let mut pred = [0u16; 2];
        for col in 0..width {
            let (len, symbol) = table.entries.get(bits_in.peek(table.max_len) as usize).copied().unwrap_or((0, 0));
            if len == 0 {
                return Err(format!("This Nikon RAW's compressed sensor data is damaged (no code at row {row}, column {col})"));
            }
            bits_in.take(u32::from(len))?;
            let (size, shift) = (u32::from(symbol & 15), u32::from(symbol >> 4));
            let diff: i32 = if size == 0 {
                0
            } else {
                if shift > size {
                    return Err("This Nikon RAW's compressed sensor data is damaged (a bad size)".into());
                }
                let v = bits_in.read(size - shift)? as i32;
                let mut d = (((v << 1) + 1) << shift) >> 1;
                if d & (1 << (size - 1)) == 0 {
                    d -= (1 << size) - i32::from(shift == 0);
                }
                d
            };
            let p = if col < 2 {
                let s = &mut start[row & 1][col];
                *s = s.wrapping_add(diff as u16);
                *s
            } else {
                pred[col & 1].wrapping_add(diff as u16)
            };
            pred[col & 1] = p;
            // A value below 0 wraps far past the limit, which is at most 2^14.
            match c.curve.get(usize::from(p)).filter(|_| u32::from(p) < c.code_limit) {
                Some(&v) => out.push(v),
                None => return Err(format!("This Nikon RAW's compressed sensor data is damaged (a value out of range at row {row}, column {col})")),
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A bit writer for hand-built streams (not camera data).
    struct Writer {
        bytes: Vec<u8>,
        acc: u64,
        n: u32,
    }

    impl Writer {
        fn new() -> Self {
            Writer { bytes: Vec::new(), acc: 0, n: 0 }
        }
        fn put(&mut self, value: u32, len: u32) {
            self.acc = (self.acc << len) | u64::from(value);
            self.n += len;
            while self.n >= 8 {
                self.bytes.push((self.acc >> (self.n - 8)) as u8);
                self.n -= 8;
                self.acc &= (1 << self.n) - 1;
            }
        }
        fn finish(mut self) -> Vec<u8> {
            if self.n > 0 {
                let n = self.n;
                self.put(0, 8 - n);
            }
            self.bytes
        }
    }

    /// The canonical code of `symbol` in `tree`: (code, length).
    fn code_of(tree: &[u8; 32], symbol: u8) -> (u32, u32) {
        let (mut code, mut next) = (0u32, 0usize);
        for len in 1..=16u32 {
            for _ in 0..tree[len as usize - 1] {
                if tree[16 + next] == symbol {
                    return (code, len);
                }
                code += 1;
                next += 1;
            }
            code <<= 1;
        }
        panic!("symbol {symbol} not in the tree");
    }

    /// Write one difference with the lossless 12-bit table.
    fn put_diff(w: &mut Writer, diff: i32) {
        let size = if diff == 0 { 0 } else { 32 - diff.unsigned_abs().leading_zeros() };
        let (code, len) = code_of(&TREES[2], size as u8);
        w.put(code, len);
        if size > 0 {
            let bits = if diff > 0 { diff as u32 } else { (diff + (1 << size) - 1) as u32 };
            w.put(bits, size);
        }
    }

    /// Encode `values` (`w` × `h`) with the predictors the decoder uses.
    fn encode(values: &[u16], w: usize, h: usize, start: u16) -> Vec<u8> {
        let mut first = [[start; 2]; 2];
        let mut wr = Writer::new();
        for r in 0..h {
            let mut pred = [0u16; 2];
            for c in 0..w {
                let v = values[r * w + c];
                let p = if c < 2 { first[r & 1][c] } else { pred[c & 1] };
                put_diff(&mut wr, i32::from(v) - i32::from(p));
                if c < 2 {
                    first[r & 1][c] = v;
                }
                pred[c & 1] = v;
            }
        }
        wr.finish()
    }

    fn lossless_tag(start: u16) -> Vec<u8> {
        let mut t = vec![0x46, 0x30];
        for _ in 0..4 {
            t.extend_from_slice(&start.to_be_bytes());
        }
        t.extend_from_slice(&[0, 0]);
        t
    }

    #[test]
    fn every_table_is_a_complete_prefix_code() {
        for (i, tree) in TREES.iter().enumerate() {
            let kraft: f64 = (1..=16).map(|l| f64::from(tree[l - 1]) / f64::from(1u32 << l)).sum();
            assert!((kraft - 1.0).abs() < 1e-12, "table {i}: {kraft}");
            assert!(Huffman::new(tree).entries.iter().all(|e| e.0 > 0), "table {i} leaves a gap");
        }
    }

    #[test]
    fn a_hand_built_lossless_stream_decodes_to_its_values() {
        // 4 × 2: rows of differences from the predictors.
        let c = NefCompression::read(&lossless_tag(100), false, 12).unwrap();
        assert!(c.lossless && c.white == 4095 && c.code_limit == 4096);
        let want: Vec<u16> = vec![110, 90, 115, 80, 100, 101, 3000, 7, 4095, 0, 2048, 2047, 111, 92, 0, 4095];
        let got = decode(&encode(&want, 4, 4, 100), 4, 4, 12, &c).unwrap();
        assert_eq!(got, want);
    }

    #[test]
    fn a_truncated_stream_is_an_error() {
        let c = NefCompression::read(&lossless_tag(100), false, 12).unwrap();
        let values: Vec<u16> = (0..64u32).map(|i| (i.wrapping_mul(2654435761) >> 20) as u16 & 0xFFF).collect();
        let stream = encode(&values, 8, 8, 100);
        assert_eq!(decode(&stream, 8, 8, 12, &c).unwrap(), values);
        for cut in 0..stream.len() - 1 {
            let e = decode(&stream[..cut], 8, 8, 12, &c).unwrap_err();
            assert!(e.contains("cut short"), "{cut}: {e}");
        }
        assert!(decode(&[], 8, 8, 12, &c).is_err());
    }

    #[test]
    fn a_value_past_the_range_is_an_error_not_a_wrap() {
        // Start at 4000, then +200: past 4095.
        let c = NefCompression::read(&lossless_tag(4000), false, 12).unwrap();
        let mut w = Writer::new();
        for _ in 0..4 {
            put_diff(&mut w, 200);
        }
        let e = decode(&w.finish(), 2, 2, 12, &c).unwrap_err();
        assert!(e.contains("out of range"), "{e}");
        // And below 0.
        let c = NefCompression::read(&lossless_tag(5), false, 12).unwrap();
        let mut w = Writer::new();
        for _ in 0..4 {
            put_diff(&mut w, -100);
        }
        assert!(decode(&w.finish(), 2, 2, 12, &c).unwrap_err().contains("out of range"));
    }

    #[test]
    fn a_bad_code_is_an_error() {
        // A table with a gap: one code of length 2 only.
        let mut tree = [0u8; 32];
        tree[1] = 1;
        let h = Huffman::new(&tree);
        assert_eq!(h.entries, vec![(2, 0), (0, 0), (0, 0), (0, 0)]);
        // With Nikon's complete tables every bit pattern is a code, so a
        // damaged stream shows as values out of range or a short stream:
        // all-ones bits are the longest codes, the largest differences.
        let c = NefCompression::read(&lossless_tag(2048), false, 12).unwrap();
        assert!(decode(&[0xFF; 64], 16, 16, 12, &c).is_err());
    }

    #[test]
    fn compression_data_is_checked() {
        assert!(NefCompression::read(&[], true, 12).is_err());
        assert!(NefCompression::read(&[0x46], true, 12).is_err());
        assert!(NefCompression::read(&[0x46, 0x30, 0, 8], true, 12).is_err(), "predictors cut off");
        assert!(NefCompression::read(&lossless_tag(8), true, 10).is_err(), "10 bits");
        assert!(NefCompression::read(&[0x49, 0x58, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], true, 12).is_err(), "unknown form");
        // A sampled lossy curve whose steps do not divide the codes.
        let mut t = vec![0x44, 0x20, 0, 1, 0, 1, 0, 1, 0, 1, 0, 4];
        t.extend_from_slice(&[0, 0, 0, 1, 0, 2, 0, 3]);
        assert!(NefCompression::read(&t, false, 12).is_err());
        // A whole lossy curve longer than the data.
        let mut t = vec![0x44, 0x10, 0, 1, 0, 1, 0, 1, 0, 1, 0x02, 0xab];
        t.extend_from_slice(&[0, 0, 0, 1]);
        assert!(NefCompression::read(&t, false, 12).is_err());
        // A sampled curve with a split row: refused, no sample has one.
        let mut t = vec![0x44, 0x20, 0, 1, 0, 1, 0, 1, 0, 1, 0, 3];
        t.extend_from_slice(&[0, 0, 4, 0, 4, 0]);
        t.resize(564, 0);
        assert!(NefCompression::read(&t, false, 12).is_ok());
        t[563] = 7;
        assert!(NefCompression::read(&t, false, 12).unwrap_err().contains("part way down"));
        // The 0x40 form: sampled over a quarter of the codes (1024 at 12
        // bits), so 3 samples are 512 codes apart.
        let mut t = vec![0x44, 0x40, 0, 1, 0, 1, 0, 1, 0, 1, 0, 3];
        t.extend_from_slice(&[0, 0, 0x08, 0, 0x0F, 0xFF]);
        let c = NefCompression::read(&t, false, 12).unwrap();
        assert_eq!((c.code_limit, c.curve[256], c.curve[512], c.curve[1024]), (1024, 1024, 2048, 4095));
        // And the whole-curve form 0x10.
        let mut t = vec![0x44, 0x10, 0, 1, 0, 1, 0, 1, 0, 1, 0, 3];
        t.extend_from_slice(&[0, 0, 0, 9, 0x0F, 0xFF]);
        let c = NefCompression::read(&t, false, 12).unwrap();
        assert_eq!((c.code_limit, c.white, c.curve[1]), (3, 4095, 9));
        // A flat curve has no white.
        let mut t = vec![0x44, 0x10, 0, 1, 0, 1, 0, 1, 0, 1, 0, 3];
        t.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
        assert!(NefCompression::read(&t, false, 12).is_err());
    }

    #[test]
    fn a_sampled_curve_is_joined_by_straight_lines_and_trimmed() {
        // 12 bits, 3 samples: steps of 2048, values 0, 1024, 1024.
        let mut t = vec![0x44, 0x20, 0, 1, 0, 1, 0, 1, 0, 1, 0, 3];
        t.extend_from_slice(&[0, 0, 4, 0, 4, 0]);
        let c = NefCompression::read(&t, false, 12).unwrap();
        assert_eq!((c.curve[0], c.curve[1024], c.curve[2048], c.curve[3000]), (0, 512, 1024, 1024));
        assert_eq!((c.code_limit, c.white), (2049, 1024));
    }
}
