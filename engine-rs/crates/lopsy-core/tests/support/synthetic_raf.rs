//! Builds an uncompressed Fujifilm RAF in memory so decoder tests and
//! benchmarks can run without the (large, non-redistributable) sample files.
//!
//! The pixel content is deterministic: smooth gradients, hard edges, fine
//! texture and per-pixel noise, laid over the X-Trans pattern at realistic
//! 14-bit levels, so every stage of the pipeline has real work to do.

pub const XTRANS_PATTERN: [u8; 36] = [
    1, 1, 0, 1, 1, 2,
    1, 1, 2, 1, 1, 0,
    2, 0, 1, 0, 2, 1,
    1, 1, 2, 1, 1, 0,
    1, 1, 0, 1, 1, 2,
    0, 2, 1, 2, 0, 1,
];

pub struct SyntheticRaf {
    pub model: &'static str,
    pub raw_w: u32,
    pub raw_h: u32,
    pub crop_top: u16,
    pub crop_left: u16,
    pub out_w: u16,
    pub out_h: u16,
    pub orientation: u16,
}

impl SyntheticRaf {
    pub fn small(out_w: u16, out_h: u16) -> Self {
        Self {
            model: "X-T5",
            raw_w: out_w as u32 + 24,
            raw_h: out_h as u32 + 10,
            crop_top: 5,
            crop_left: 13,
            out_w,
            out_h,
            orientation: 1,
        }
    }

    pub fn build(&self) -> Vec<u8> {
        let pixels = self.pixels();
        let cfa_header = self.cfa_header();
        let cfa_tiff = cfa_tiff(self.raw_w, self.raw_h, &pixels);
        let jpeg = exif_jpeg(self.orientation);

        let jpeg_off = 160u32;
        let cfa_header_off = jpeg_off + jpeg.len() as u32;
        let cfa_data_off = cfa_header_off + cfa_header.len() as u32;

        let mut out = vec![0u8; jpeg_off as usize];
        out[0..16].copy_from_slice(b"FUJIFILMCCD-RAW ");
        let model = self.model.as_bytes();
        out[28..28 + model.len()].copy_from_slice(model);
        put_be_u32(&mut out, 84, jpeg_off);
        put_be_u32(&mut out, 88, jpeg.len() as u32);
        put_be_u32(&mut out, 92, cfa_header_off);
        put_be_u32(&mut out, 96, cfa_header.len() as u32);
        put_be_u32(&mut out, 100, cfa_data_off);
        put_be_u32(&mut out, 104, cfa_tiff.len() as u32);
        out.extend_from_slice(&jpeg);
        out.extend_from_slice(&cfa_header);
        out.extend_from_slice(&cfa_tiff);
        out
    }

    fn cfa_header(&self) -> Vec<u8> {
        let mut h = Vec::new();
        h.extend_from_slice(&3u32.to_be_bytes());
        h.extend_from_slice(&0x0110u16.to_be_bytes());
        h.extend_from_slice(&4u16.to_be_bytes());
        h.extend_from_slice(&self.crop_top.to_be_bytes());
        h.extend_from_slice(&self.crop_left.to_be_bytes());
        h.extend_from_slice(&0x0111u16.to_be_bytes());
        h.extend_from_slice(&4u16.to_be_bytes());
        h.extend_from_slice(&self.out_h.to_be_bytes());
        h.extend_from_slice(&self.out_w.to_be_bytes());
        h.extend_from_slice(&0x0131u16.to_be_bytes());
        h.extend_from_slice(&36u16.to_be_bytes());
        h.extend_from_slice(&XTRANS_PATTERN);
        h
    }

    fn pixels(&self) -> Vec<u16> {
        let (w, h) = (self.raw_w as usize, self.raw_h as usize);
        let mut px = vec![0u16; w * h];
        let mut rng: u32 = 0x1234_5678;
        // Overscan rows above the crop sit exactly at the black level, as on
        // real sensors; the decoder's compression sniffing relies on it.
        for row in 0..h {
            if row < self.crop_top as usize {
                px[row * w..(row + 1) * w].fill(1024);
                continue;
            }
            for col in 0..w {
                rng ^= rng << 13;
                rng ^= rng >> 17;
                rng ^= rng << 5;
                let noise = (rng & 0xFF) as f32 / 255.0 - 0.5;
                let x = col as f32 / w as f32;
                let y = row as f32 / h as f32;
                let r = 0.15 + 0.6 * x;
                let g = 0.2 + 0.5 * y + if (col / 97 + row / 61) % 2 == 0 { 0.1 } else { 0.0 };
                let b = 0.4 - 0.3 * x * y + 0.05 * ((col as f32 * 0.7).sin() * (row as f32 * 0.3).cos());
                let fuji = XTRANS_PATTERN[(row % 6) * 6 + (col % 6)];
                let v = match fuji { 0 => b, 1 => g, _ => r } + noise * 0.02;
                px[row * w + col] = (1024.0 + v.clamp(0.0, 1.2) * 12000.0) as u16;
            }
        }
        px
    }
}

fn put_be_u32(buf: &mut [u8], off: usize, v: u32) {
    buf[off..off + 4].copy_from_slice(&v.to_be_bytes());
}

/// Little-endian TIFF: IFD0 with tag 0xF000 → Fujifilm sub-IFD carrying
/// dimensions, bit depth, strip location, black level and as-shot WB.
fn cfa_tiff(w: u32, h: u32, pixels: &[u16]) -> Vec<u8> {
    let sub_ifd_off = 8 + 2 + 12 + 4;
    let entries: [(u16, u16, u32, u32); 7] = [
        (0xF001, 4, 1, w),
        (0xF002, 4, 1, h),
        (0xF003, 4, 1, 14),
        (0xF007, 4, 1, 0),
        (0xF008, 4, 1, w * h * 2),
        (0xF00A, 4, 1, 1024),
        (0xF00D, 4, 3, 0),
    ];
    let sub_ifd_len = 2 + entries.len() * 12 + 4;
    let wb_off = sub_ifd_off + sub_ifd_len;
    let strip_off = wb_off + 12;

    let mut t = Vec::with_capacity(strip_off + pixels.len() * 2);
    t.extend_from_slice(b"II");
    t.extend_from_slice(&42u16.to_le_bytes());
    t.extend_from_slice(&8u32.to_le_bytes());
    t.extend_from_slice(&1u16.to_le_bytes());
    t.extend_from_slice(&0xF000u16.to_le_bytes());
    t.extend_from_slice(&13u16.to_le_bytes());
    t.extend_from_slice(&1u32.to_le_bytes());
    t.extend_from_slice(&(sub_ifd_off as u32).to_le_bytes());
    t.extend_from_slice(&0u32.to_le_bytes());

    t.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    for (tag, typ, count, value) in entries {
        let value = match tag {
            0xF007 => strip_off as u32,
            0xF00D => wb_off as u32,
            _ => value,
        };
        t.extend_from_slice(&tag.to_le_bytes());
        t.extend_from_slice(&typ.to_le_bytes());
        t.extend_from_slice(&count.to_le_bytes());
        t.extend_from_slice(&value.to_le_bytes());
    }
    t.extend_from_slice(&0u32.to_le_bytes());
    for v in [302u32, 520, 480] {
        t.extend_from_slice(&v.to_le_bytes());
    }
    for &p in pixels {
        t.extend_from_slice(&p.to_le_bytes());
    }
    t
}

/// Minimal JPEG carrying only an APP1 EXIF block with the Orientation tag.
fn exif_jpeg(orientation: u16) -> Vec<u8> {
    let mut tiff = Vec::new();
    tiff.extend_from_slice(b"MM");
    tiff.extend_from_slice(&42u16.to_be_bytes());
    tiff.extend_from_slice(&8u32.to_be_bytes());
    tiff.extend_from_slice(&1u16.to_be_bytes());
    tiff.extend_from_slice(&0x0112u16.to_be_bytes());
    tiff.extend_from_slice(&3u16.to_be_bytes());
    tiff.extend_from_slice(&1u32.to_be_bytes());
    tiff.extend_from_slice(&orientation.to_be_bytes());
    tiff.extend_from_slice(&0u16.to_be_bytes());
    tiff.extend_from_slice(&0u32.to_be_bytes());

    let mut app1 = Vec::new();
    app1.extend_from_slice(b"Exif\0\0");
    app1.extend_from_slice(&tiff);

    let mut j = vec![0xFF, 0xD8, 0xFF, 0xE1];
    j.extend_from_slice(&((app1.len() + 2) as u16).to_be_bytes());
    j.extend_from_slice(&app1);
    j.extend_from_slice(&[0xFF, 0xD9]);
    j
}
