//! A whole picture assembled from tiles, for the encoders that take whole
//! pictures (`lopsy_core::export::encode_png_16`, `lopsy_core::tiff`,
//! `lopsy_core::hdr_png`, `lopsy_core::gain_map`). Each tile's export is
//! read and its kept part written into the engine's assembly, so the pixels
//! never leave the module between the read and the encoder, and the
//! encoders run on the assembled picture unchanged. A gain map's minimum and
//! maximum then come from the whole picture, as they do for a whole render.

use lopsy_core::geometry::Rect;
use lopsy_core::output::OutputTarget;
use lopsy_core::tile::Assembly;

use crate::document::compositor;
use crate::engine::EngineInner;
use crate::gpu::read::Read;
use crate::task::Cx;

/// What a picture is assembled from.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum AssemblyKind {
    /// The 16-bit export (`exportPng16`'s and `exportTiff16`'s read), in a
    /// file's colour space: its code, 0 sRGB, 1 Display P3, 2 Rec. 2020.
    Sixteen(u8),
    /// The HDR picture (`readHdrOutputF32`'s), linear Rec. 2020 up to a peak.
    Hdr(f32),
    /// The 8-bit sRGB export (`compositeForExport`'s), a gain map's SDR picture.
    Eight,
}

impl AssemblyKind {
    /// The kind from its code: 0 sixteen-bit (`value` the file's colour space
    /// code), 1 HDR (`value` the peak), 2 eight-bit sRGB.
    pub fn from_code(kind: u8, value: f32) -> Result<Self, String> {
        match kind {
            0 if (0.0..=2.0).contains(&value) && value.fract() == 0.0 => Ok(AssemblyKind::Sixteen(value as u8)),
            1 if value.is_finite() && value > 0.0 => Ok(AssemblyKind::Hdr(value)),
            2 => Ok(AssemblyKind::Eight),
            _ => Err(format!("{kind} is not a kind of picture to assemble")),
        }
    }
}

/// The pictures being assembled, at most one of each element type.
#[derive(Default)]
pub struct ExportAssembly {
    sixteen: Option<(u8, Assembly<u16>)>,
    hdr: Option<(f32, Assembly<f32>)>,
    eight: Option<Assembly<u8>>,
}

impl ExportAssembly {
    fn size_of(&self, kind: AssemblyKind) -> Option<(u32, u32)> {
        match kind {
            AssemblyKind::Sixteen(space) => self.sixteen.as_ref().filter(|(s, _)| *s == space).map(|(_, a)| (a.width, a.height)),
            AssemblyKind::Hdr(peak) => self.hdr.as_ref().filter(|(p, _)| p.to_bits() == peak.to_bits()).map(|(_, a)| (a.width, a.height)),
            AssemblyKind::Eight => self.eight.as_ref().map(|a| (a.width, a.height)),
        }
    }
}

/// Starts assembling a `width`×`height` picture of `kind`, replacing any
/// picture of its element type. Fails, holding nothing of that type, when
/// the memory cannot be had.
pub fn begin(engine: &mut EngineInner, kind: AssemblyKind, width: u32, height: u32) -> Result<(), String> {
    let assembly = &mut engine.export_assembly;
    match kind {
        AssemblyKind::Sixteen(space) => {
            assembly.sixteen = None;
            assembly.sixteen = Some((space, Assembly::new(width, height)?));
        }
        AssemblyKind::Hdr(peak) => {
            assembly.hdr = None;
            assembly.hdr = Some((peak, Assembly::new(width, height)?));
        }
        AssemblyKind::Eight => {
            assembly.eight = None;
            assembly.eight = Some(Assembly::new(width, height)?);
        }
    }
    Ok(())
}

/// Frees every picture being assembled.
pub fn clear(engine: &mut EngineInner) {
    engine.export_assembly = ExportAssembly::default();
}

/// The pixels a read of `kind` gives, as one type.
enum Pixels {
    Sixteen(Vec<u16>),
    Hdr(Vec<f32>),
    Eight(Vec<u8>),
}

/// Reads `kind`'s export of the document (a tile) at `kept`, in whole-picture
/// pixels, and writes it into the assembly there. `kept` must lie in the
/// document as its region places it and in the picture being assembled.
pub async fn assemble_tile(cx: Cx, kind: AssemblyKind, kept: Rect) -> Result<(), String> {
    let read = cx.with(|engine| start_read(engine, kind, kept))?;
    let pixels = read.await?;
    cx.with(|engine| {
        let assembly = &mut engine.export_assembly;
        match (kind, pixels) {
            (AssemblyKind::Sixteen(_), Pixels::Sixteen(p)) => assembly.sixteen.as_mut().map(|(_, a)| a.write(kept, &p)),
            (AssemblyKind::Hdr(_), Pixels::Hdr(p)) => assembly.hdr.as_mut().map(|(_, a)| a.write(kept, &p)),
            (AssemblyKind::Eight, Pixels::Eight(p)) => assembly.eight.as_mut().map(|a| a.write(kept, &p)),
            _ => None,
        }
        .unwrap_or_else(|| Err("The picture being assembled was cleared during the read".to_string()))
    })
}

fn start_read(engine: &mut EngineInner, kind: AssemblyKind, kept: Rect) -> Result<Read<Pixels>, String> {
    let (whole_width, whole_height) = engine.export_assembly.size_of(kind).ok_or("No picture of that kind is being assembled")?;
    let (origin_x, origin_y, region_whole) = engine
        .document_region
        .map_or((0, 0, (engine.doc_width, engine.doc_height)), |r| (r.x, r.y, (r.whole_width, r.whole_height)));
    if region_whole != (whole_width, whole_height) {
        return Err(format!(
            "The document is a part of a {}×{} picture, not of the {whole_width}×{whole_height} one being assembled",
            region_whole.0, region_whole.1
        ));
    }
    let local = Rect::new(kept.x - origin_x as i32, kept.y - origin_y as i32, kept.width, kept.height);
    let inside = local.x >= 0
        && local.y >= 0
        && local.width > 0
        && local.height > 0
        && local.x as u64 + u64::from(local.width) <= u64::from(engine.doc_width)
        && local.y as u64 + u64::from(local.height) <= u64::from(engine.doc_height);
    if !inside {
        return Err(format!("The kept part at ({}, {}) is not in the document", kept.x, kept.y));
    }
    Ok(match kind {
        AssemblyKind::Sixteen(space) => {
            let target = OutputTarget::from_code(space)?;
            compositor::composite_for_export_u16_rect(engine, target, local).map(Pixels::Sixteen)
        }
        AssemblyKind::Hdr(peak) => compositor::composite_for_export_hdr_f32_rect(engine, peak, local).map(Pixels::Hdr),
        AssemblyKind::Eight => compositor::composite_for_export_rect(engine, local).map(Pixels::Eight),
    })
}

/// What an assembled picture is encoded as.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssembledFile {
    /// `exportPng16`'s file, from the 16-bit picture.
    Png16,
    /// `exportTiff16`'s file, from the 16-bit picture.
    Tiff16,
    /// `encodePqPng`'s file, from the HDR picture.
    PqPng,
}

/// Encodes an assembled picture as `file`, freeing it. `sdr_white_nits` is
/// the PQ PNG's (`encodePqPng`'s) and ignored otherwise. Fails when that
/// picture is not being assembled or a part of it is missing.
pub fn encode(engine: &mut EngineInner, file: AssembledFile, sdr_white_nits: f32) -> Result<Vec<u8>, String> {
    match file {
        AssembledFile::Png16 | AssembledFile::Tiff16 => {
            let (code, assembly) = engine.export_assembly.sixteen.take().ok_or("No 16-bit picture is being assembled")?;
            let (w, h) = (assembly.width, assembly.height);
            let pixels = assembly.into_pixels()?;
            // As `compositor::export_png_16` tags its file.
            let space = match code {
                1 => lopsy_core::color::ColorSpace::DisplayP3,
                2 => lopsy_core::color::ColorSpace::Rec2020,
                _ => lopsy_core::color::ColorSpace::Srgb,
            };
            if file == AssembledFile::Png16 {
                lopsy_core::export::encode_png_16(&pixels, w, h, space)
            } else {
                lopsy_core::tiff::encode_tiff_16(&pixels, w, h, space)
            }
        }
        AssembledFile::PqPng => {
            let (_, assembly) = engine.export_assembly.hdr.take().ok_or("No HDR picture is being assembled")?;
            let (w, h) = (assembly.width, assembly.height);
            let pixels = assembly.into_pixels()?;
            lopsy_core::hdr_png::encode_pq_png(&pixels, w, h, sdr_white_nits)
        }
    }
}

/// The gain map of the assembled HDR picture over the assembled 8-bit one
/// (`lopsy_core::gain_map::compute_gain_map`), freeing both.
pub fn gain_map(
    engine: &mut EngineInner,
    sdr_space: lopsy_core::color::ColorSpace,
    scale: lopsy_core::gain_map::GainMapScale,
) -> Result<lopsy_core::gain_map::GainMap, String> {
    let (_, hdr) = engine.export_assembly.hdr.take().ok_or("No HDR picture is being assembled")?;
    let sdr = engine.export_assembly.eight.take().ok_or("No 8-bit picture is being assembled")?;
    if (hdr.width, hdr.height) != (sdr.width, sdr.height) {
        return Err("The HDR and 8-bit pictures are not the same size".to_string());
    }
    let (w, h) = (hdr.width, hdr.height);
    let hdr = hdr.into_pixels()?;
    let sdr = sdr.into_pixels()?;
    lopsy_core::gain_map::compute_gain_map(&hdr, &sdr, w, h, sdr_space, scale)
}
