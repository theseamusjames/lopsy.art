use std::io::Read as IoRead;
use super::blend_keys::psd_key_to_blend_mode;
use super::packbits::packbits_decode;
use super::zip_predict::zip_predict_decode_16;
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
            name: "Background".to_string(),
            visible: true,
            opacity: 255,
            blend_mode: crate::color::BlendMode::Normal,
            clip_to_below: false,
            rect: PsdRect::from_xywh(0, 0, header.width, header.height),
            pixel_data: composite,
            mask: None,
            group_kind: GroupKind::Normal,
        }]
    } else {
        layers
    };

    Ok(PsdDocument {
        width: header.width,
        height: header.height,
        depth: header.depth,
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

    if color_mode != 3 {
        return Err(PsdError::UnsupportedColorMode(color_mode));
    }

    let depth = match depth_bits {
        8 => PsdDepth::Eight,
        16 => PsdDepth::Sixteen,
        _ => return Err(PsdError::UnsupportedDepth(depth_bits)),
    };

    Ok(PsdHeader { width, height, depth, channels })
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
            name: record.name,
            visible: record.visible,
            opacity: record.opacity,
            blend_mode: record.blend_mode,
            clip_to_below: record.clip_to_below,
            rect: record.rect,
            pixel_data,
            mask,
            group_kind: record.group_kind,
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

    // Scan additional layer info for luni and lsct
    let mut unicode_name: Option<String> = None;
    let mut group_kind = GroupKind::Normal;

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

    // Read each channel
    let mut r_plane: Option<Vec<u8>> = None;
    let mut g_plane: Option<Vec<u8>> = None;
    let mut b_plane: Option<Vec<u8>> = None;
    let mut a_plane: Option<Vec<u8>> = None;
    let mut mask_plane: Option<Vec<u8>> = None;

    for ch in &record.channel_info {
        if ch.id == -2 {
            // Mask channel — decode using mask rect dimensions
            if let Some(ref mr) = record.mask {
                let mw = mr.rect.width() as usize;
                let mh = mr.rect.height() as usize;
                if mw > 0 && mh > 0 {
                    // Masks are always 8-bit grayscale
                    let mask_header = PsdHeader {
                        width: mw as u32,
                        height: mh as u32,
                        depth: PsdDepth::Eight,
                        channels: 1,
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
            0 => r_plane = Some(plane),
            1 => g_plane = Some(plane),
            2 => b_plane = Some(plane),
            _ => {} // skip unknown channels
        }
    }

    // Interleave into RGBA
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

    let r = r_plane.as_ref().unwrap_or(&default_color);
    let g = g_plane.as_ref().unwrap_or(&default_color);
    let b = b_plane.as_ref().unwrap_or(&default_color);
    let a = a_plane.as_ref().unwrap_or(&default_alpha);

    let mut interleaved = Vec::with_capacity(pixel_count * 4 * bpc);
    match header.depth {
        PsdDepth::Eight => {
            for i in 0..pixel_count {
                interleaved.push(r[i]);
                interleaved.push(g[i]);
                interleaved.push(b[i]);
                interleaved.push(a[i]);
            }
        }
        PsdDepth::Sixteen => {
            for i in 0..pixel_count {
                interleaved.extend_from_slice(&r[i * 2..i * 2 + 2]);
                interleaved.extend_from_slice(&g[i * 2..i * 2 + 2]);
                interleaved.extend_from_slice(&b[i * 2..i * 2 + 2]);
                interleaved.extend_from_slice(&a[i * 2..i * 2 + 2]);
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
                    // 8-bit ZIP with prediction: byte-level delta
                    let mut decoder = flate2::read::ZlibDecoder::new(compressed);
                    let mut delta_buf = Vec::new();
                    decoder.read_to_end(&mut delta_buf)
                        .map_err(|e| PsdError::DecompressionFailed(e.to_string()))?;

                    // Undo delta per row
                    let row_size = w;
                    for y in 0..h {
                        let start = y * row_size;
                        for x in 1..row_size {
                            delta_buf[start + x] = delta_buf[start + x].wrapping_add(delta_buf[start + x - 1]);
                        }
                    }
                    Ok(delta_buf)
                }
            }
        }
        _ => {
            // Unknown compression — skip
            c.skip(data_len)?;
            let bpc = header.depth.bytes_per_channel();
            Ok(vec![0; w * h * bpc])
        }
    }
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
                    let mut decoder = flate2::read::ZlibDecoder::new(compressed);
                    let mut delta_buf = Vec::new();
                    decoder.read_to_end(&mut delta_buf)
                        .map_err(|e| PsdError::DecompressionFailed(e.to_string()))?;
                    let row_size = w * bpc;
                    let total_rows = h * channels;
                    for y in 0..total_rows {
                        let start = y * row_size;
                        for x in 1..row_size {
                            delta_buf[start + x] = delta_buf[start + x].wrapping_add(delta_buf[start + x - 1]);
                        }
                    }
                    delta_buf
                }
            }
        }
        _ => {
            return Err(PsdError::DecompressionFailed(format!("unsupported compression type {compression}")));
        }
    };

    // Deinterleave from planar (R plane, G plane, B plane, [A plane]) to interleaved RGBA
    let pixel_count = w * h;
    let has_alpha = channels >= 4;

    let mut rgba = Vec::with_capacity(pixel_count * 4 * bpc);
    match header.depth {
        PsdDepth::Eight => {
            let r_plane = &all_planes[0..plane_size];
            let g_plane = &all_planes[plane_size..plane_size * 2];
            let b_plane = &all_planes[plane_size * 2..plane_size * 3];
            let a_plane = if has_alpha {
                &all_planes[plane_size * 3..plane_size * 4]
            } else {
                &[]
            };

            for i in 0..pixel_count {
                rgba.push(r_plane[i]);
                rgba.push(g_plane[i]);
                rgba.push(b_plane[i]);
                rgba.push(if has_alpha { a_plane[i] } else { 255 });
            }
        }
        PsdDepth::Sixteen => {
            let r_plane = &all_planes[0..plane_size];
            let g_plane = &all_planes[plane_size..plane_size * 2];
            let b_plane = &all_planes[plane_size * 2..plane_size * 3];
            let a_plane = if has_alpha {
                &all_planes[plane_size * 3..plane_size * 4]
            } else {
                &[]
            };

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
            layers: vec![PsdLayer {
                name: "Red".to_string(),
                visible: true,
                opacity: 200,
                blend_mode: BlendMode::Multiply,
                clip_to_below: false,
                rect: PsdRect::from_xywh(1, 2, 4, 4),
                pixel_data: data,
                mask: None,
                group_kind: GroupKind::Normal,
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
            layers: vec![PsdLayer {
                name: "16bit layer".to_string(),
                visible: true,
                opacity: 255,
                blend_mode: BlendMode::Screen,
                clip_to_below: false,
                rect: PsdRect::from_xywh(0, 0, w, h),
                pixel_data: data,
                mask: None,
                group_kind: GroupKind::Normal,
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

    #[test]
    fn roundtrip_with_groups() {
        let doc = PsdDocument {
            width: 2,
            height: 2,
            depth: PsdDepth::Eight,
            layers: vec![
                PsdLayer {
                    name: "BG".to_string(),
                    visible: true,
                    opacity: 255,
                    blend_mode: BlendMode::Normal,
                    clip_to_below: false,
                    rect: PsdRect::from_xywh(0, 0, 2, 2),
                    pixel_data: vec![0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255],
                    mask: None,
                    group_kind: GroupKind::Normal,
                },
                PsdLayer {
                    name: "".to_string(),
                    visible: true,
                    opacity: 255,
                    blend_mode: BlendMode::Normal,
                    clip_to_below: false,
                    rect: PsdRect::new(0, 0, 0, 0),
                    pixel_data: Vec::new(),
                    mask: None,
                    group_kind: GroupKind::GroupEnd,
                },
                PsdLayer {
                    name: "Child".to_string(),
                    visible: true,
                    opacity: 128,
                    blend_mode: BlendMode::Overlay,
                    clip_to_below: false,
                    rect: PsdRect::from_xywh(0, 0, 2, 2),
                    pixel_data: vec![255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255],
                    mask: None,
                    group_kind: GroupKind::Normal,
                },
                PsdLayer {
                    name: "My Group".to_string(),
                    visible: true,
                    opacity: 255,
                    blend_mode: BlendMode::Normal,
                    clip_to_below: false,
                    rect: PsdRect::new(0, 0, 0, 0),
                    pixel_data: Vec::new(),
                    mask: None,
                    group_kind: GroupKind::GroupOpen,
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
}
