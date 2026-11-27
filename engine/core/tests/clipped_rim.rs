//! The edge of a large clipped region, at full size, at the opening
//! exposure and one and two stops under it: how the clipped-highlight
//! handling (`dng::linear::neutral_clipped`) meets the unclipped picture
//! around a blown area. Reads `LOPSY_ARW_SAMPLES`, `LOPSY_DNG_ADOBE_SAMPLES`
//! and `LOPSY_RAF_SAMPLES` (RAF: the clip's rendered level only); `--release`.
//!
//! For each file it prints the rendered level of a neutral at exactly the
//! lowest clip level at the opening exposure (encoded sRGB, 0..1), and, for
//! the DNG and ARW files, the largest difference of rendered luminance
//! (encoded, 0..1) between neighbouring pixels across the edge of the
//! largest clipped region (pixels whose least clipped channel is at least
//! 85 % of its clip, and their neighbours), at 0, −1 and −2 EV. With
//! `LOPSY_HIGHLIGHTS_DIR`, a 100 % crop of that edge at the three
//! exposures is written there as `<stem>-rim-<tag>.png` (`<tag>` from
//! `LOPSY_HIGHLIGHTS_TAG`), and, when a `-rim-before.png` is there, a sheet
//! `<stem>-rim.jpg`: before above, this run below.

use std::path::{Path, PathBuf};

use lopsy_core::output::{output_reference, OutputSettings, OutputTarget};
use lopsy_core::raf::develop::{scene_reference, tone_settings, RawDevelopSettings};
use lopsy_core::raf::RafBand;
use lopsy_core::raw::{self, Prepared, PreparedRaw};
use lopsy_core::working_space::Gamut;

#[path = "support/raw_compare.rs"]
mod raw_compare;
#[path = "support/sheet.rs"]
mod sheet;
use raw_compare::Picture;

const CROP: usize = 360;

fn files() -> Vec<PathBuf> {
    let mut v = Vec::new();
    for (var, ext) in [("LOPSY_ARW_SAMPLES", "arw"), ("LOPSY_DNG_ADOBE_SAMPLES", "dng"), ("LOPSY_RAF_SAMPLES", "raf")] {
        let Some(dir) = std::env::var_os(var) else { continue };
        let mut f: Vec<PathBuf> = std::fs::read_dir(dir).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default();
        f.retain(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext)));
        f.sort();
        v.extend(f);
    }
    v
}

fn develop(rgba: &[f32], w: u32, h: u32, s: &RawDevelopSettings) -> Vec<f32> {
    let scene = scene_reference(rgba, s);
    let toned = lopsy_core::scene_tone::scene_tone_reference(&scene, w as usize, h as usize, &Default::default(), &[], &[]);
    let rendered = lopsy_core::tone::tone_reference(&toned, &tone_settings(s));
    output_reference(&rendered, w, &OutputSettings::sdr(OutputTarget::Srgb, Gamut::Rec2020, false))
}

fn luma(p: &[f32]) -> f32 {
    0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]
}

/// The whole frame at full size, linear camera RGBA, oriented.
fn full(prep: &PreparedRaw) -> Option<(u32, u32, Vec<f32>)> {
    let px = match &prep.prepared {
        Prepared::Dng(p) => lopsy_core::dng::linear::render_linear_band(&p.plane, &p.params, RafBand { y0: 0, y1: p.params.height, src_y0: 0, src_y1: p.params.height }),
        Prepared::Arw(p) => lopsy_core::dng::linear::render_linear_band(&p.plane, &p.params, RafBand { y0: 0, y1: p.params.height, src_y0: 0, src_y1: p.params.height }),
        Prepared::Cr2(p) => lopsy_core::dng::linear::render_linear_band(&p.plane, &p.params, RafBand { y0: 0, y1: p.params.height, src_y0: 0, src_y1: p.params.height }),
        Prepared::Raf(_) => return None,
    }
    .ok()?;
    Some((px.width, px.height, px.pixels))
}

/// The least clipped channel's value/clip ratio of each pixel.
fn least_ratio(rgba: &[f32], clip: [f32; 3]) -> Vec<f32> {
    rgba.chunks_exact(4).map(|p| (0..3).map(|c| p[c] / clip[c]).fold(f32::INFINITY, f32::min)).collect()
}

/// The largest 4-connected region of `mask` (on a grid `step` pixels
/// apart), as a point on its left edge at its middle row, in full-size
/// pixels.
fn largest_region_edge(ratio: &[f32], w: usize, h: usize, step: usize) -> Option<(usize, usize, usize)> {
    let (gw, gh) = (w / step, h / step);
    let at = |x: usize, y: usize| ratio[(y * step) * w + x * step] >= 0.95;
    let mut seen = vec![false; gw * gh];
    let mut best: Option<(usize, Vec<(usize, usize)>)> = None;
    for sy in 0..gh {
        for sx in 0..gw {
            if seen[sy * gw + sx] || !at(sx, sy) {
                continue;
            }
            let mut stack = vec![(sx, sy)];
            let mut cells = Vec::new();
            seen[sy * gw + sx] = true;
            while let Some((x, y)) = stack.pop() {
                cells.push((x, y));
                let n = [(x.wrapping_sub(1), y), (x + 1, y), (x, y.wrapping_sub(1)), (x, y + 1)];
                for (nx, ny) in n {
                    if nx < gw && ny < gh && !seen[ny * gw + nx] && at(nx, ny) {
                        seen[ny * gw + nx] = true;
                        stack.push((nx, ny));
                    }
                }
            }
            if best.as_ref().is_none_or(|b| cells.len() > b.0) {
                best = Some((cells.len(), cells));
            }
        }
    }
    let (size, cells) = best?;
    let (y_min, y_max) = cells.iter().fold((usize::MAX, 0), |(a, b), c| (a.min(c.1), b.max(c.1)));
    let mid = (y_min + y_max) / 2;
    let x = cells.iter().filter(|c| c.1 == mid).map(|c| c.0).min()?;
    Some((x * step, mid * step, size * step * step))
}

#[test]
fn the_edge_of_a_blown_area() {
    let files = files();
    if files.is_empty() {
        println!("No samples: skipping.");
        return;
    }
    let out = std::env::var_os("LOPSY_HIGHLIGHTS_DIR").map(PathBuf::from).filter(|p| p.is_dir());
    let tag = std::env::var("LOPSY_HIGHLIGHTS_TAG").unwrap_or_else(|_| "now".into());
    println!("| File | clip levels | lowest clip, rendered at opening | region px (approx) | max step 0 EV | −1 EV | −2 EV |");
    println!("|---|---|---|---|---|---|---|");
    for path in files {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let data = std::fs::read(&path).unwrap();
        let Ok(prep) = raw::prepare(&data) else { continue };
        let Some(clip) = prep.description.clip_levels else { continue };
        let d = prep.description.develop_defaults.clone();
        let lowest = clip.iter().copied().fold(f32::INFINITY, f32::min);
        let level = develop(&[lowest, lowest, lowest, 1.0], 1, 1, &d)[1];
        let Some((w, h, rgba)) = full(&prep) else {
            println!("| {name} | {clip:.3?} | {level:.3} | – | – | – | – |");
            continue;
        };
        let ratio = least_ratio(&rgba, clip);
        let Some((ex, ey, size)) = largest_region_edge(&ratio, w as usize, h as usize, 4) else {
            println!("| {name} | {clip:.3?} | {level:.3} | none | – | – | – |");
            continue;
        };
        // A crop centred on the region's left edge; where a run before this
        // one recorded its crop (`<stem>-rim-at.txt`), the same crop, so the
        // two compare pixel for pixel.
        let (cw, ch) = (CROP.min(w as usize), CROP.min(h as usize));
        let stem = name.rsplit_once('.').map_or(name.clone(), |(s, _)| s.to_string());
        let at_file = out.as_ref().map(|d| d.join(format!("{stem}-rim-at.txt")));
        let recorded = at_file.as_ref().and_then(|f| std::fs::read_to_string(f).ok()).and_then(|t| {
            let v: Vec<usize> = t.split_whitespace().filter_map(|x| x.parse().ok()).collect();
            (v.len() == 2).then(|| (v[0], v[1]))
        });
        let (x0, y0) = recorded.unwrap_or((ex.saturating_sub(cw / 2).min(w as usize - cw), ey.saturating_sub(ch / 2).min(h as usize - ch)));
        if let (Some(f), None) = (&at_file, recorded) {
            std::fs::write(f, format!("{x0} {y0}")).unwrap();
        }
        let mut crop = Vec::with_capacity(cw * ch * 4);
        let mut near = Vec::with_capacity(cw * ch);
        for y in y0..y0 + ch {
            crop.extend_from_slice(&rgba[(y * w as usize + x0) * 4..(y * w as usize + x0 + cw) * 4]);
            near.extend(ratio[y * w as usize + x0..y * w as usize + x0 + cw].iter().map(|&r| r >= 0.85));
        }
        let mut steps = Vec::new();
        let mut pictures = Vec::new();
        for ev in [0.0f32, -1.0, -2.0] {
            let s = RawDevelopSettings { exposure_ev: d.exposure_ev + ev, ..d.clone() };
            let o = develop(&crop, cw as u32, ch as u32, &s);
            let l: Vec<f32> = o.chunks_exact(4).map(luma).collect();
            let mut worst = 0f32;
            for y in 0..ch {
                for x in 0..cw {
                    let i = y * cw + x;
                    for j in [(x + 1 < cw).then(|| i + 1), (y + 1 < ch).then(|| i + cw)].into_iter().flatten() {
                        if near[i] || near[j] {
                            worst = worst.max((l[i] - l[j]).abs());
                        }
                    }
                }
            }
            steps.push(worst);
            pictures.push(Picture::from_rgba_encoded(cw as u32, ch as u32, &o));
        }
        println!("| {name} | {clip:.3?} | {level:.3} | {size} | {:.3} | {:.3} | {:.3} |", steps[0], steps[1], steps[2]);
        if let Some(dir) = &out {
            let row = side_by_side(&pictures);
            row.write_png(&dir.join(format!("{stem}-rim-{tag}.png")));
            if tag != "before" {
                if let Some(before) = read_png(&dir.join(format!("{stem}-rim-before.png"))) {
                    sheet_of(&dir.join(format!("{stem}-rim.jpg")), &format!("{name}: 100 % at the edge of the largest blown area, 0 / -1 / -2 EV. Top: before. Bottom: {tag}"), &before, &row);
                }
            }
        }
    }
}

fn side_by_side(p: &[Picture]) -> Picture {
    let gap = 8;
    let w = p.iter().map(|q| q.w).sum::<usize>() + gap * (p.len() - 1);
    let h = p[0].h;
    let mut rgb = vec![0.02f32; w * h * 3];
    let mut x0 = 0;
    for q in p {
        for y in 0..q.h {
            rgb[(y * w + x0) * 3..(y * w + x0 + q.w) * 3].copy_from_slice(&q.rgb[y * q.w * 3..(y + 1) * q.w * 3]);
        }
        x0 += q.w + gap;
    }
    Picture { w, h, rgb }
}

fn read_png(path: &Path) -> Option<Picture> {
    let decoder = png::Decoder::new(std::fs::File::open(path).ok()?);
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).ok()?;
    (info.color_type == png::ColorType::Rgb && info.bit_depth == png::BitDepth::Eight).then(|| Picture::from_rgb8(info.width as usize, info.height as usize, &buf[..info.buffer_size()]))
}

fn sheet_of(path: &Path, title: &str, before: &Picture, after: &Picture) {
    const GAP: usize = 12;
    let top = GAP + 18 + GAP;
    let w = before.w.max(after.w) + 2 * GAP;
    let h = top + before.h + GAP + after.h + GAP;
    let mut s = sheet::Sheet::new(w.max(1200), h, 24);
    s.text(GAP, GAP, title, 2, [235, 235, 235]);
    s.picture(GAP, top, before);
    s.picture(GAP, top + before.h + GAP, after);
    s.write_jpeg(path);
}
