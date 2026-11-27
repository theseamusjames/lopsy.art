//! Sony ARW decoding on real files: every `.ARW` in `LOPSY_ARW_SAMPLES`
//! decodes, both ways (`arw::read_arw`, baked; `arw::linear::prepare_arw`,
//! for the develop chain), and is compared with the camera's own rendering
//! embedded in the file (its largest preview JPEG) and, when
//! `LOPSY_ARW_SIPS_DIR` holds `<stem>.png` (macOS's own decode, `sips -s
//! format png`, converted to sRGB), with that.
//!
//! What is compared, coarsely, because neither reference is a neutral
//! decode (both add a tone curve, the camera's creative style and lens
//! corrections):
//!
//! - geometry: the decode's size and aspect against the JPEG's, and the
//!   shift (in pixels of 1000-pixel-wide copies, allowing for the references' lens correction as a magnification about the centre) at which the two pictures'
//!   luminance correlates best over their middle, which is 0, 0 when the
//!   crop and orientation are right;
//! - tone: the rank correlation of the cells' luminance on a 48 × 32 grid;
//! - colour: over the cells, the mean hue difference and the ratio of
//!   saturations (in linear rg chromaticity, `r / sum`, `b / sum`), and the
//!   mean cast of the cells the JPEG shows as near-neutral;
//! - defects: for the lossy files the mean difference between neighbouring
//!   pixels of one colour inside Sony's 32-pixel groups and across their
//!   edges (a mis-read block makes the inside rougher), and for the
//!   lossless file the same at tile edges.
//!
//! The numbers are printed; the assertions are loose bounds a wrong decode
//! breaks (a crop off by more than a few pixels, a rotated or mirrored
//! picture, a strong cast, scrambled blocks). Full-size files: run with
//! `--release`. Without `LOPSY_ARW_SAMPLES` the tests note that and pass.
//! With `LOPSY_ARW_REVIEW_DIR`, review images are written there.

use std::path::{Path, PathBuf};

use lopsy_core::arw::{self, linear as arw_linear};
use lopsy_core::dng::linear::{render_binned_linear_for, render_linear_band};
use lopsy_core::dng::tiff::TiffReader;
use lopsy_core::raf::{plan_bands, RafBand};

fn sample_dir() -> Option<PathBuf> {
    std::env::var_os("LOPSY_ARW_SAMPLES").map(PathBuf::from)
}

fn files_with(ext: &[&str]) -> Vec<PathBuf> {
    let Some(dir) = sample_dir() else { return Vec::new() };
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|r| r.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    v.retain(|p| p.extension().is_some_and(|e| ext.iter().any(|x| e.eq_ignore_ascii_case(x))));
    v.sort();
    v
}

fn srgb_decode(e: f32) -> f32 {
    lopsy_core::working_space::srgb_decode(e.clamp(0.0, 1.0))
}

/// An RGB f32 picture in linear light.
struct Picture {
    w: usize,
    h: usize,
    rgb: Vec<f32>,
}

impl Picture {
    fn from_rgba_encoded(w: u32, h: u32, rgba: &[f32]) -> Self {
        let rgb = rgba.chunks_exact(4).flat_map(|p| [srgb_decode(p[0]), srgb_decode(p[1]), srgb_decode(p[2])]).collect();
        Picture { w: w as usize, h: h as usize, rgb }
    }

    fn from_rgb8(w: usize, h: usize, px: &[u8]) -> Self {
        let lut: Vec<f32> = (0..256).map(|i| srgb_decode(i as f32 / 255.0)).collect();
        Picture { w, h, rgb: px.iter().map(|&v| lut[v as usize]).collect() }
    }

    /// Box-resample to `w` wide (aspect kept), each output pixel the mean of
    /// the source pixels whose centres fall in it.
    fn resample(&self, w: usize) -> Picture {
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

    fn lum(&self, x: usize, y: usize) -> f32 {
        let i = (y * self.w + x) * 3;
        0.2126 * self.rgb[i] + 0.7152 * self.rgb[i + 1] + 0.0722 * self.rgb[i + 2]
    }

    /// Mean of each cell of a `cols` × `rows` grid.
    fn grid(&self, cols: usize, rows: usize) -> Vec<[f32; 3]> {
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

    fn write_png(&self, path: &Path) {
        let px: Vec<u8> = self.rgb.iter().map(|&v| (lopsy_core::working_space::srgb_encode(v.clamp(0.0, 1.0)) * 255.0 + 0.5) as u8).collect();
        write_rgb8(path, self.w, self.h, &px);
    }

    fn crop(&self, x0: usize, y0: usize, w: usize, h: usize) -> Picture {
        let mut rgb = Vec::with_capacity(w * h * 3);
        for y in y0..y0 + h {
            rgb.extend_from_slice(&self.rgb[(y * self.w + x0) * 3..(y * self.w + x0 + w) * 3]);
        }
        Picture { w, h, rgb }
    }
}

fn write_rgb8(path: &Path, w: usize, h: usize, px: &[u8]) {
    let file = std::fs::File::create(path).unwrap();
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w as u32, h as u32);
    enc.set_color(png::ColorType::Rgb);
    enc.set_depth(png::BitDepth::Eight);
    enc.write_header().unwrap().write_image_data(px).unwrap();
}

/// The largest JPEG the file embeds (`JPEGInterchangeFormat` in any IFD of
/// IFD0's chain), decoded.
fn embedded_jpeg(data: &[u8]) -> Option<Picture> {
    let reader = TiffReader::new(data).ok()?;
    let mut best: Option<(u32, u32)> = None;
    for i in 0..6 {
        let Ok(ifd) = reader.read_ifd(i) else { break };
        let get = |tag: u16| ifd.iter().find(|e| e.tag == tag).and_then(|e| e.as_u32());
        if let (Some(o), Some(n)) = (get(0x201), get(0x202)) {
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

fn sips_reference(stem: &str) -> Option<Picture> {
    let dir = std::env::var_os("LOPSY_ARW_SIPS_DIR")?;
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
fn best_shift(a: &Picture, b: &Picture, reach: i32) -> ((i32, i32), f64, f64) {
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

fn shift_at(a: &Picture, b: &Picture, reach: i32, zoom: f64) -> ((i32, i32), f64) {
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

fn chroma(v: [f32; 3]) -> [f64; 2] {
    let s = f64::from(v[0] + v[1] + v[2]).max(1e-9);
    [f64::from(v[0]) / s, f64::from(v[2]) / s]
}

struct ColourStats {
    hue_deg: f64,
    saturation_ratio: f64,
    neutral_cast: [f64; 2],
    rank_corr: f64,
    cells: usize,
}

/// Compare `ours` with `reference` cell by cell (both the same grid).
fn compare(ours: &[[f32; 3]], reference: &[[f32; 3]]) -> ColourStats {
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
    }
}

/// Mean |difference| between same-colour neighbours two columns apart,
/// for pairs inside `period`-column blocks and pairs crossing their edges.
fn block_edges(plane: &[f32], w: usize, h: usize, period: usize, phase: usize) -> (f64, f64) {
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

#[test]
fn real_arws_decode_and_match_the_cameras_rendering() {
    let files = files_with(&["arw"]);
    if files.is_empty() {
        println!("No ARW files: set LOPSY_ARW_SAMPLES to a folder of .ARW files. Skipping.");
        return;
    }
    let review = std::env::var_os("LOPSY_ARW_REVIEW_DIR").map(PathBuf::from);
    println!("| file | body | encoding | bits | stored | crop (l,t,w,h) | black (from) | white (from) | WB gains (from) | crop from | matrix | baked ms | shift vs JPEG | corr | hue° JPEG | sat JPEG | hue° sips | sat sips |");
    for path in files {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let stem = name.trim_end_matches(".ARW").trim_end_matches(".arw").to_string();
        let data = std::fs::read(&path).unwrap();
        assert!(arw::is_sony_raw(&data), "{name}");
        let info = arw::read_info(&data).unwrap_or_else(|e| panic!("{name}: {e}"));

        let t0 = std::time::Instant::now();
        let baked = arw::read_arw(&data).unwrap_or_else(|e| panic!("{name}: {e}"));
        let ms = t0.elapsed().as_millis();
        let img = &baked.image;
        assert_eq!((img.width, img.height), info.oriented_size(), "{name}: the baked size is the crop, oriented");
        assert_eq!(img.pixels.len(), (img.width * img.height * 4) as usize);
        assert!(img.pixels.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v)), "{name}: values outside 0..1");

        // The linear path: the plane, the band renders and the binned view.
        let prep = arw_linear::prepare_arw(&data).unwrap();
        let p = &prep.params;
        assert_eq!((p.width, p.height), (info.crop.width, info.crop.height));
        let whole = render_linear_band(&prep.plane, p, RafBand { y0: 0, y1: p.height, src_y0: 0, src_y1: p.height }).unwrap();
        let row_len = p.width as usize;
        let mut banded = vec![f32::NAN; whole.pixels.len()];
        let (ow, _) = p.oriented_size();
        for band in plan_bands(p.height, 4) {
            let px = render_linear_band(&prep.plane[band.src_y0 as usize * row_len..band.src_y1 as usize * row_len], p, band).unwrap();
            for row in 0..px.height {
                let dst = (((px.y + row) * ow + px.x) * 4) as usize;
                let s = (row * px.width * 4) as usize;
                banded[dst..dst + (px.width * 4) as usize].copy_from_slice(&px.pixels[s..s + (px.width * 4) as usize]);
            }
        }
        assert!(whole.pixels.iter().zip(&banded).all(|(a, b)| a.to_bits() == b.to_bits()), "{name}: bands differ from the whole frame");
        let (bw, bh, _) = render_binned_linear_for(&prep.plane, p, 1024).unwrap();
        assert!(bw.max(bh) >= 1024);
        let defaults = arw_linear::develop_defaults(p);
        assert_eq!(defaults.wb_ratio, [1.0; 3]);
        for r in 0..3 {
            let s: f32 = defaults.cam_to_rgb[r * 3..r * 3 + 3].iter().sum();
            assert!((s - 1.0).abs() < 0.02, "{name}: matrix row {r} sums to {s}");
        }

        // Block and tile edges on the plane (crop-relative; the groups and
        // tiles start at the stored mosaic's column 0).
        let (pw, ph) = (p.width as usize, p.height as usize);
        let edges = match info.encoding {
            arw::ArwEncoding::Lossy => Some(block_edges(&prep.plane, pw, ph, 32, info.crop.left as usize)),
            arw::ArwEncoding::Lossless => Some(block_edges(&prep.plane, pw, ph, 512, info.crop.left as usize)),
            arw::ArwEncoding::Uncompressed => None,
        };
        if let Some((inside, across)) = edges {
            println!("  {name}: neighbour differences inside blocks {:.5}, across block edges {:.5}", inside, across);
            assert!(inside < across * 1.15, "{name}: blocks are rougher inside than across their edges");
        }
        drop(prep);
        drop(whole);
        drop(banded);

        let ours = Picture::from_rgba_encoded(img.width, img.height, &img.pixels).resample(2000);
        let jpeg = embedded_jpeg(&data).expect("an embedded JPEG");
        let aspect = |w: usize, h: usize| w as f64 / h as f64;
        println!("  {name}: decoded {}×{}, embedded JPEG {}×{}", img.width, img.height, jpeg.w, jpeg.h);
        assert!((aspect(img.width as usize, img.height as usize) - aspect(jpeg.w, jpeg.h)).abs() < 0.01, "{name}: aspect differs from the camera's JPEG");
        let jpeg2000 = jpeg.resample(2000);
        let (shift, zoom, corr) = best_shift(&ours.resample(1000), &jpeg2000.resample(1000), 4);
        println!("  {name}: vs JPEG: best alignment shift {shift:?} at magnification {zoom:.2}, correlation {corr:.3}");
        // The preview JPEGs of the older bodies are small (1616 × 1080, a
        // slightly different aspect) and processed, so they only show that
        // the picture is the right way round and not far off; sips, at full
        // size, pins the crop.
        assert!(shift.0.abs() <= 1 && shift.1.abs() <= 1 && corr > 0.6, "{name}: best alignment {shift:?} ×{zoom} at {corr}");
        let (gx, gy) = (48, 32);
        let g_ours = ours.grid(gx, gy);
        let vs_jpeg = compare(&g_ours, &jpeg2000.grid(gx, gy));
        println!(
            "  {name}: vs JPEG over {} cells: hue {:.1}°, saturation ratio {:.2}, neutral cast (r, b chromaticity) {:+.4} {:+.4}, luminance rank correlation {:.3}",
            vs_jpeg.cells, vs_jpeg.hue_deg, vs_jpeg.saturation_ratio, vs_jpeg.neutral_cast[0], vs_jpeg.neutral_cast[1], vs_jpeg.rank_corr
        );
        assert!(vs_jpeg.neutral_cast[0].abs() < 0.03 && vs_jpeg.neutral_cast[1].abs() < 0.03, "{name}: a colour cast against the camera's JPEG");
        assert!(vs_jpeg.hue_deg < 25.0 && vs_jpeg.rank_corr > 0.9, "{name}: colour or tone far from the camera's JPEG");
        let sips = sips_reference(&stem).map(|s| s.resample(2000));
        let vs_sips = sips.as_ref().map(|s| {
            let (sh, z, c) = best_shift(&ours.resample(1000), &s.resample(1000), 4);
            assert!(sh == (0, 0) && c > 0.9, "{name}: best alignment with sips {sh:?} ×{z} at {c}");
            let st = compare(&g_ours, &s.grid(gx, gy));
            assert!(st.neutral_cast[0].abs() < 0.03 && st.neutral_cast[1].abs() < 0.03 && st.hue_deg < 25.0, "{name}: colour far from sips");
            println!(
                "  {name}: vs sips: best shift {sh:?} at magnification {z:.2} (corr {c:.3}); hue {:.1}°, saturation ratio {:.2}, neutral cast {:+.4} {:+.4}, luminance rank correlation {:.3}",
                st.hue_deg, st.saturation_ratio, st.neutral_cast[0], st.neutral_cast[1], st.rank_corr
            );
            st
        });

        let s = &info.sources;
        println!(
            "| {name} | {} | {:?} | {} | {}×{} | {},{},{},{} | {:?} ({}) | {} ({}) | {:.3?} ({}) | {} | {} | {ms} | {shift:?} | {corr:.3} | {:.1} | {:.2} | {} | {} |",
            info.camera_model, info.encoding, info.bits, info.width, info.height, info.crop.left, info.crop.top, info.crop.width, info.crop.height,
            info.black, s.black, info.white, s.white, info.as_shot_gain, s.white_balance, s.crop, s.matrix,
            vs_jpeg.hue_deg, vs_jpeg.saturation_ratio,
            vs_sips.as_ref().map_or("-".into(), |v| format!("{:.1}", v.hue_deg)),
            vs_sips.as_ref().map_or("-".into(), |v| format!("{:.2}", v.saturation_ratio)),
        );

        if let Some(dir) = &review {
            ours.write_png(&dir.join(format!("{stem}-lopsy.png")));
            jpeg2000.write_png(&dir.join(format!("{stem}-embedded-jpeg.png")));
            if let Some(s) = &sips {
                s.write_png(&dir.join(format!("{stem}-sips.png")));
            }
            // A 100 % crop of the middle, from the full-size decode, and the
            // same region of the JPEG when it is full size.
            let full = Picture::from_rgba_encoded(img.width, img.height, &img.pixels);
            let (cw, ch) = (800.min(full.w), 600.min(full.h));
            let (x0, y0) = ((full.w - cw) / 2, (full.h - ch) / 2);
            full.crop(x0, y0, cw, ch).write_png(&dir.join(format!("{stem}-lopsy-100pct.png")));
            if jpeg.w == full.w && jpeg.h == full.h {
                jpeg.crop(x0, y0, cw, ch).write_png(&dir.join(format!("{stem}-embedded-jpeg-100pct.png")));
            }
            if let Some(s) = sips_reference(&stem).filter(|s| s.w == full.w && s.h == full.h) {
                s.crop(x0, y0, cw, ch).write_png(&dir.join(format!("{stem}-sips-100pct.png")));
            }
        }
    }
}

/// The colour data's provenance on the first sample: the SR2 block's black
/// level and white balance are exactly those the raw IFD stores in the
/// clear (evidence that the block was deciphered right).
#[test]
fn the_sr2_block_agrees_with_the_raw_ifd() {
    for path in files_with(&["arw"]) {
        let data = std::fs::read(&path).unwrap();
        let info = arw::read_info(&data).unwrap();
        let reader = TiffReader::new(&data).unwrap();
        let ifd0 = reader.read_ifd(0).unwrap();
        let sr2 = arw::sr2::read_sr2(&data, &ifd0).unwrap().expect("an SR2 block");
        assert!(sr2.len() > 100, "{}: {} SR2 entries", path.display(), sr2.len());
        let in_raw = |tag| arw::sr2::values_i32(&info.raw_ifd, tag);
        for tag in [0x7310u16, 0x7313] {
            if let Some(raw) = in_raw(tag) {
                assert_eq!(arw::sr2::values_i32(&sr2, tag), Some(raw), "{}: tag {tag:#x}", path.display());
            }
        }
    }
}

/// Sony's two older formats are refused with a sentence, not decoded.
#[test]
fn older_sony_formats_are_refused() {
    for path in files_with(&["sr2", "srf"]) {
        let data = std::fs::read(&path).unwrap();
        let e = arw::read_arw(&data).err().unwrap_or_else(|| panic!("{} decoded", path.display()));
        let ext = path.extension().unwrap().to_string_lossy().to_uppercase();
        assert_eq!(e, format!("This older Sony RAW format ({ext}) is not supported"), "{}", path.display());
    }
}

/// The bytes are untrusted: cut short at many lengths and with bytes
/// changed in the headers and anywhere, every sample (the older formats
/// too) is refused or decoded, never a panic.
#[test]
fn damaged_sony_raws_are_refused_not_panicked_on() {
    assert!(arw::read_arw(b"not a raw").is_err());
    assert!(arw::read_arw(&[]).is_err());
    let files = files_with(&["arw", "sr2", "srf"]);
    if files.is_empty() {
        println!("No Sony samples: set LOPSY_ARW_SAMPLES. Skipping the damaged-file cases.");
        return;
    }
    for path in files {
        let data = std::fs::read(&path).unwrap();
        for cut in [8usize, 64, 512, 4096, 65_536, 200_000, data.len() / 3, data.len() * 2 / 3] {
            let r = arw::linear::prepare_arw(&data[..cut.min(data.len())]);
            assert!(r.is_err(), "{}: a file cut at {cut} bytes decoded", path.display());
        }
        // The last bytes of a file may be padding after the sensor data:
        // cutting them may leave a whole picture, but must not panic.
        let _ = arw::linear::prepare_arw(&data[..data.len() - 1]);
        let mut seed = 0x9e37_79b9_7f4a_7c15u64;
        let mut refused = 0;
        let tries = 16;
        for i in 0..tries {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            let mut damaged = data.clone();
            // Half in the headers and Sony's private block, half anywhere.
            let at = (seed % if i % 2 == 0 { 300_000.min(data.len() as u64) } else { data.len() as u64 }) as usize;
            damaged[at] ^= (seed >> 32) as u8 | 1;
            if arw::linear::prepare_arw(&damaged).is_err() {
                refused += 1;
            }
        }
        println!("{}: {refused} of {tries} single-byte changes refused, the rest decoded", path.display());
    }
}
