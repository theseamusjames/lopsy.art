//! Helpers the real-file RAW tests share: pictures in linear light, the
//! largest preview a TIFF-based raw embeds, macOS's rendering when one was
//! made, and the coarse comparisons (alignment, colour, tone, block edges).
#![allow(dead_code)]

use std::path::Path;

use lopsy_core::dng::tiff::TiffReader;

pub fn srgb_decode(e: f32) -> f32 {
    lopsy_core::working_space::srgb_decode(e.clamp(0.0, 1.0))
}

/// An RGB f32 picture in linear light.
pub struct Picture {
    pub w: usize,
    pub h: usize,
    pub rgb: Vec<f32>,
}

impl Picture {
    pub fn from_rgba_encoded(w: u32, h: u32, rgba: &[f32]) -> Self {
        let rgb = rgba.chunks_exact(4).flat_map(|p| [srgb_decode(p[0]), srgb_decode(p[1]), srgb_decode(p[2])]).collect();
        Picture { w: w as usize, h: h as usize, rgb }
    }

    pub fn from_rgb8(w: usize, h: usize, px: &[u8]) -> Self {
        let lut: Vec<f32> = (0..256).map(|i| srgb_decode(i as f32 / 255.0)).collect();
        Picture { w, h, rgb: px.iter().map(|&v| lut[v as usize]).collect() }
    }

    /// Box-resample to `w` wide (aspect kept), each output pixel the mean of
    /// the source pixels whose centres fall in it.
    pub fn resample(&self, w: usize) -> Picture {
        let h = ((self.h as f64 * w as f64 / self.w as f64).round() as usize).max(1);
        let mut sum = vec![0f64; w * h * 3];
        let mut n = vec![0f64; w * h];
        for y in 0..self.h {
            let oy = (y * h / self.h).min(h - 1);
            for x in 0..self.w {
                let ox = (x * w / self.w).min(w - 1);
                let o = oy * w + ox;
                for c in 0..3 {
                    sum[o * 3 + c] += f64::from(self.rgb[(y * self.w + x) * 3 + c]);
                }
                n[o] += 1.0;
            }
        }
        let rgb = sum.iter().enumerate().map(|(i, s)| (s / n[i / 3].max(1.0)) as f32).collect();
        Picture { w, h, rgb }
    }

    pub fn lum(&self, x: usize, y: usize) -> f32 {
        let i = (y * self.w + x) * 3;
        0.2126 * self.rgb[i] + 0.7152 * self.rgb[i + 1] + 0.0722 * self.rgb[i + 2]
    }

    /// Mean of each cell of a `cols` × `rows` grid.
    pub fn grid(&self, cols: usize, rows: usize) -> Vec<[f32; 3]> {
        let mut out = vec![[0f32; 3]; cols * rows];
        let mut n = vec![0f32; cols * rows];
        for y in 0..self.h {
            for x in 0..self.w {
                let c = (y * rows / self.h) * cols + x * cols / self.w;
                for k in 0..3 {
                    out[c][k] += self.rgb[(y * self.w + x) * 3 + k];
                }
                n[c] += 1.0;
            }
        }
        out.iter_mut().zip(&n).for_each(|(v, n)| v.iter_mut().for_each(|x| *x /= n));
        out
    }

    pub fn write_png(&self, path: &Path) {
        let px: Vec<u8> = self.rgb.iter().map(|&v| (lopsy_core::working_space::srgb_encode(v.clamp(0.0, 1.0)) * 255.0 + 0.5) as u8).collect();
        write_rgb8(path, self.w, self.h, &px);
    }

    pub fn crop(&self, x0: usize, y0: usize, w: usize, h: usize) -> Picture {
        let mut rgb = Vec::with_capacity(w * h * 3);
        for y in y0..y0 + h {
            rgb.extend_from_slice(&self.rgb[(y * self.w + x0) * 3..(y * self.w + x0 + w) * 3]);
        }
        Picture { w, h, rgb }
    }
}

pub fn write_rgb8(path: &Path, w: usize, h: usize, px: &[u8]) {
    let file = std::fs::File::create(path).unwrap();
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w as u32, h as u32);
    enc.set_color(png::ColorType::Rgb);
    enc.set_depth(png::BitDepth::Eight);
    enc.write_header().unwrap().write_image_data(px).unwrap();
}

/// The largest JPEG the file embeds (`JPEGInterchangeFormat` in any IFD of
/// IFD0's chain), decoded.
pub fn embedded_jpeg(data: &[u8]) -> Option<Picture> {
    let reader = TiffReader::new(data).ok()?;
    let mut best: Option<(u32, u32)> = None;
    let mut ifds = Vec::new();
    for i in 0..6 {
        let Ok(ifd) = reader.read_ifd(i) else { break };
        let subs: Vec<u32> = ifd.iter().find(|e| e.tag == 0x14a).and_then(|e| e.as_u32_vec()).unwrap_or_default();
        ifds.extend(subs.iter().filter_map(|&o| reader.read_ifd_at(o).ok()));
        ifds.push(ifd);
    }
    for ifd in &ifds {
        let get = |tag: u16| ifd.iter().find(|e| e.tag == tag).and_then(|e| e.as_u32());
        let count = |tag: u16| ifd.iter().find(|e| e.tag == tag).map_or(0, |e| e.count);
        // JPEGInterchangeFormat, or a one-strip image whose compression is
        // JPEG (7) and whose pixels are colour (a DNG's previews).
        let found = match (get(0x201), get(0x202)) {
            (Some(o), Some(n)) => Some((o, n)),
            _ if get(0x103) == Some(7) && matches!(get(0x106), Some(2 | 6)) && count(0x111) == 1 => get(0x111).zip(get(0x117)),
            _ => None,
        };
        if let Some((o, n)) = found {
            if best.is_none_or(|b| n > b.1) {
                best = Some((o, n));
            }
        }
    }
    let (o, n) = best?;
    let bytes = data.get(o as usize..(o + n) as usize)?;
    let mut dec = jpeg_decoder::Decoder::new(bytes);
    let px = dec.decode().ok()?;
    let info = dec.info()?;
    (info.pixel_format == jpeg_decoder::PixelFormat::RGB24).then(|| Picture::from_rgb8(info.width as usize, info.height as usize, &px))
}

pub fn sips_reference(env_var: &str, stem: &str) -> Option<Picture> {
    let dir = std::env::var_os(env_var)?;
    let file = std::fs::File::open(Path::new(&dir).join(format!("{stem}.png"))).ok()?;
    let mut r = png::Decoder::new(file).read_info().ok()?;
    let mut buf = vec![0u8; r.output_buffer_size()];
    let info = r.next_frame(&mut buf).ok()?;
    if info.bit_depth != png::BitDepth::Eight {
        return None;
    }
    let ch = match info.color_type {
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        _ => return None,
    };
    let rgb: Vec<u8> = buf[..info.buffer_size()].chunks_exact(ch).flat_map(|p| [p[0], p[1], p[2]]).collect();
    Some(Picture::from_rgb8(info.width as usize, info.height as usize, &rgb))
}

/// The geometric match of `b` (the reference) to `a` (same size): the
/// magnification about the centre (the references correct lens
/// distortion, which enlarges the middle) and the shift (dx, dy) at which
/// their luminance correlates best over the middle 40 % (of 1000-pixel-wide copies), and that
/// correlation.
pub fn best_shift(a: &Picture, b: &Picture, reach: i32) -> ((i32, i32), f64, f64) {
    let mut best = ((0, 0), 1.0, f64::MIN);
    for k in -15..=10 {
        let zoom = 1.0 + 0.01 * f64::from(k);
        let (s, r) = shift_at(a, b, reach, zoom);
        if r > best.2 {
            best = (s, zoom, r);
        }
    }
    best
}

pub fn shift_at(a: &Picture, b: &Picture, reach: i32, zoom: f64) -> ((i32, i32), f64) {
    let (w, h) = (a.w.min(b.w) as i32, a.h.min(b.h) as i32);
    let (cx, cy) = (f64::from(w) / 2.0, f64::from(h) / 2.0);
    // `a` at (x, y) shows what `b` shows at the centre plus (x − centre) · zoom.
    let at_b = |x: i32, y: i32| -> f64 {
        let bx = (cx + (f64::from(x) - cx) * zoom).round() as i32;
        let by = (cy + (f64::from(y) - cy) * zoom).round() as i32;
        f64::from(b.lum(bx.clamp(0, w - 1) as usize, by.clamp(0, h - 1) as usize)).sqrt()
    };
    let mut best = ((0, 0), f64::MIN);
    for dy in -reach..=reach {
        for dx in -reach..=reach {
            let (mut sa, mut sb, mut saa, mut sbb, mut sab, mut n) = (0f64, 0f64, 0f64, 0f64, 0f64, 0f64);
            for y in (3 * h / 10..7 * h / 10).step_by(2) {
                for x in (3 * w / 10..7 * w / 10).step_by(2) {
                    let (va, vb) = (f64::from(a.lum(x as usize, y as usize)).sqrt(), at_b(x + dx, y + dy));
                    sa += va;
                    sb += vb;
                    saa += va * va;
                    sbb += vb * vb;
                    sab += va * vb;
                    n += 1.0;
                }
            }
            let cov = sab / n - sa / n * sb / n;
            let r = cov / ((saa / n - (sa / n).powi(2)).sqrt() * (sbb / n - (sb / n).powi(2)).sqrt());
            if r > best.1 {
                best = ((dx, dy), r);
            }
        }
    }
    best
}

pub fn chroma(v: [f32; 3]) -> [f64; 2] {
    let s = f64::from(v[0] + v[1] + v[2]).max(1e-9);
    [f64::from(v[0]) / s, f64::from(v[2]) / s]
}

pub struct ColourStats {
    pub hue_deg: f64,
    pub saturation_ratio: f64,
    pub neutral_cast: [f64; 2],
    pub rank_corr: f64,
    pub cells: usize,
    /// Cells the reference shows as near-neutral, which `neutral_cast` averages.
    pub neutral_cells: usize,
}

/// Compare `ours` with `reference` cell by cell (both the same grid).
pub fn compare(ours: &[[f32; 3]], reference: &[[f32; 3]]) -> ColourStats {
    let usable: Vec<usize> = (0..ours.len()).filter(|&i| ours[i][1] > 0.005 && reference[i][1] > 0.005 && reference[i].iter().all(|&v| v < 0.97)).collect();
    let third = 1.0 / 3.0;
    let (mut hue, mut so, mut sr, mut nh) = (0f64, 0f64, 0f64, 0f64);
    let (mut cast, mut nn) = ([0f64; 2], 0f64);
    for &i in &usable {
        let (o, r) = (chroma(ours[i]), chroma(reference[i]));
        let (dox, doy, drx, dry) = (o[0] - third, o[1] - third, r[0] - third, r[1] - third);
        let (mo, mr) = (dox.hypot(doy), drx.hypot(dry));
        if mr < 0.02 {
            cast[0] += o[0] - r[0];
            cast[1] += o[1] - r[1];
            nn += 1.0;
        }
        if mr > 0.04 {
            let a = (doy.atan2(dox) - dry.atan2(drx)).to_degrees();
            hue += ((a + 540.0) % 360.0 - 180.0).abs();
            so += mo;
            sr += mr;
            nh += 1.0;
        }
    }
    // Spearman rank correlation of luminance.
    let lum = |c: &[f32; 3]| 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    let rank = |v: Vec<f32>| -> Vec<f64> {
        let mut idx: Vec<usize> = (0..v.len()).collect();
        idx.sort_by(|&a, &b| v[a].total_cmp(&v[b]));
        let mut r = vec![0f64; v.len()];
        for (k, &i) in idx.iter().enumerate() {
            r[i] = k as f64;
        }
        r
    };
    let ra = rank(usable.iter().map(|&i| lum(&ours[i])).collect());
    let rb = rank(usable.iter().map(|&i| lum(&reference[i])).collect());
    let n = ra.len() as f64;
    let d2: f64 = ra.iter().zip(&rb).map(|(a, b)| (a - b).powi(2)).sum();
    ColourStats {
        hue_deg: hue / nh.max(1.0),
        saturation_ratio: so / sr.max(1e-9),
        neutral_cast: [cast[0] / nn.max(1.0), cast[1] / nn.max(1.0)],
        rank_corr: 1.0 - 6.0 * d2 / (n * (n * n - 1.0)),
        cells: usable.len(),
        neutral_cells: nn as usize,
    }
}

/// Mean |difference| between same-colour neighbours two columns apart,
/// for pairs inside `period`-column blocks and pairs crossing their edges.
pub fn block_edges(plane: &[f32], w: usize, h: usize, period: usize, phase: usize) -> (f64, f64) {
    let (mut inside, mut ni, mut across, mut na) = (0f64, 0f64, 0f64, 0f64);
    for y in 0..h {
        for x in 0..w - 2 {
            let d = f64::from((plane[y * w + x] - plane[y * w + x + 2]).abs());
            if (x + phase) % period >= period - 2 {
                across += d;
                na += 1.0;
            } else {
                inside += d;
                ni += 1.0;
            }
        }
    }
    (inside / ni, across / na)
}

/// Brightness as a person sees it, with no exposure matching: the mean and
/// the 10th, 50th and 90th percentiles of sRGB-encoded luminance (0..1).
pub fn brightness(p: &Picture) -> [f32; 4] {
    let mut l: Vec<f32> = (0..p.w * p.h)
        .map(|i| lopsy_core::working_space::srgb_encode((0.2126 * p.rgb[i * 3] + 0.7152 * p.rgb[i * 3 + 1] + 0.0722 * p.rgb[i * 3 + 2]).clamp(0.0, 1.0)))
        .collect();
    let mean = l.iter().sum::<f32>() / l.len() as f32;
    l.sort_by(f32::total_cmp);
    let at = |f: f32| l[((l.len() - 1) as f32 * f) as usize];
    [mean, at(0.1), at(0.5), at(0.9)]
}

