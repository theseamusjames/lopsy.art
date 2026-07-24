use super::blend_keys::psd_key_to_blend_mode;
use super::packbits::packbits_decode;
use super::zip_predict::{zip_predict_decode_16, zip_predict_decode_8};
use super::types::*;

/// Parse a PSD file and return a document descriptor with all layer data.
pub fn read_psd(data: &[u8]) -> Result<PsdDocument, PsdError> {
    let mut cursor = PsdCursor::new(data);

    let header = read_header(&mut cursor)?;
    skip_color_mode_data(&mut cursor)?;
    let icc_profile = read_image_resources(&mut cursor)?;
    let layers = read_layer_and_mask_info(&mut cursor, &header)?;

    // If no layers were found, try to read the merged composite as a single layer
    let layers = if layers.is_empty() {
        let composite = read_merged_composite(&mut cursor, &header)?;
        vec![PsdLayer {
            source_kind: PsdSourceKind::Raster,
            name: "Background".to_string(),
            visible: true,
            opacity: 255,
            blend_mode: crate::color::BlendMode::Normal,
            clip_to_below: false,
            rect: PsdRect::from_xywh(0, 0, header.width, header.height),
            pixel_data: composite,
            mask: None,
            group_kind: GroupKind::Normal,
            effects_json: None,
        }]
    } else {
        layers
    };

    Ok(PsdDocument {
        width: header.width,
        height: header.height,
        depth: header.depth,
        color_mode: header.color_mode,
        layers,
        icc_profile,
    })
}

// ─── Internal types ────────────────────────────────────────────────────

struct PsdHeader {
    width: u32,
    height: u32,
    depth: PsdDepth,
    channels: u16,
    color_mode: PsdColorMode,
}

struct PsdCursor<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> PsdCursor<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn remaining(&self) -> usize {
        self.data.len().saturating_sub(self.pos)
    }

    fn read_bytes(&mut self, n: usize) -> Result<&'a [u8], PsdError> {
        if self.pos + n > self.data.len() {
            return Err(PsdError::TruncatedData);
        }
        let slice = &self.data[self.pos..self.pos + n];
        self.pos += n;
        Ok(slice)
    }

    fn read_u8(&mut self) -> Result<u8, PsdError> {
        let b = self.read_bytes(1)?;
        Ok(b[0])
    }

    fn read_u16(&mut self) -> Result<u16, PsdError> {
        let b = self.read_bytes(2)?;
        Ok(u16::from_be_bytes([b[0], b[1]]))
    }

    fn read_i16(&mut self) -> Result<i16, PsdError> {
        let b = self.read_bytes(2)?;
        Ok(i16::from_be_bytes([b[0], b[1]]))
    }

    fn read_u32(&mut self) -> Result<u32, PsdError> {
        let b = self.read_bytes(4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn read_i32(&mut self) -> Result<i32, PsdError> {
        let b = self.read_bytes(4)?;
        Ok(i32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn skip(&mut self, n: usize) -> Result<(), PsdError> {
        if self.pos + n > self.data.len() {
            return Err(PsdError::TruncatedData);
        }
        self.pos += n;
        Ok(())
    }

    fn position(&self) -> usize {
        self.pos
    }
}

// ─── Section 1: Header ────────────────────────────────────────────────

fn read_header(c: &mut PsdCursor) -> Result<PsdHeader, PsdError> {
    let sig = c.read_bytes(4)?;
    if sig != b"8BPS" {
        return Err(PsdError::InvalidSignature);
    }

    let version = c.read_u16()?;
    if version != 1 {
        return Err(PsdError::UnsupportedVersion(version));
    }

    c.skip(6)?; // reserved

    let channels = c.read_u16()?;
    let height = c.read_u32()?;
    let width = c.read_u32()?;
    let depth_bits = c.read_u16()?;
    let color_mode = c.read_u16()?;

    let color_mode = PsdColorMode::from_u16(color_mode)
        .ok_or(PsdError::UnsupportedColorMode(color_mode))?;

    let depth = match depth_bits {
        8 => PsdDepth::Eight,
        16 => PsdDepth::Sixteen,
        _ => return Err(PsdError::UnsupportedDepth(depth_bits)),
    };

    Ok(PsdHeader { width, height, depth, channels, color_mode })
}

// ─── Section 2: Color Mode Data ────────────────────────────────────────

fn skip_color_mode_data(c: &mut PsdCursor) -> Result<(), PsdError> {
    let len = c.read_u32()? as usize;
    c.skip(len)
}

// ─── Section 3: Image Resources ────────────────────────────────────────

fn read_image_resources(c: &mut PsdCursor) -> Result<Option<Vec<u8>>, PsdError> {
    let section_len = c.read_u32()? as usize;
    let section_end = c.position() + section_len;
    let mut icc_profile = None;

    while c.position() + 12 <= section_end {
        let sig = c.read_bytes(4)?;
        if sig != b"8BIM" {
            break;
        }

        let id = c.read_u16()?;

        // Pascal string name (padded to even)
        let name_len = c.read_u8()? as usize;
        let padded_name_len = if (name_len + 1) % 2 != 0 { name_len + 1 } else { name_len };
        c.skip(padded_name_len)?;

        let data_len = c.read_u32()? as usize;
        let data_start = c.position();

        if id == 1039 && data_len > 0 {
            // ICC profile
            icc_profile = Some(c.read_bytes(data_len)?.to_vec());
        } else {
            c.skip(data_len)?;
        }

        // Pad to even
        let consumed = c.position() - data_start;
        if consumed < data_len {
            c.skip(data_len - consumed)?;
        }
        if data_len % 2 != 0 {
            c.skip(1)?;
        }
    }

    // Ensure we're at section end
    if c.position() < section_end {
        c.skip(section_end - c.position())?;
    }

    Ok(icc_profile)
}

// ─── Section 4: Layer and Mask Information ─────────────────────────────

struct LayerRecord {
    rect: PsdRect,
    channel_info: Vec<ChannelInfo>,
    blend_mode: crate::color::BlendMode,
    opacity: u8,
    visible: bool,
    clip_to_below: bool,
    name: String,
    group_kind: GroupKind,
    mask: Option<MaskRecord>,
    effects_json: Option<String>,
    source_kind: PsdSourceKind,
}

struct ChannelInfo {
    id: i16,
    data_length: u32,
}

struct MaskRecord {
    rect: PsdRect,
    default_color: u8,
}

fn read_layer_and_mask_info(c: &mut PsdCursor, header: &PsdHeader) -> Result<Vec<PsdLayer>, PsdError> {
    let section_len = c.read_u32()? as usize;
    if section_len == 0 {
        return Ok(Vec::new());
    }
    let section_end = c.position() + section_len;

    // First, try the main layer info section
    let mut layers = read_layer_info(c, header)?;

    // For 16-bit/32-bit docs, layers may be in an Lr16/Lr32 block at document level.
    // Scan the remaining section for these blocks.
    if layers.is_empty() && c.position() < section_end {
        // Skip global layer mask info
        let global_mask_len = c.read_u32()? as usize;
        c.skip(global_mask_len)?;

        // Scan additional layer info blocks
        while c.position() + 12 <= section_end {
            let sig = c.read_bytes(4)?;
            if sig != b"8BIM" && sig != b"8B64" {
                break;
            }
            let key = c.read_bytes(4)?;
            let block_len = c.read_u32()? as usize;
            let block_start = c.position();

            if key == b"Lr16" || key == b"Lr32" {
                // Block body is layer count + records + channel data (no length prefix)
                let inner_layers = read_layer_info_body(c, header, block_start + block_len)?;
                if !inner_layers.is_empty() {
                    layers = inner_layers;
                }
            }

            // Skip to end of this block
            let consumed = c.position() - block_start;
            if consumed < block_len {
                c.skip(block_len - consumed)?;
            }
            // Pad to even
            if block_len % 2 != 0 && c.position() < section_end {
                c.skip(1)?;
            }
        }
    }

    // Skip to end of section
    if c.position() < section_end {
        c.skip(section_end - c.position())?;
    }

    Ok(layers)
}

fn read_layer_info(c: &mut PsdCursor, header: &PsdHeader) -> Result<Vec<PsdLayer>, PsdError> {
    let layer_info_len = c.read_u32()? as usize;
    if layer_info_len == 0 {
        return Ok(Vec::new());
    }
    let layer_info_end = c.position() + layer_info_len;
    let layers = read_layer_info_body(c, header, layer_info_end)?;

    // Align to layer_info_end
    if c.position() < layer_info_end {
        c.skip(layer_info_end - c.position())?;
    }

    Ok(layers)
}

/// Read the layer info body (layer count + records + channel data)
/// from a bounded region.
fn read_layer_info_body(c: &mut PsdCursor, header: &PsdHeader, end: usize) -> Result<Vec<PsdLayer>, PsdError> {
    if c.position() >= end {
        return Ok(Vec::new());
    }

    let layer_count_raw = c.read_i16()?;
    let layer_count = layer_count_raw.unsigned_abs() as usize;

    let mut records = Vec::with_capacity(layer_count);
    for _ in 0..layer_count {
        records.push(read_layer_record(c)?);
    }

    let mut layers = Vec::with_capacity(layer_count);
    for record in records {
        let (pixel_data, mask) = read_all_layer_channels(c, &record, header)?;

        layers.push(PsdLayer {
            source_kind: record.source_kind,
            name: record.name,
            visible: record.visible,
            opacity: record.opacity,
            blend_mode: record.blend_mode,
            clip_to_below: record.clip_to_below,
            rect: record.rect,
            pixel_data,
            mask,
            group_kind: record.group_kind,
            effects_json: record.effects_json,
        });
    }

    Ok(layers)
}

fn read_layer_record(c: &mut PsdCursor) -> Result<LayerRecord, PsdError> {
    let top = c.read_i32()?;
    let left = c.read_i32()?;
    let bottom = c.read_i32()?;
    let right = c.read_i32()?;
    let rect = PsdRect::new(top, left, bottom, right);

    let channel_count = c.read_u16()? as usize;
    let mut channel_info = Vec::with_capacity(channel_count);
    for _ in 0..channel_count {
        let id = c.read_i16()?;
        let data_length = c.read_u32()?;
        channel_info.push(ChannelInfo { id, data_length });
    }

    // Blend mode signature + key
    let sig = c.read_bytes(4)?;
    if sig != b"8BIM" {
        return Err(PsdError::InvalidLayerData("bad blend mode signature".into()));
    }
    let key = c.read_bytes(4)?;
    let blend_mode = psd_key_to_blend_mode(key.try_into().unwrap());

    let opacity = c.read_u8()?;
    let clipping = c.read_u8()?;
    let flags = c.read_u8()?;
    c.skip(1)?; // filler

    let visible = (flags & 0x02) == 0;
    let clip_to_below = clipping == 1;

    // Extra data
    let extra_len = c.read_u32()? as usize;
    let extra_end = c.position() + extra_len;

    // Layer mask data
    let mask_data_len = c.read_u32()? as usize;
    let mask = if mask_data_len >= 20 {
        let mask_top = c.read_i32()?;
        let mask_left = c.read_i32()?;
        let mask_bottom = c.read_i32()?;
        let mask_right = c.read_i32()?;
        let default_color = c.read_u8()?;
        let _flags = c.read_u8()?;
        // Skip remaining mask data
        let consumed = 18;
        if mask_data_len > consumed {
            c.skip(mask_data_len - consumed)?;
        }
        Some(MaskRecord {
            rect: PsdRect::new(mask_top, mask_left, mask_bottom, mask_right),
            default_color,
        })
    } else {
        if mask_data_len > 0 {
            c.skip(mask_data_len)?;
        }
        None
    };

    // Layer blending ranges
    let blend_ranges_len = c.read_u32()? as usize;
    c.skip(blend_ranges_len)?;

    // Layer name (Pascal string padded to 4 bytes)
    let name_len = c.read_u8()? as usize;
    let name_bytes = c.read_bytes(name_len)?;
    let name = String::from_utf8_lossy(name_bytes).to_string();
    let total = 1 + name_len;
    let padding = (4 - (total % 4)) % 4;
    c.skip(padding)?;

    // Scan additional layer info for luni, lsct, lyEf
    let mut unicode_name: Option<String> = None;
    let mut group_kind = GroupKind::Normal;
    let mut effects_json: Option<String> = None;
    let mut source_kind = PsdSourceKind::Raster;

    while c.position() + 12 <= extra_end {
        let ali_sig = c.read_bytes(4)?;
        if ali_sig != b"8BIM" && ali_sig != b"8B64" {
            // Not a valid additional layer info block, rewind and stop
            break;
        }
        let ali_key = c.read_bytes(4)?;
        let ali_len = c.read_u32()? as usize;
        let ali_data_start = c.position();

        match ali_key {
            b"luni" => {
                let char_count = c.read_u32()? as usize;
                let utf16_bytes = c.read_bytes(char_count * 2)?;
                let utf16: Vec<u16> = utf16_bytes
                    .chunks_exact(2)
                    .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
                    .collect();
                unicode_name = Some(String::from_utf16_lossy(&utf16));
            }
            b"lsct" | b"lsdk" => {
                let divider_type = c.read_u32()?;
                group_kind = match divider_type {
                    1 => GroupKind::GroupOpen,
                    2 => GroupKind::GroupClosed,
                    3 => GroupKind::GroupEnd,
                    _ => GroupKind::Normal,
                };
            }
            b"lyEf" => {
                let json_bytes = c.read_bytes(ali_len)?;
                if let Ok(s) = std::str::from_utf8(json_bytes) {
                    effects_json = Some(s.to_string());
                }
            }
            // Photoshop-native layer kinds Lopsy imports as raster pixels.
            // Recorded so the UI can warn that editability was flattened.
            b"TySh" | b"tySh" => source_kind = PsdSourceKind::Text,
            b"SoLd" | b"SoLE" | b"PlLd" => source_kind = PsdSourceKind::SmartObject,
            b"SoCo" | b"GdFl" | b"PtFl" => source_kind = PsdSourceKind::Fill,
            b"levl" | b"curv" | b"brit" | b"hue " | b"hue2" | b"blnc" | b"selc"
            | b"grdm" | b"phfl" | b"mixr" | b"blwh" | b"vibA" | b"expA" | b"post"
            | b"thrs" | b"nvrt" => source_kind = PsdSourceKind::Adjustment,
            _ => {}
        }

        // Skip to end of this additional layer info block
        let consumed = c.position() - ali_data_start;
        if consumed < ali_len {
            c.skip(ali_len - consumed)?;
        }
        // Pad to even
        if ali_len % 2 != 0 {
            if c.position() < extra_end {
                c.skip(1)?;
            }
        }
    }

    // Skip to extra_end
    if c.position() < extra_end {
        c.skip(extra_end - c.position())?;
    }

    // Group-end sentinels in real PSD files use "</Layer group>" as their name
    // — normalize back to empty for clean semantics.
    let raw_name = unicode_name.unwrap_or(name);
    let final_name = if group_kind == GroupKind::GroupEnd && raw_name == "</Layer group>" {
        String::new()
    } else {
        raw_name
    };

    Ok(LayerRecord {
        rect,
        channel_info,
        blend_mode,
        opacity,
        visible,
        clip_to_below,
        name: final_name,
        group_kind,
        mask,
        effects_json,
        source_kind,
    })
}

/// Read and interleave all channel pixel data for a single layer,
/// including the mask channel if present.
fn read_all_layer_channels(
    c: &mut PsdCursor,
    record: &LayerRecord,
    header: &PsdHeader,
) -> Result<(Vec<u8>, Option<PsdMask>), PsdError> {
    let w = record.rect.width() as usize;
    let h = record.rect.height() as usize;

    if w == 0 || h == 0 {
        // Group markers / empty layers — skip channel data
        for ch in &record.channel_info {
            c.skip(ch.data_length as usize)?;
        }
        return Ok((Vec::new(), None));
    }

    let bpc = header.depth.bytes_per_channel();
    let pixel_count = w * h;

    // Read each channel.  For RGB: 0=R, 1=G, 2=B.  For CMYK: 0=C, 1=M, 2=Y, 3=K.
    let mut ch0_plane: Option<Vec<u8>> = None;
    let mut ch1_plane: Option<Vec<u8>> = None;
    let mut ch2_plane: Option<Vec<u8>> = None;
    let mut ch3_plane: Option<Vec<u8>> = None; // K channel for CMYK
    let mut a_plane: Option<Vec<u8>> = None;
    let mut mask_plane: Option<Vec<u8>> = None;

    for ch in &record.channel_info {
        if ch.id == -2 {
            // Mask channel — decode using mask rect dimensions
            if let Some(ref mr) = record.mask {
                let mw = mr.rect.width() as usize;
                let mh = mr.rect.height() as usize;
                if mw > 0 && mh > 0 {
                    let mask_header = PsdHeader {
                        width: mw as u32,
                        height: mh as u32,
                        depth: PsdDepth::Eight,
                        channels: 1,
                        color_mode: PsdColorMode::Rgb,
                    };
                    let plane = decode_channel(c, ch.data_length as usize, mw, mh, &mask_header)?;
                    mask_plane = Some(plane);
                } else {
                    c.skip(ch.data_length as usize)?;
                }
            } else {
                c.skip(ch.data_length as usize)?;
            }
            continue;
        }

        let plane = decode_channel(c, ch.data_length as usize, w, h, header)?;

        match ch.id {
            -1 => a_plane = Some(plane),
            0 => ch0_plane = Some(plane),
            1 => ch1_plane = Some(plane),
            2 => ch2_plane = Some(plane),
            3 => ch3_plane = Some(plane),
            _ => {}
        }
    }

    // Interleave into RGBA (converting CMYK→RGB if needed)
    let default_color = vec![0u8; pixel_count * bpc];
    let default_alpha = match header.depth {
        PsdDepth::Eight => vec![255u8; pixel_count],
        PsdDepth::Sixteen => {
            let mut v = Vec::with_capacity(pixel_count * 2);
            for _ in 0..pixel_count {
                v.extend_from_slice(&[0xFF, 0xFF]);
            }
            v
        }
    };

    let c0 = ch0_plane.as_ref().unwrap_or(&default_color);
    // Grayscale PSDs carry a single color plane; replicating it across G and B
    // lets the shared interleave below emit neutral R=G=B pixels.
    let is_gray = header.color_mode == PsdColorMode::Grayscale;
    let c1 = if is_gray { c0 } else { ch1_plane.as_ref().unwrap_or(&default_color) };
    let c2 = if is_gray { c0 } else { ch2_plane.as_ref().unwrap_or(&default_color) };
    let a = a_plane.as_ref().unwrap_or(&default_alpha);

    let mut interleaved = Vec::with_capacity(pixel_count * 4 * bpc);

    if header.color_mode == PsdColorMode::Cmyk {
        let default_k = vec![0u8; pixel_count * bpc];
        let k = ch3_plane.as_ref().unwrap_or(&default_k);
        match header.depth {
            PsdDepth::Eight => {
                for i in 0..pixel_count {
                    let (r, g, b) = cmyk_to_rgb_u8(c0[i], c1[i], c2[i], k[i]);
                    interleaved.push(r);
                    interleaved.push(g);
                    interleaved.push(b);
                    interleaved.push(a[i]);
                }
            }
            PsdDepth::Sixteen => {
                for i in 0..pixel_count {
                    let cv = u16::from_be_bytes([c0[i * 2], c0[i * 2 + 1]]);
                    let mv = u16::from_be_bytes([c1[i * 2], c1[i * 2 + 1]]);
                    let yv = u16::from_be_bytes([c2[i * 2], c2[i * 2 + 1]]);
                    let kv = u16::from_be_bytes([k[i * 2], k[i * 2 + 1]]);
                    let (r, g, b) = cmyk_to_rgb_u16(cv, mv, yv, kv);
                    interleaved.extend_from_slice(&r.to_be_bytes());
                    interleaved.extend_from_slice(&g.to_be_bytes());
                    interleaved.extend_from_slice(&b.to_be_bytes());
                    interleaved.extend_from_slice(&a[i * 2..i * 2 + 2]);
                }
            }
        }
    } else {
        match header.depth {
            PsdDepth::Eight => {
                for i in 0..pixel_count {
                    interleaved.push(c0[i]);
                    interleaved.push(c1[i]);
                    interleaved.push(c2[i]);
                    interleaved.push(a[i]);
                }
            }
            PsdDepth::Sixteen => {
                for i in 0..pixel_count {
                    interleaved.extend_from_slice(&c0[i * 2..i * 2 + 2]);
                    interleaved.extend_from_slice(&c1[i * 2..i * 2 + 2]);
                    interleaved.extend_from_slice(&c2[i * 2..i * 2 + 2]);
                    interleaved.extend_from_slice(&a[i * 2..i * 2 + 2]);
                }
            }
        }
    }

    // Build mask
    let mask = match (&record.mask, mask_plane) {
        (Some(mr), Some(data)) if !mr.rect.is_empty() => {
            Some(PsdMask {
                rect: mr.rect,
                data,
                default_color: mr.default_color,
            })
        }
        (Some(mr), None) if !mr.rect.is_empty() => {
            let mw = mr.rect.width() as usize;
            let mh = mr.rect.height() as usize;
            Some(PsdMask {
                rect: mr.rect,
                data: vec![mr.default_color; mw * mh],
                default_color: mr.default_color,
            })
        }
        _ => None,
    };

    Ok((interleaved, mask))
}

/// Decode a single channel from the stream.
fn decode_channel(
    c: &mut PsdCursor,
    total_len: usize,
    w: usize,
    h: usize,
    header: &PsdHeader,
) -> Result<Vec<u8>, PsdError> {
    if total_len < 2 {
        return Err(PsdError::InvalidLayerData("channel data too short".into()));
    }

    let compression = c.read_u16()?;
    let data_len = total_len - 2;

    match compression {
        0 => {
            // Raw
            let data = c.read_bytes(data_len)?;
            Ok(data.to_vec())
        }
        1 => {
            // PackBits RLE
            // Byte count table: h entries of u16
            let mut total_compressed = 0usize;
            for _ in 0..h {
                total_compressed += c.read_u16()? as usize;
            }

            let compressed = c.read_bytes(total_compressed)?;
            let bpc = header.depth.bytes_per_channel();
            let expected_total = w * bpc * h;
            let decoded = packbits_decode(compressed, expected_total);
            Ok(decoded)
        }
        2 => {
            // ZIP without prediction
            let compressed = c.read_bytes(data_len)?;
            super::zip_predict::zip_decode(compressed, w * h * header.depth.bytes_per_channel())
                .map_err(|e| PsdError::DecompressionFailed(e))
        }
        3 => {
            // ZIP with prediction
            let compressed = c.read_bytes(data_len)?;
            match header.depth {
                PsdDepth::Sixteen => {
                    let u16_data = zip_predict_decode_16(compressed, w as u32, h as u32)
                        .map_err(|e| PsdError::DecompressionFailed(e))?;
                    let mut bytes = Vec::with_capacity(u16_data.len() * 2);
                    for val in &u16_data {
                        bytes.extend_from_slice(&val.to_be_bytes());
                    }
                    Ok(bytes)
                }
                PsdDepth::Eight => {
                    // 8-bit ZIP with prediction: byte-level delta. The
                    // helper validates the inflated length so a corrupt
                    // stream errors instead of panicking out of bounds.
                    zip_predict_decode_8(compressed, w, h)
                        .map_err(PsdError::DecompressionFailed)
                }
            }
        }
        other => {
            // Silently zero-filling here would import the layer as black
            // with no indication anything went wrong — fail loudly instead.
            Err(PsdError::InvalidLayerData(format!(
                "unsupported channel compression type {other}"
            )))
        }
    }
}

// ─── CMYK → RGB conversion ────────────────────────────────────────────

#[inline]
fn cmyk_to_rgb_u8(c: u8, m: u8, y: u8, k: u8) -> (u8, u8, u8) {
    let r = ((255 - c as u16) * (255 - k as u16) / 255) as u8;
    let g = ((255 - m as u16) * (255 - k as u16) / 255) as u8;
    let b = ((255 - y as u16) * (255 - k as u16) / 255) as u8;
    (r, g, b)
}

#[inline]
fn cmyk_to_rgb_u16(c: u16, m: u16, y: u16, k: u16) -> (u16, u16, u16) {
    let r = ((65535u32 - c as u32) * (65535u32 - k as u32) / 65535) as u16;
    let g = ((65535u32 - m as u32) * (65535u32 - k as u32) / 65535) as u16;
    let b = ((65535u32 - y as u32) * (65535u32 - k as u32) / 65535) as u16;
    (r, g, b)
}

// ─── Section 5: Merged Composite ───────────────────────────────────────

fn read_merged_composite(c: &mut PsdCursor, header: &PsdHeader) -> Result<Vec<u8>, PsdError> {
    if c.remaining() < 2 {
        return Err(PsdError::TruncatedData);
    }

    let compression = c.read_u16()?;
    let w = header.width as usize;
    let h = header.height as usize;
    let bpc = header.depth.bytes_per_channel();
    let channels = header.channels as usize;
    let plane_size = w * h * bpc;

    let all_planes = match compression {
        0 => {
            // Raw
            let data = c.read_bytes(plane_size * channels)?;
            data.to_vec()
        }
        1 => {
            // RLE: byte counts for all channels, then data
            let total_rows = h * channels;
            let mut total_compressed = 0usize;
            for _ in 0..total_rows {
                total_compressed += c.read_u16()? as usize;
            }
            let compressed = c.read_bytes(total_compressed)?;
            packbits_decode(compressed, plane_size * channels)
        }
        3 => {
            // ZIP with prediction — single stream, all channels stacked
            let remaining = c.remaining();
            let compressed = c.read_bytes(remaining)?;
            match header.depth {
                PsdDepth::Sixteen => {
                    let total_pixels = w * h * channels;
                    let u16_data = zip_predict_decode_16(compressed, w as u32, (h * channels) as u32)
                        .map_err(|e| PsdError::DecompressionFailed(e))?;
                    let mut bytes = Vec::with_capacity(total_pixels * 2);
                    for val in &u16_data {
                        bytes.extend_from_slice(&val.to_be_bytes());
                    }
                    bytes
                }
                PsdDepth::Eight => {
                    // All channel planes are stacked in one stream; the
                    // helper validates the inflated length so a corrupt
                    // stream errors instead of panicking out of bounds.
                    zip_predict_decode_8(compressed, w * bpc, h * channels)
                        .map_err(PsdError::DecompressionFailed)?
                }
            }
        }
        _ => {
            return Err(PsdError::DecompressionFailed(format!("unsupported compression type {compression}")));
        }
    };

    let pixel_count = w * h;

    let mut rgba = Vec::with_capacity(pixel_count * 4 * bpc);

    if header.color_mode == PsdColorMode::Cmyk {
        // Planes: C, M, Y, K, [A]
        let has_alpha = channels >= 5;
        let c_plane = &all_planes[0..plane_size];
        let m_plane = &all_planes[plane_size..plane_size * 2];
        let y_plane = &all_planes[plane_size * 2..plane_size * 3];
        let k_plane = &all_planes[plane_size * 3..plane_size * 4];

        match header.depth {
            PsdDepth::Eight => {
                let a_plane = if has_alpha { &all_planes[plane_size * 4..plane_size * 5] } else { &[] as &[u8] };
                for i in 0..pixel_count {
                    let (r, g, b) = cmyk_to_rgb_u8(c_plane[i], m_plane[i], y_plane[i], k_plane[i]);
                    rgba.push(r);
                    rgba.push(g);
                    rgba.push(b);
                    rgba.push(if has_alpha { a_plane[i] } else { 255 });
                }
            }
            PsdDepth::Sixteen => {
                let a_plane = if has_alpha { &all_planes[plane_size * 4..plane_size * 5] } else { &[] as &[u8] };
                for i in 0..pixel_count {
                    let cv = u16::from_be_bytes([c_plane[i * 2], c_plane[i * 2 + 1]]);
                    let mv = u16::from_be_bytes([m_plane[i * 2], m_plane[i * 2 + 1]]);
                    let yv = u16::from_be_bytes([y_plane[i * 2], y_plane[i * 2 + 1]]);
                    let kv = u16::from_be_bytes([k_plane[i * 2], k_plane[i * 2 + 1]]);
                    let (r, g, b) = cmyk_to_rgb_u16(cv, mv, yv, kv);
                    rgba.extend_from_slice(&r.to_be_bytes());
                    rgba.extend_from_slice(&g.to_be_bytes());
                    rgba.extend_from_slice(&b.to_be_bytes());
                    if has_alpha {
                        rgba.extend_from_slice(&a_plane[i * 2..i * 2 + 2]);
                    } else {
                        rgba.extend_from_slice(&[0xFF, 0xFF]);
                    }
                }
            }
        }
    } else {
        // Grayscale: one color plane (+ optional alpha). RGB: three (+ optional alpha).
        let color_planes = header.color_mode.color_channels() as usize;
        let has_alpha = channels as usize >= color_planes + 1;
        // Grayscale reuses plane 0 for all three components.
        let g_off = if color_planes == 1 { 0 } else { plane_size };
        let b_off = if color_planes == 1 { 0 } else { plane_size * 2 };
        let a_off = plane_size * color_planes;
        match header.depth {
            PsdDepth::Eight => {
                let r_plane = &all_planes[0..plane_size];
                let g_plane = &all_planes[g_off..g_off + plane_size];
                let b_plane = &all_planes[b_off..b_off + plane_size];
                let a_plane = if has_alpha { &all_planes[a_off..a_off + plane_size] } else { &[] as &[u8] };

                for i in 0..pixel_count {
                    rgba.push(r_plane[i]);
                    rgba.push(g_plane[i]);
                    rgba.push(b_plane[i]);
                    rgba.push(if has_alpha { a_plane[i] } else { 255 });
                }
            }
            PsdDepth::Sixteen => {
                let r_plane = &all_planes[0..plane_size];
                let g_plane = &all_planes[g_off..g_off + plane_size];
                let b_plane = &all_planes[b_off..b_off + plane_size];
                let a_plane = if has_alpha { &all_planes[a_off..a_off + plane_size] } else { &[] as &[u8] };

                for i in 0..pixel_count {
                    rgba.extend_from_slice(&r_plane[i * 2..i * 2 + 2]);
                    rgba.extend_from_slice(&g_plane[i * 2..i * 2 + 2]);
                    rgba.extend_from_slice(&b_plane[i * 2..i * 2 + 2]);
                    if has_alpha {
                        rgba.extend_from_slice(&a_plane[i * 2..i * 2 + 2]);
                    } else {
                        rgba.extend_from_slice(&[0xFF, 0xFF]);
                    }
                }
            }
        }
    }

    Ok(rgba)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::BlendMode;
    use super::super::writer::write_psd;

    fn make_doc_8bit() -> PsdDocument {
        let w = 4u32;
        let h = 4u32;
        let mut data = Vec::with_capacity(64);
        for _ in 0..16 {
            data.extend_from_slice(&[255, 0, 0, 255]);
        }
        PsdDocument {
            width: w,
            height: h,
            depth: PsdDepth::Eight,
            color_mode: PsdColorMode::Rgb,
            layers: vec![PsdLayer {
                source_kind: PsdSourceKind::Raster,
                name: "Red".to_string(),
                visible: true,
                opacity: 200,
                blend_mode: BlendMode::Multiply,
                clip_to_below: false,
                rect: PsdRect::from_xywh(1, 2, 4, 4),
                pixel_data: data,
                mask: None,
                group_kind: GroupKind::Normal,
                effects_json: None,
            }],
            icc_profile: None,
        }
    }

    fn make_doc_16bit() -> PsdDocument {
        let w = 4u32;
        let h = 4u32;
        let mut data = Vec::with_capacity(128);
        for _ in 0..16 {
            data.extend_from_slice(&[0x80, 0x00]); // R = 32768
            data.extend_from_slice(&[0x40, 0x00]); // G = 16384
            data.extend_from_slice(&[0xC0, 0x00]); // B = 49152
            data.extend_from_slice(&[0xFF, 0xFF]); // A = 65535
        }
        PsdDocument {
            width: w,
            height: h,
            depth: PsdDepth::Sixteen,
            color_mode: PsdColorMode::Rgb,
            layers: vec![PsdLayer {
                source_kind: PsdSourceKind::Raster,
                name: "16bit layer".to_string(),
                visible: true,
                opacity: 255,
                blend_mode: BlendMode::Screen,
                clip_to_below: false,
                rect: PsdRect::from_xywh(0, 0, w, h),
                pixel_data: data,
                mask: None,
                group_kind: GroupKind::Normal,
                effects_json: None,
            }],
            icc_profile: None,
        }
    }

    #[test]
    fn roundtrip_8bit_single_layer() {
        let original = make_doc_8bit();
        let psd_bytes = write_psd(&original);
        let parsed = read_psd(&psd_bytes).unwrap();

        assert_eq!(parsed.width, original.width);
        assert_eq!(parsed.height, original.height);
        assert_eq!(parsed.depth, original.depth);
        assert_eq!(parsed.layers.len(), 1);

        let orig_layer = &original.layers[0];
        let parsed_layer = &parsed.layers[0];
        assert_eq!(parsed_layer.name, orig_layer.name);
        assert_eq!(parsed_layer.opacity, orig_layer.opacity);
        assert_eq!(parsed_layer.blend_mode, orig_layer.blend_mode);
        assert_eq!(parsed_layer.visible, orig_layer.visible);
        assert_eq!(parsed_layer.rect, orig_layer.rect);
        assert_eq!(parsed_layer.pixel_data, orig_layer.pixel_data);
    }

    #[test]
    fn roundtrip_16bit_single_layer() {
        let original = make_doc_16bit();
        let psd_bytes = write_psd(&original);
        let parsed = read_psd(&psd_bytes).unwrap();

        assert_eq!(parsed.width, original.width);
        assert_eq!(parsed.height, original.height);
        assert_eq!(parsed.depth, original.depth);
        assert_eq!(parsed.layers.len(), 1);

        let orig_layer = &original.layers[0];
        let parsed_layer = &parsed.layers[0];
        assert_eq!(parsed_layer.name, orig_layer.name);
        assert_eq!(parsed_layer.opacity, orig_layer.opacity);
        assert_eq!(parsed_layer.blend_mode, orig_layer.blend_mode);
        assert_eq!(parsed_layer.pixel_data, orig_layer.pixel_data, "16-bit pixel data mismatch");
    }

    /// Grayscale documents write a single color channel (header mode 1) and
    /// must read back as neutral RGBA so the rest of the engine stays RGBA.
    #[test]
    fn roundtrip_grayscale_writes_one_channel_and_reads_back_neutral() {
        let mut data = Vec::with_capacity(64);
        for i in 0..16u8 {
            let v = i * 16;
            data.extend_from_slice(&[v, v, v, 255]);
        }
        let original = PsdDocument {
            width: 4,
            height: 4,
            depth: PsdDepth::Eight,
            color_mode: PsdColorMode::Grayscale,
            layers: vec![PsdLayer {
                source_kind: PsdSourceKind::Raster,
                name: "Gray".to_string(),
                visible: true,
                opacity: 255,
                blend_mode: BlendMode::Normal,
                clip_to_below: false,
                rect: PsdRect::from_xywh(0, 0, 4, 4),
                pixel_data: data.clone(),
                mask: None,
                group_kind: GroupKind::Normal,
                effects_json: None,
            }],
            icc_profile: None,
        };

        let psd_bytes = write_psd(&original);
        // Header: channel count at offset 12, color mode at offset 24.
        assert_eq!(u16::from_be_bytes([psd_bytes[12], psd_bytes[13]]), 1);
        assert_eq!(u16::from_be_bytes([psd_bytes[24], psd_bytes[25]]), 1);

        let parsed = read_psd(&psd_bytes).unwrap();
        assert_eq!(parsed.color_mode, PsdColorMode::Grayscale);
        assert_eq!(parsed.layers.len(), 1);
        // The single gray plane is expanded back to R=G=B with alpha intact.
        assert_eq!(parsed.layers[0].pixel_data, data);
    }

    /// An RGB document must still declare 3 channels — the grayscale path
    /// must not change the default.
    #[test]
    fn roundtrip_rgb_still_writes_three_channels() {
        let psd_bytes = write_psd(&make_doc_8bit());
        assert_eq!(u16::from_be_bytes([psd_bytes[12], psd_bytes[13]]), 3);
        assert_eq!(u16::from_be_bytes([psd_bytes[24], psd_bytes[25]]), 3);
        assert_eq!(read_psd(&psd_bytes).unwrap().color_mode, PsdColorMode::Rgb);
    }

    #[test]
    fn roundtrip_with_groups() {
        let doc = PsdDocument {
            width: 2,
            height: 2,
            depth: PsdDepth::Eight,
            color_mode: PsdColorMode::Rgb,
            layers: vec![
                PsdLayer {
                    source_kind: PsdSourceKind::Raster,
                    name: "BG".to_string(),
                    visible: true,
                    opacity: 255,
                    blend_mode: BlendMode::Normal,
                    clip_to_below: false,
                    rect: PsdRect::from_xywh(0, 0, 2, 2),
                    pixel_data: vec![0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255],
                    mask: None,
                    group_kind: GroupKind::Normal,
                    effects_json: None,
                },
                PsdLayer {
                    source_kind: PsdSourceKind::Raster,
                    name: "".to_string(),
                    visible: true,
                    opacity: 255,
                    blend_mode: BlendMode::Normal,
                    clip_to_below: false,
                    rect: PsdRect::new(0, 0, 0, 0),
                    pixel_data: Vec::new(),
                    mask: None,
                    group_kind: GroupKind::GroupEnd,
                    effects_json: None,
                },
                PsdLayer {
                    source_kind: PsdSourceKind::Raster,
                    name: "Child".to_string(),
                    visible: true,
                    opacity: 128,
                    blend_mode: BlendMode::Overlay,
                    clip_to_below: false,
                    rect: PsdRect::from_xywh(0, 0, 2, 2),
                    pixel_data: vec![255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255],
                    mask: None,
                    group_kind: GroupKind::Normal,
                    effects_json: None,
                },
                PsdLayer {
                    source_kind: PsdSourceKind::Raster,
                    name: "My Group".to_string(),
                    visible: true,
                    opacity: 255,
                    blend_mode: BlendMode::Normal,
                    clip_to_below: false,
                    rect: PsdRect::new(0, 0, 0, 0),
                    pixel_data: Vec::new(),
                    mask: None,
                    group_kind: GroupKind::GroupOpen,
                    effects_json: None,
                },
            ],
            icc_profile: None,
        };

        let psd_bytes = write_psd(&doc);
        let parsed = read_psd(&psd_bytes).unwrap();

        assert_eq!(parsed.layers.len(), 4);
        assert_eq!(parsed.layers[0].name, "BG");
        assert_eq!(parsed.layers[0].group_kind, GroupKind::Normal);
        assert_eq!(parsed.layers[1].group_kind, GroupKind::GroupEnd);
        assert_eq!(parsed.layers[2].name, "Child");
        assert_eq!(parsed.layers[2].opacity, 128);
        assert_eq!(parsed.layers[2].blend_mode, BlendMode::Overlay);
        assert_eq!(parsed.layers[3].name, "My Group");
        assert_eq!(parsed.layers[3].group_kind, GroupKind::GroupOpen);
    }

    #[test]
    fn reject_invalid_signature() {
        let result = read_psd(b"NOT_PSD_DATA_HERE");
        assert!(matches!(result, Err(PsdError::InvalidSignature)));
    }

    /// A corrupt 8-bit ZIP-with-prediction channel whose stream inflates
    /// short must surface as an error. Before the length validation this
    /// panicked indexing past the inflated buffer — which panic=abort turns
    /// into a whole-engine abort from user-supplied file data.
    #[test]
    fn corrupt_8bit_zip_predicted_channel_errors_instead_of_panicking() {
        let header = PsdHeader {
            width: 4,
            height: 4,
            depth: PsdDepth::Eight,
            channels: 4,
            color_mode: PsdColorMode::Rgb,
        };
        // Only 4 bytes inflate out, but the 4x4 channel expects 16.
        let short_stream = super::super::zip_predict::zip_encode(&[10u8, 20, 30, 40]);
        let mut channel_data = vec![0u8, 3]; // compression type 3 (u16 BE)
        channel_data.extend_from_slice(&short_stream);

        let mut cursor = PsdCursor::new(&channel_data);
        let result = decode_channel(&mut cursor, channel_data.len(), 4, 4, &header);
        assert!(matches!(result, Err(PsdError::DecompressionFailed(_))));
    }

    /// Same corruption through the merged-composite path, which stacks all
    /// channel planes in a single ZIP-predicted stream.
    #[test]
    fn corrupt_8bit_zip_predicted_composite_errors_instead_of_panicking() {
        let header = PsdHeader {
            width: 4,
            height: 4,
            depth: PsdDepth::Eight,
            channels: 3,
            color_mode: PsdColorMode::Rgb,
        };
        // 3 channels x 16 bytes expected; only 8 inflate out.
        let short_stream = super::super::zip_predict::zip_encode(&[0u8; 8]);
        let mut section = vec![0u8, 3]; // compression type 3 (u16 BE)
        section.extend_from_slice(&short_stream);

        let mut cursor = PsdCursor::new(&section);
        let result = read_merged_composite(&mut cursor, &header);
        assert!(matches!(result, Err(PsdError::DecompressionFailed(_))));
    }

    #[test]
    fn cmyk_to_rgb_known_values() {
        // Pure white: C=0, M=0, Y=0, K=0 → R=255, G=255, B=255
        assert_eq!(super::cmyk_to_rgb_u8(0, 0, 0, 0), (255, 255, 255));
        // Pure black: K=255 → R=0, G=0, B=0
        assert_eq!(super::cmyk_to_rgb_u8(0, 0, 0, 255), (0, 0, 0));
        // Full cyan: C=255, K=0 → R=0, G=255, B=255
        assert_eq!(super::cmyk_to_rgb_u8(255, 0, 0, 0), (0, 255, 255));
        // Full magenta: M=255, K=0 → R=255, G=0, B=255
        assert_eq!(super::cmyk_to_rgb_u8(0, 255, 0, 0), (255, 0, 255));
        // Full yellow: Y=255, K=0 → R=255, G=255, B=0
        assert_eq!(super::cmyk_to_rgb_u8(0, 0, 255, 0), (255, 255, 0));
    }

    #[test]
    fn parse_cmyk_psd_file() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let path = std::path::Path::new(manifest_dir)
            .join("../../../samples/shippinglabels.psd");
        let data = std::fs::read(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        let doc = read_psd(&data).unwrap();
        assert_eq!(doc.width, 2550);
        assert_eq!(doc.height, 3300);
        assert_eq!(doc.depth, PsdDepth::Eight);
        assert!(!doc.layers.is_empty());
        for layer in &doc.layers {
            if layer.rect.width() > 0 && layer.rect.height() > 0 {
                let expected = layer.rect.width() as usize * layer.rect.height() as usize * 4;
                assert_eq!(
                    layer.pixel_data.len(), expected,
                    "layer '{}' pixel data length mismatch: expected RGBA {expected}, got {}",
                    layer.name, layer.pixel_data.len()
                );
            }
        }
    }
}
