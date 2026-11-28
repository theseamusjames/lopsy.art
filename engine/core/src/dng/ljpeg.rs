/// Lossless JPEG decoder (ITU T.81 process 14 / JPEG SOF3).
/// Used by DNG files (especially Apple ProRAW) for raw pixel data compression.

pub fn decode_lossless_jpeg(data: &[u8]) -> Result<Vec<u16>, String> {
    let mut decoder = LjpegDecoder::new(data);
    decoder.decode()
}

/// The frame a stream was decoded with: what its `SOF3` said.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LjpegFrame {
    pub precision: u8,
    pub width: u32,
    pub height: u32,
    pub components: u8,
}

/// [`decode_lossless_jpeg`], with the frame the samples were decoded
/// with, for a caller that read the frame header itself to check the two
/// agree.
pub fn decode_lossless_jpeg_framed(data: &[u8]) -> Result<(Vec<u16>, LjpegFrame), String> {
    let mut decoder = LjpegDecoder::new(data);
    let samples = decoder.decode()?;
    let frame = LjpegFrame { precision: decoder.precision, width: decoder.width, height: decoder.height, components: decoder.components };
    Ok((samples, frame))
}

struct HuffTable {
    /// min_code[i] = minimum Huffman code of length i+1
    min_code: [i32; 17],
    /// max_code[i] = maximum Huffman code of length i+1, or -1 if none
    max_code: [i32; 17],
    /// val_ptr[i] = index into values[] for codes of length i+1
    val_ptr: [usize; 17],
    values: Vec<u8>,
}

impl HuffTable {
    fn from_lengths_and_values(bits: &[u8; 16], values: &[u8]) -> Self {
        let mut min_code = [0i32; 17];
        let mut max_code = [-1i32; 17];
        let mut val_ptr = [0usize; 17];

        let mut code = 0i32;
        let mut val_idx = 0usize;

        for i in 0..16 {
            let count = bits[i] as usize;
            if count > 0 {
                val_ptr[i] = val_idx;
                min_code[i] = code;
                max_code[i] = code + count as i32 - 1;
                val_idx += count;
            }
            code = (code + count as i32) << 1;
        }

        HuffTable {
            min_code,
            max_code,
            val_ptr,
            values: values.to_vec(),
        }
    }
}

struct BitReader<'a> {
    data: &'a [u8],
    pos: usize,
    bit_buf: u32,
    bits_left: u32,
    /// Zero bytes fed in after the data ran out. A valid stream never
    /// needs more than a few; a cut-short one is refused instead of being
    /// read forever.
    overrun: u32,
}

/// Zero bytes past the end of the data a stream may use before it is
/// called cut short.
const MAX_OVERRUN: u32 = 8;

impl<'a> BitReader<'a> {
    fn new(data: &'a [u8], start: usize) -> Self {
        Self { data, pos: start, bit_buf: 0, bits_left: 0, overrun: 0 }
    }

    fn fill(&mut self) {
        while self.bits_left <= 24 && self.pos < self.data.len() {
            let byte = self.data[self.pos];
            self.pos += 1;

            if byte == 0xFF && self.pos < self.data.len() && self.data[self.pos] == 0x00 {
                self.pos += 1; // skip stuff byte
            }

            self.bit_buf = (self.bit_buf << 8) | byte as u32;
            self.bits_left += 8;
        }
    }

    fn peek(&mut self, n: u32) -> u32 {
        while self.bits_left < n {
            self.fill();
            if self.bits_left < n {
                // Past the end of the data: zeros, counted.
                self.bit_buf <<= 8;
                self.bits_left += 8;
                self.overrun += 1;
            }
        }
        (self.bit_buf >> (self.bits_left - n)) & ((1 << n) - 1)
    }

    fn skip(&mut self, n: u32) {
        self.bits_left -= n;
    }

    fn read(&mut self, n: u32) -> u32 {
        let val = self.peek(n);
        self.skip(n);
        val
    }

    fn decode_huffman(&mut self, table: &HuffTable) -> Result<u8, String> {
        self.fill();

        // Standard JPEG Huffman decode
        let mut code = 0i32;
        for len in 0..16usize {
            let bit = self.peek(1);
            self.skip(1);
            code = (code << 1) | bit as i32;

            if table.max_code[len] >= 0 && code <= table.max_code[len] {
                let idx = table.val_ptr[len] + (code - table.min_code[len]) as usize;
                return table.values.get(idx).copied()
                    .ok_or_else(|| "Huffman value index out of bounds".to_string());
            }
        }

        Err("Huffman decode failed: no matching code".into())
    }

    fn read_signed(&mut self, category: u8) -> i32 {
        if category == 0 { return 0; }
        let bits = self.read(category as u32);
        // JPEG sign extension
        if bits < (1 << (category - 1)) {
            bits as i32 - ((1 << category) - 1)
        } else {
            bits as i32
        }
    }
}

struct LjpegDecoder<'a> {
    data: &'a [u8],
    pos: usize,
    width: u32,
    height: u32,
    components: u8,
    precision: u8,
    predictor: u8,
    point_transform: u8,
    huff_tables: [Option<HuffTable>; 4],
    comp_huff: [usize; 4],
}

impl<'a> LjpegDecoder<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            pos: 0,
            width: 0,
            height: 0,
            components: 0,
            precision: 0,
            predictor: 1,
            point_transform: 0,
            huff_tables: [None, None, None, None],
            comp_huff: [0; 4],
        }
    }

    fn decode(&mut self) -> Result<Vec<u16>, String> {
        self.parse_markers()?;

        if self.width == 0 || self.height == 0 {
            return Err("No SOF3 frame found".into());
        }

        let w = self.width as usize;
        let h = self.height as usize;
        let nc = self.components as usize;
        let pt = self.point_transform;
        // The header is the file's: check what it asks for before
        // allocating it, and refuse values the arithmetic below cannot take.
        if !(1..=4).contains(&nc) || !(2..=16).contains(&self.precision) || pt >= 16 {
            return Err(format!(
                "Unsupported lossless JPEG: {nc} components, {}-bit, point transform {pt}",
                self.precision
            ));
        }
        crate::decode::check_image_size(self.width, self.height, 2 * nc as u64)?;
        let mut output: Vec<u16> = Vec::new();
        output.try_reserve_exact(w * h * nc).map_err(|_| "not enough memory for the lossless JPEG".to_string())?;
        output.resize(w * h * nc, 0);
        let mut reader = BitReader::new(self.data, self.pos);

        let half = 1u32 << (self.precision - 1);

        for row in 0..h {
            if reader.overrun > MAX_OVERRUN {
                return Err("Lossless JPEG data ends early".into());
            }
            for col in 0..w {
                for c in 0..nc {
                    let table_idx = self.comp_huff[c];
                    let table = self.huff_tables[table_idx].as_ref()
                        .ok_or_else(|| format!("Missing Huffman table {table_idx}"))?;

                    let category = reader.decode_huffman(table)?;
                    if category > 16 {
                        return Err(format!("Lossless JPEG difference category {category} is out of range"));
                    }
                    let diff = if category == 16 {
                        32768 // Special case for 16-bit lossless
                    } else {
                        reader.read_signed(category)
                    };

                    // Predictor
                    let predicted = if row == 0 && col == 0 {
                        half as i32
                    } else if row == 0 {
                        output[(col - 1) * nc + c] as i32
                    } else if col == 0 {
                        output[((row - 1) * w) * nc + c] as i32
                    } else {
                        match self.predictor {
                            1 => output[(row * w + col - 1) * nc + c] as i32,
                            2 => output[((row - 1) * w + col) * nc + c] as i32,
                            3 => output[((row - 1) * w + col - 1) * nc + c] as i32,
                            4 => {
                                let a = output[(row * w + col - 1) * nc + c] as i32;
                                let b = output[((row - 1) * w + col) * nc + c] as i32;
                                let c_val = output[((row - 1) * w + col - 1) * nc + c] as i32;
                                a + b - c_val
                            }
                            5 => {
                                let a = output[(row * w + col - 1) * nc + c] as i32;
                                let b = output[((row - 1) * w + col) * nc + c] as i32;
                                let c_val = output[((row - 1) * w + col - 1) * nc + c] as i32;
                                a + ((b - c_val) >> 1)
                            }
                            6 => {
                                let a = output[(row * w + col - 1) * nc + c] as i32;
                                let b = output[((row - 1) * w + col) * nc + c] as i32;
                                let c_val = output[((row - 1) * w + col - 1) * nc + c] as i32;
                                b + ((a - c_val) >> 1)
                            }
                            7 => {
                                let a = output[(row * w + col - 1) * nc + c] as i32;
                                let b = output[((row - 1) * w + col) * nc + c] as i32;
                                (a + b) >> 1
                            }
                            _ => output[(row * w + col - 1) * nc + c] as i32,
                        }
                    };

                    let value = ((predicted + diff) & ((1i32 << self.precision) - 1)) as u16;
                    output[(row * w + col) * nc + c] = value << pt;
                }
            }
        }
        if reader.overrun > MAX_OVERRUN {
            return Err("Lossless JPEG data ends early".into());
        }

        Ok(output)
    }

    fn parse_markers(&mut self) -> Result<(), String> {
        self.pos = 0;

        loop {
            if self.pos >= self.data.len() { break; }

            if self.data[self.pos] != 0xFF {
                self.pos += 1;
                continue;
            }

            self.pos += 1;
            if self.pos >= self.data.len() { break; }

            let marker = self.data[self.pos];
            self.pos += 1;

            match marker {
                0xD8 => {} // SOI
                0xC3 => self.parse_sof3()?,
                0xC4 => self.parse_dht()?,
                0xDA => { self.parse_sos()?; return Ok(()); }
                0xD9 => break, // EOI
                0x00 | 0xFF => {} // padding/fill
                _ => {
                    // Skip unknown marker
                    if self.pos + 2 <= self.data.len() {
                        let len = u16::from_be_bytes([self.data[self.pos], self.data[self.pos + 1]]) as usize;
                        self.pos += len;
                    }
                }
            }
        }

        Ok(())
    }

    /// The marker segment starting at `self.pos` (its length field
    /// included), or an error when it runs past the data.
    fn segment(&self) -> Result<&'a [u8], String> {
        let data: &'a [u8] = self.data;
        let len_bytes = data.get(self.pos..self.pos + 2).ok_or("Lossless JPEG marker runs past the data")?;
        let len = u16::from_be_bytes([len_bytes[0], len_bytes[1]]) as usize;
        if len < 2 {
            return Err("Lossless JPEG marker is too short".into());
        }
        data.get(self.pos..self.pos + len).ok_or_else(|| "Lossless JPEG marker runs past the data".to_string())
    }

    fn parse_sof3(&mut self) -> Result<(), String> {
        let seg = self.segment()?;
        if seg.len() < 8 {
            return Err("Lossless JPEG frame header is too short".into());
        }
        self.precision = seg[2];
        self.height = u16::from_be_bytes([seg[3], seg[4]]) as u32;
        self.width = u16::from_be_bytes([seg[5], seg[6]]) as u32;
        self.components = seg[7];
        self.pos += seg.len();
        Ok(())
    }

    fn parse_dht(&mut self) -> Result<(), String> {
        let seg = self.segment()?;
        let mut at = 2;
        while at < seg.len() {
            let tc_th = seg[at];
            at += 1;
            let table_idx = (tc_th & 0x0F) as usize;
            if table_idx >= 4 { return Err("Invalid Huffman table index".into()); }

            let mut bits = [0u8; 16];
            bits.copy_from_slice(seg.get(at..at + 16).ok_or("Huffman table runs past its marker")?);
            at += 16;

            let total: usize = bits.iter().map(|&b| b as usize).sum();
            let values = seg.get(at..at + total).ok_or("Huffman table runs past its marker")?.to_vec();
            at += total;

            self.huff_tables[table_idx] = Some(HuffTable::from_lengths_and_values(&bits, &values));
        }
        self.pos += seg.len();
        Ok(())
    }

    fn parse_sos(&mut self) -> Result<(), String> {
        let seg = self.segment()?;
        let ns = *seg.get(2).ok_or("Lossless JPEG scan header is too short")? as usize;
        if ns > 4 || seg.len() < 3 + ns * 2 + 3 {
            return Err(format!("Lossless JPEG scan header with {ns} components is not supported"));
        }

        for i in 0..ns {
            let offset = 3 + i * 2;
            let dc_ac = seg[offset + 1];
            let dc_table = (dc_ac >> 4) as usize;
            if dc_table >= 4 { return Err("Invalid Huffman table index".into()); }
            self.comp_huff[i] = dc_table;
        }

        let pred_offset = 3 + ns * 2;
        self.predictor = seg[pred_offset];
        self.point_transform = seg[pred_offset + 2];

        self.pos += seg.len();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(parts: &[&[u8]]) -> Vec<u8> {
        let mut v = vec![0xFF, 0xD8];
        for p in parts {
            v.extend_from_slice(p);
        }
        v
    }

    /// Headers and streams that are damaged or ask for too much are refused
    /// rather than panicking or reading forever. (Real streams are tested
    /// on real files: `tests/dng_develop.rs`, `tests/arw_decode.rs`.)
    #[test]
    fn damaged_streams_are_refused() {
        // SOF3: 16-bit, 2×2, 1 component; DHT: one code of length 1 for
        // category 0; SOS: one component, predictor 1.
        let sof = [0xFF, 0xC3, 0, 11, 16, 0, 2, 0, 2, 1, 1, 0x11, 0];
        let mut dht = vec![0xFF, 0xC4, 0, 20, 0x00, 1];
        dht.extend_from_slice(&[0; 15]);
        dht.push(0);
        let sos = [0xFF, 0xDA, 0, 8, 1, 1, 0x00, 1, 0, 0];
        // Zero bits: every difference is 0, so the image is mid-grey.
        assert_eq!(decode_lossless_jpeg(&stream(&[&sof, &dht, &sos, &[0x00]])).unwrap(), vec![32768; 4]);
        // A 4096×4096 frame with no data after the scan header: cut short,
        // not a hang.
        let mut big = sof;
        big[5..9].copy_from_slice(&[0x10, 0, 0x10, 0]);
        assert!(decode_lossless_jpeg(&stream(&[&big, &dht, &sos])).is_err());
        let mut no_bits = sof;
        no_bits[4] = 0;
        assert!(decode_lossless_jpeg(&stream(&[&no_bits, &dht, &sos, &[0]])).is_err());
        let mut five = sof;
        five[9] = 5;
        assert!(decode_lossless_jpeg(&stream(&[&five, &dht, &sos, &[0]])).is_err());
        assert!(decode_lossless_jpeg(&stream(&[&sof[..6]])).is_err());
        assert!(decode_lossless_jpeg(&stream(&[&sof, &dht[..12]])).is_err());
    }
}
