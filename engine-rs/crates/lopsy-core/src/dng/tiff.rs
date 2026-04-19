/// Minimal TIFF IFD parser for DNG files.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
#[allow(dead_code)]
pub enum TagId {
    ImageWidth = 256,
    ImageLength = 257,
    BitsPerSample = 258,
    Compression = 259,
    PhotometricInterpretation = 262,
    StripOffsets = 273,
    SamplesPerPixel = 277,
    RowsPerStrip = 278,
    StripByteCounts = 279,
    SubIFDs = 330,
    TileWidth = 322,
    TileLength = 323,
    TileOffsets = 324,
    TileByteCounts = 325,
    CfaPattern = 33422,
    ColorMatrix1 = 50721,
    ColorMatrix2 = 50722,
    AsShotNeutral = 50728,
    BaselineExposure = 50730,
    WhiteLevel = 50717,
    BlackLevel = 50714,
    ForwardMatrix1 = 50964,
    ForwardMatrix2 = 50965,
    ProfileToneCurve = 50940,
    BaselineExposureOffset = 50731,
    CfaRepeatPatternDim = 33421,
}

#[derive(Debug, Clone)]
pub struct IfdEntry {
    pub tag: u16,
    pub typ: u16,
    pub count: u32,
    pub raw_bytes: Vec<u8>,
}

impl IfdEntry {
    pub fn as_u16(&self) -> Option<u16> {
        if self.raw_bytes.len() >= 2 {
            Some(u16::from_ne_bytes([self.raw_bytes[0], self.raw_bytes[1]]))
        } else {
            None
        }
    }

    pub fn as_u32(&self) -> Option<u32> {
        match self.typ {
            3 if self.raw_bytes.len() >= 2 => {
                Some(u16::from_ne_bytes([self.raw_bytes[0], self.raw_bytes[1]]) as u32)
            }
            4 | 13 if self.raw_bytes.len() >= 4 => {
                Some(u32::from_ne_bytes([self.raw_bytes[0], self.raw_bytes[1], self.raw_bytes[2], self.raw_bytes[3]]))
            }
            _ => None,
        }
    }

    pub fn as_u16_vec(&self) -> Option<Vec<u16>> {
        if self.typ != 3 { return None; }
        Some(
            self.raw_bytes.chunks_exact(2)
                .map(|c| u16::from_ne_bytes([c[0], c[1]]))
                .collect()
        )
    }

    pub fn as_u32_vec(&self) -> Option<Vec<u32>> {
        match self.typ {
            3 => Some(
                self.raw_bytes.chunks_exact(2)
                    .map(|c| u16::from_ne_bytes([c[0], c[1]]) as u32)
                    .collect()
            ),
            4 | 13 => Some(
                self.raw_bytes.chunks_exact(4)
                    .map(|c| u32::from_ne_bytes([c[0], c[1], c[2], c[3]]))
                    .collect()
            ),
            _ => None,
        }
    }

    pub fn as_rational_vec(&self) -> Vec<f64> {
        match self.typ {
            // RATIONAL (unsigned)
            5 => self.raw_bytes.chunks_exact(8).map(|c| {
                let num = u32::from_ne_bytes([c[0], c[1], c[2], c[3]]) as f64;
                let den = u32::from_ne_bytes([c[4], c[5], c[6], c[7]]) as f64;
                if den == 0.0 { 0.0 } else { num / den }
            }).collect(),
            // SRATIONAL (signed)
            10 => self.raw_bytes.chunks_exact(8).map(|c| {
                let num = i32::from_ne_bytes([c[0], c[1], c[2], c[3]]) as f64;
                let den = i32::from_ne_bytes([c[4], c[5], c[6], c[7]]) as f64;
                if den == 0.0 { 0.0 } else { num / den }
            }).collect(),
            // FLOAT
            11 => self.raw_bytes.chunks_exact(4).map(|c| {
                f32::from_ne_bytes([c[0], c[1], c[2], c[3]]) as f64
            }).collect(),
            // DOUBLE
            12 => self.raw_bytes.chunks_exact(8).map(|c| {
                f64::from_ne_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]])
            }).collect(),
            _ => Vec::new(),
        }
    }
}

pub struct TiffReader<'a> {
    data: &'a [u8],
    le: bool,
    ifd0_offset: u32,
}

impl<'a> TiffReader<'a> {
    pub fn new(data: &'a [u8]) -> Result<Self, String> {
        if data.len() < 8 {
            return Err("File too small for TIFF header".into());
        }

        let le = match &data[0..2] {
            b"II" => true,
            b"MM" => false,
            _ => return Err("Not a TIFF file (bad byte order)".into()),
        };

        let magic = if le {
            u16::from_le_bytes([data[2], data[3]])
        } else {
            u16::from_be_bytes([data[2], data[3]])
        };

        if magic != 42 {
            return Err(format!("Not a TIFF file (magic = {magic}, expected 42)"));
        }

        let ifd0_offset = if le {
            u32::from_le_bytes([data[4], data[5], data[6], data[7]])
        } else {
            u32::from_be_bytes([data[4], data[5], data[6], data[7]])
        };

        Ok(Self { data, le, ifd0_offset })
    }

    pub fn read_ifd(&self, index: usize) -> Result<Vec<IfdEntry>, String> {
        let mut offset = self.ifd0_offset;
        for _ in 0..index {
            let entries = self.parse_ifd_at(offset)?;
            let count = entries.len() as u32;
            let next_offset_pos = offset as usize + 2 + count as usize * 12;
            if next_offset_pos + 4 > self.data.len() {
                return Err("No more IFDs".into());
            }
            offset = self.read_u32(next_offset_pos);
            if offset == 0 {
                return Err("No more IFDs".into());
            }
        }
        self.parse_ifd_at(offset)
    }

    pub fn read_ifd_at(&self, offset: u32) -> Result<Vec<IfdEntry>, String> {
        self.parse_ifd_at(offset)
    }

    fn parse_ifd_at(&self, offset: u32) -> Result<Vec<IfdEntry>, String> {
        let pos = offset as usize;
        if pos + 2 > self.data.len() {
            return Err("IFD offset out of bounds".into());
        }

        let count = self.read_u16(pos) as usize;
        if pos + 2 + count * 12 > self.data.len() {
            return Err("IFD entries out of bounds".into());
        }

        let mut entries = Vec::with_capacity(count);
        for i in 0..count {
            let entry_pos = pos + 2 + i * 12;
            let tag = self.read_u16(entry_pos);
            let typ = self.read_u16(entry_pos + 2);
            let count = self.read_u32(entry_pos + 4);
            let value_size = type_size(typ) * count as usize;

            let raw_bytes = if value_size <= 4 {
                // Value fits inline in the 4-byte value/offset field
                let mut bytes = self.data[entry_pos + 8..entry_pos + 12].to_vec();
                // For inline values, we need to handle endianness per-value
                if !self.le {
                    swap_endian_inline(&mut bytes, typ, count as usize);
                }
                bytes.truncate(value_size);
                bytes
            } else {
                let data_offset = self.read_u32(entry_pos + 8) as usize;
                if data_offset + value_size > self.data.len() {
                    continue;
                }
                let mut bytes = self.data[data_offset..data_offset + value_size].to_vec();
                if !self.le {
                    swap_endian_inline(&mut bytes, typ, count as usize);
                }
                bytes
            };

            entries.push(IfdEntry { tag, typ, count, raw_bytes });
        }

        Ok(entries)
    }

    fn read_u16(&self, pos: usize) -> u16 {
        if self.le {
            u16::from_le_bytes([self.data[pos], self.data[pos + 1]])
        } else {
            u16::from_be_bytes([self.data[pos], self.data[pos + 1]])
        }
    }

    fn read_u32(&self, pos: usize) -> u32 {
        if self.le {
            u32::from_le_bytes([self.data[pos], self.data[pos + 1], self.data[pos + 2], self.data[pos + 3]])
        } else {
            u32::from_be_bytes([self.data[pos], self.data[pos + 1], self.data[pos + 2], self.data[pos + 3]])
        }
    }
}

fn type_size(typ: u16) -> usize {
    match typ {
        1 | 6 | 7 => 1,   // BYTE, SBYTE, UNDEFINED
        2 => 1,             // ASCII
        3 | 8 => 2,         // SHORT, SSHORT
        4 | 9 | 13 => 4,   // LONG, SLONG, IFD
        5 | 10 => 8,        // RATIONAL, SRATIONAL
        11 => 4,            // FLOAT
        12 => 8,            // DOUBLE
        _ => 1,
    }
}

fn swap_endian_inline(bytes: &mut [u8], typ: u16, count: usize) {
    let elem_size = type_size(typ);
    match elem_size {
        2 => {
            for i in 0..count {
                let off = i * 2;
                if off + 1 < bytes.len() {
                    bytes.swap(off, off + 1);
                }
            }
        }
        4 => {
            for i in 0..count {
                let off = i * 4;
                if off + 3 < bytes.len() {
                    bytes.swap(off, off + 3);
                    bytes.swap(off + 1, off + 2);
                }
            }
        }
        8 => {
            // RATIONAL: two u32s
            if typ == 5 || typ == 10 {
                for i in 0..count {
                    let off = i * 8;
                    if off + 7 < bytes.len() {
                        bytes.swap(off, off + 3);
                        bytes.swap(off + 1, off + 2);
                        bytes.swap(off + 4, off + 7);
                        bytes.swap(off + 5, off + 6);
                    }
                }
            } else {
                // DOUBLE
                for i in 0..count {
                    let off = i * 8;
                    if off + 7 < bytes.len() {
                        bytes.swap(off, off + 7);
                        bytes.swap(off + 1, off + 6);
                        bytes.swap(off + 2, off + 5);
                        bytes.swap(off + 3, off + 4);
                    }
                }
            }
        }
        _ => {}
    }
}
