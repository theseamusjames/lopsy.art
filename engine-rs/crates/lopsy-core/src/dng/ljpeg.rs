/// Lossless JPEG decoder (ITU T.81 process 14 / JPEG SOF3).
/// Used by DNG files (especially Apple ProRAW) for raw pixel data compression.

pub fn decode_lossless_jpeg(data: &[u8]) -> Result<Vec<u16>, String> {
    let mut decoder = LjpegDecoder::new(data);
    decoder.decode()
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
}

impl<'a> BitReader<'a> {
    fn new(data: &'a [u8], start: usize) -> Self {
        Self { data, pos: start, bit_buf: 0, bits_left: 0 }
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
        let mut code = 0i32;
        for len in 0..16 {
            code = (code << 1) | ((self.peek(len as u32 + 1) >> (len as u32)) & 1) as i32;

            // Rebuild: read bit by bit
            // Actually, let's do it the standard way
            let _ = code; // Reset approach below
            break;
        }

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

        let mut output = vec![0u16; w * h * nc];
        let mut reader = BitReader::new(self.data, self.pos);

        let half = 1u32 << (self.precision - 1);

        for row in 0..h {
            for col in 0..w {
                for c in 0..nc {
                    let table_idx = self.comp_huff[c];
                    let table = self.huff_tables[table_idx].as_ref()
                        .ok_or_else(|| format!("Missing Huffman table {table_idx}"))?;

                    let category = reader.decode_huffman(table)?;
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

    fn parse_sof3(&mut self) -> Result<(), String> {
        let len = u16::from_be_bytes([self.data[self.pos], self.data[self.pos + 1]]) as usize;
        self.precision = self.data[self.pos + 2];
        self.height = u16::from_be_bytes([self.data[self.pos + 3], self.data[self.pos + 4]]) as u32;
        self.width = u16::from_be_bytes([self.data[self.pos + 5], self.data[self.pos + 6]]) as u32;
        self.components = self.data[self.pos + 7];
        self.pos += len;
        Ok(())
    }

    fn parse_dht(&mut self) -> Result<(), String> {
        let len = u16::from_be_bytes([self.data[self.pos], self.data[self.pos + 1]]) as usize;
        let end = self.pos + len;
        self.pos += 2;

        while self.pos < end {
            let tc_th = self.data[self.pos];
            self.pos += 1;
            let table_idx = (tc_th & 0x0F) as usize;
            if table_idx >= 4 { return Err("Invalid Huffman table index".into()); }

            let mut bits = [0u8; 16];
            bits.copy_from_slice(&self.data[self.pos..self.pos + 16]);
            self.pos += 16;

            let total: usize = bits.iter().map(|&b| b as usize).sum();
            let values = self.data[self.pos..self.pos + total].to_vec();
            self.pos += total;

            self.huff_tables[table_idx] = Some(HuffTable::from_lengths_and_values(&bits, &values));
        }

        Ok(())
    }

    fn parse_sos(&mut self) -> Result<(), String> {
        let len = u16::from_be_bytes([self.data[self.pos], self.data[self.pos + 1]]) as usize;
        let ns = self.data[self.pos + 2] as usize;

        for i in 0..ns {
            let offset = self.pos + 3 + i * 2;
            let _comp_id = self.data[offset];
            let dc_ac = self.data[offset + 1];
            let dc_table = (dc_ac >> 4) as usize;
            self.comp_huff[i] = dc_table;
        }

        let pred_offset = self.pos + 3 + ns * 2;
        self.predictor = self.data[pred_offset];
        self.point_transform = self.data[pred_offset + 2];

        self.pos += len;
        Ok(())
    }
}
