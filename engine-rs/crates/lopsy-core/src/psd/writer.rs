use std::io::{Cursor, Seek, SeekFrom, Write};
use crate::color::ColorSpace;
use crate::export::build_icc_profile;
use super::blend_keys::blend_mode_to_psd_key;
use super::flatten::flatten_layers;
use super::packbits::packbits_encode;
use super::zip_predict::zip_predict_encode_16;
use super::types::{PsdDocument, PsdDepth, PsdLayer, GroupKind};

/// Write a PSD file from a document descriptor.
pub fn write_psd(doc: &PsdDocument) -> Vec<u8> {
    let mut out = Cursor::new(Vec::with_capacity(1024 * 1024));

    write_header(&mut out, doc);
    write_color_mode_data(&mut out);
    write_image_resources(&mut out, doc);
    write_layer_and_mask_info(&mut out, doc);
    write_merged_composite(&mut out, doc);

    out.into_inner()
}

// ─── Section 1: File Header ────────────────────────────────────────────

fn write_header(out: &mut Cursor<Vec<u8>>, doc: &PsdDocument) {
    out.write_all(b"8BPS").unwrap();          // signature
    write_u16(out, 1);                         // version
    out.write_all(&[0u8; 6]).unwrap();         // reserved
    // Photoshop expects the header channel count to match the color mode
    // (RGB = 3). The merged image section writes 3 planes. Layer transparency
    // is handled per-layer via channel id -1, not via this header count.
    write_u16(out, 3);                         // channels (RGB)
    write_u32(out, doc.height);                // rows
    write_u32(out, doc.width);                 // columns
    write_u16(out, doc.depth.bits_per_channel()); // depth
    write_u16(out, 3);                         // color mode: RGB
}

// ─── Section 2: Color Mode Data ────────────────────────────────────────

fn write_color_mode_data(out: &mut Cursor<Vec<u8>>) {
    write_u32(out, 0); // length = 0 for RGB
}

// ─── Section 3: Image Resources ────────────────────────────────────────

fn write_image_resources(out: &mut Cursor<Vec<u8>>, doc: &PsdDocument) {
    let section_start = out.position();
    write_u32(out, 0); // placeholder for length

    // Resolution info (ID 1005): 72 DPI
    write_image_resource(out, 1005, &build_resolution_info(72, 72));

    // ICC profile (ID 1039)
    let icc = doc.icc_profile.clone().unwrap_or_else(|| build_icc_profile(ColorSpace::Srgb));
    write_image_resource(out, 1039, &icc);

    // Backpatch section length
    backpatch_u32(out, section_start);
}

fn write_image_resource(out: &mut Cursor<Vec<u8>>, id: u16, data: &[u8]) {
    out.write_all(b"8BIM").unwrap();
    write_u16(out, id);
    out.write_all(&[0, 0]).unwrap(); // pascal string name (empty, padded to even)
    write_u32(out, data.len() as u32);
    out.write_all(data).unwrap();
    // Pad to even
    if data.len() % 2 != 0 {
        out.write_all(&[0]).unwrap();
    }
}

fn build_resolution_info(h_dpi: u16, v_dpi: u16) -> Vec<u8> {
    let mut data = Vec::with_capacity(16);
    // Horizontal resolution: fixed 16.16
    write_u32_to_vec(&mut data, (h_dpi as u32) << 16);
    write_u16_to_vec(&mut data, 1); // display unit: pixels per inch
    write_u16_to_vec(&mut data, 1); // width unit: inches
    // Vertical resolution: fixed 16.16
    write_u32_to_vec(&mut data, (v_dpi as u32) << 16);
    write_u16_to_vec(&mut data, 1); // display unit
    write_u16_to_vec(&mut data, 1); // height unit
    data
}

// ─── Section 4: Layer and Mask Information ─────────────────────────────

fn write_layer_and_mask_info(out: &mut Cursor<Vec<u8>>, doc: &PsdDocument) {
    let section_start = out.position();
    write_u32(out, 0); // placeholder for total section length

    match doc.depth {
        PsdDepth::Eight => {
            // 8-bit: layer info goes in the main layer info section.
            write_layer_info_section(out, doc);
            write_global_mask_info(out);
        }
        PsdDepth::Sixteen => {
            // 16-bit: Photoshop requires layer info to be wrapped in an
            // 'Lr16' additional layer info block at the document level.
            // The main layer info section must be empty.
            write_u32(out, 0); // empty main layer info
            write_global_mask_info(out);
            write_lr16_block(out, doc);
        }
    }

    // Backpatch section length
    backpatch_u32(out, section_start);
}

/// Write the layer info section (for 8-bit: directly in Section 4;
/// for 16-bit: inside an Lr16 additional info block).
fn write_layer_info_body(out: &mut Cursor<Vec<u8>>, doc: &PsdDocument) {
    // Layer count: negative means first alpha channel contains transparency for merged result
    let layer_count = doc.layers.len() as i16;
    write_i16(out, -layer_count);

    // Pre-compute channel data for each layer
    let channel_data: Vec<LayerChannelData> = doc.layers.iter()
        .map(|layer| encode_layer_channels(layer, doc.depth))
        .collect();

    // Write layer records
    for (layer, ch_data) in doc.layers.iter().zip(channel_data.iter()) {
        write_layer_record(out, layer, ch_data, doc.depth);
    }

    // Write channel image data for each layer
    for ch_data in &channel_data {
        for channel in &ch_data.channels {
            write_u16(out, channel.compression);
            out.write_all(&channel.data).unwrap();
        }
    }
}

fn write_layer_info_section(out: &mut Cursor<Vec<u8>>, doc: &PsdDocument) {
    if doc.layers.is_empty() {
        write_u32(out, 0);
        return;
    }

    let layer_info_start = out.position();
    write_u32(out, 0); // placeholder for layer info length

    write_layer_info_body(out, doc);

    // Backpatch layer info length (must be even)
    backpatch_u32_even(out, layer_info_start);
}

/// Write an 'Lr16' additional layer info block containing the layer info body
/// (layer count + records + channel data, NO inner length prefix).
/// The body is padded to a 4-byte boundary — Photoshop requires this alignment.
fn write_lr16_block(out: &mut Cursor<Vec<u8>>, doc: &PsdDocument) {
    if doc.layers.is_empty() {
        return;
    }

    out.write_all(b"8BIM").unwrap();
    out.write_all(b"Lr16").unwrap();

    let block_len_pos = out.position();
    write_u32(out, 0); // placeholder for block length

    write_layer_info_body(out, doc);

    // Pad the block body to a 4-byte boundary
    let end = out.position();
    let data_len = (end - block_len_pos - 4) as usize;
    let padding = (4 - (data_len % 4)) % 4;
    for _ in 0..padding {
        out.write_all(&[0]).unwrap();
    }

    let final_end = out.position();
    let final_len = (final_end - block_len_pos - 4) as u32;
    out.seek(SeekFrom::Start(block_len_pos)).unwrap();
    out.write_all(&final_len.to_be_bytes()).unwrap();
    out.seek(SeekFrom::Start(final_end)).unwrap();
}

fn write_layer_record(
    out: &mut Cursor<Vec<u8>>,
    layer: &PsdLayer,
    ch_data: &LayerChannelData,
    _depth: PsdDepth,
) {
    // Bounding rect: top, left, bottom, right
    write_i32(out, layer.rect.top);
    write_i32(out, layer.rect.left);
    write_i32(out, layer.rect.bottom);
    write_i32(out, layer.rect.right);

    // Channel count
    let channel_count = ch_data.channels.len() as u16;
    write_u16(out, channel_count);

    // Per-channel info: channel ID (i16) + data length (u32)
    // Data length includes the 2-byte compression type
    for channel in &ch_data.channels {
        write_i16(out, channel.id);
        write_u32(out, channel.data.len() as u32 + 2); // +2 for compression type
    }

    // Blend mode signature + key
    out.write_all(b"8BIM").unwrap();
    out.write_all(&blend_mode_to_psd_key(layer.blend_mode)).unwrap();

    // Opacity
    out.write_all(&[layer.opacity]).unwrap();

    // Clipping: 0 = base, 1 = non-base (clipped)
    out.write_all(&[if layer.clip_to_below { 1 } else { 0 }]).unwrap();

    // Flags: bit 1 = visible (inverted: 0 = visible), bit 3 = Photoshop 5+ marker (always set)
    let mut flags: u8 = 0x08;
    if !layer.visible {
        flags |= 0x02;
    }
    out.write_all(&[flags]).unwrap();

    // Filler
    out.write_all(&[0]).unwrap();

    // Extra data
    let extra_start = out.position();
    write_u32(out, 0); // placeholder for extra data length

    // Layer mask data
    write_layer_mask_data(out, layer);

    // Layer blending ranges (empty)
    write_u32(out, 0);

    // Layer name (Pascal string, padded to 4 bytes)
    // Group-end markers conventionally use "</Layer group>"
    let effective_name = if layer.group_kind == GroupKind::GroupEnd {
        "</Layer group>"
    } else {
        &layer.name
    };
    write_pascal_string_padded4(out, effective_name);

    // Additional layer info: Unicode name
    write_unicode_name(out, effective_name);

    // Additional layer info: Section divider (for groups)
    if layer.group_kind != GroupKind::Normal {
        write_section_divider(out, layer);
    }

    // Backpatch extra data length
    backpatch_u32(out, extra_start);
}

fn write_layer_mask_data(out: &mut Cursor<Vec<u8>>, layer: &PsdLayer) {
    match &layer.mask {
        None => {
            write_u32(out, 0);
        }
        Some(mask) => {
            // Size of mask data: rect(16) + default_color(1) + flags(1) + padding(2) = 20
            write_u32(out, 20);
            write_i32(out, mask.rect.top);
            write_i32(out, mask.rect.left);
            write_i32(out, mask.rect.bottom);
            write_i32(out, mask.rect.right);
            out.write_all(&[mask.default_color]).unwrap();
            out.write_all(&[0]).unwrap(); // flags
            out.write_all(&[0, 0]).unwrap(); // padding
        }
    }
}

fn write_pascal_string_padded4(out: &mut Cursor<Vec<u8>>, s: &str) {
    let bytes = s.as_bytes();
    let len = bytes.len().min(255) as u8;
    out.write_all(&[len]).unwrap();
    out.write_all(&bytes[..len as usize]).unwrap();
    // Pad to 4-byte boundary (1 byte length + N bytes name, total padded to multiple of 4)
    let total = 1 + len as usize;
    let padding = (4 - (total % 4)) % 4;
    for _ in 0..padding {
        out.write_all(&[0]).unwrap();
    }
}

fn write_unicode_name(out: &mut Cursor<Vec<u8>>, name: &str) {
    // 8BIM + 'luni' + length + data
    out.write_all(b"8BIM").unwrap();
    out.write_all(b"luni").unwrap();

    let utf16: Vec<u16> = name.encode_utf16().collect();
    // Data: u32 char count + u16[] chars
    let data_len = 4 + utf16.len() * 2;
    write_u32(out, data_len as u32);

    write_u32(out, utf16.len() as u32);
    for ch in &utf16 {
        write_u16(out, *ch);
    }

    // Pad to even
    if data_len % 2 != 0 {
        out.write_all(&[0]).unwrap();
    }
}

fn write_section_divider(out: &mut Cursor<Vec<u8>>, layer: &PsdLayer) {
    out.write_all(b"8BIM").unwrap();
    out.write_all(b"lsct").unwrap();

    let divider_type: u32 = match layer.group_kind {
        GroupKind::GroupEnd => 3,
        GroupKind::GroupOpen => 1,
        GroupKind::GroupClosed => 2,
        GroupKind::Normal => 0,
    };

    // Data: type (4) + optional signature+key (8)
    if layer.group_kind == GroupKind::GroupOpen || layer.group_kind == GroupKind::GroupClosed {
        write_u32(out, 12); // length: type + sig + key
        write_u32(out, divider_type);
        out.write_all(b"8BIM").unwrap();
        out.write_all(&blend_mode_to_psd_key(layer.blend_mode)).unwrap();
    } else {
        write_u32(out, 4); // length: just the type
        write_u32(out, divider_type);
    }
}

// ─── Channel Encoding ──────────────────────────────────────────────────

struct ChannelEncoded {
    id: i16,
    compression: u16,
    data: Vec<u8>,
}

struct LayerChannelData {
    channels: Vec<ChannelEncoded>,
}

fn encode_layer_channels(layer: &PsdLayer, depth: PsdDepth) -> LayerChannelData {
    let w = layer.rect.width() as usize;
    let h = layer.rect.height() as usize;

    // Group markers and empty layers have no pixel data
    if w == 0 || h == 0 || layer.group_kind == GroupKind::GroupEnd {
        return LayerChannelData {
            channels: vec![
                ChannelEncoded { id: -1, compression: 0, data: Vec::new() },
                ChannelEncoded { id: 0, compression: 0, data: Vec::new() },
                ChannelEncoded { id: 1, compression: 0, data: Vec::new() },
                ChannelEncoded { id: 2, compression: 0, data: Vec::new() },
            ],
        };
    }

    // Deinterleave RGBA into separate channel planes
    let (r_plane, g_plane, b_plane, a_plane) = deinterleave_rgba(&layer.pixel_data, w, h, depth);

    let mut channels = Vec::with_capacity(5);

    // Photoshop expects R, G, B, then transparency
    channels.push(encode_channel_plane(0, &r_plane, w, h, depth));
    channels.push(encode_channel_plane(1, &g_plane, w, h, depth));
    channels.push(encode_channel_plane(2, &b_plane, w, h, depth));
    channels.push(encode_channel_plane(-1, &a_plane, w, h, depth));

    // Layer mask channel (id = -2) if present
    if let Some(ref mask) = layer.mask {
        channels.push(encode_channel_plane(-2, &mask.data, mask.rect.width() as usize, mask.rect.height() as usize, PsdDepth::Eight));
    }

    LayerChannelData { channels }
}

fn deinterleave_rgba(data: &[u8], w: usize, h: usize, depth: PsdDepth) -> (Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>) {
    let pixel_count = w * h;
    let bpc = depth.bytes_per_channel();

    let mut r = Vec::with_capacity(pixel_count * bpc);
    let mut g = Vec::with_capacity(pixel_count * bpc);
    let mut b = Vec::with_capacity(pixel_count * bpc);
    let mut a = Vec::with_capacity(pixel_count * bpc);

    match depth {
        PsdDepth::Eight => {
            for i in 0..pixel_count {
                let base = i * 4;
                r.push(data[base]);
                g.push(data[base + 1]);
                b.push(data[base + 2]);
                a.push(data[base + 3]);
            }
        }
        PsdDepth::Sixteen => {
            for i in 0..pixel_count {
                let base = i * 8;
                r.extend_from_slice(&data[base..base + 2]);
                g.extend_from_slice(&data[base + 2..base + 4]);
                b.extend_from_slice(&data[base + 4..base + 6]);
                a.extend_from_slice(&data[base + 6..base + 8]);
            }
        }
    }

    (r, g, b, a)
}

fn encode_channel_plane(id: i16, plane: &[u8], w: usize, h: usize, depth: PsdDepth) -> ChannelEncoded {
    if w == 0 || h == 0 {
        return ChannelEncoded { id, compression: 0, data: Vec::new() };
    }

    match depth {
        PsdDepth::Eight => {
            // PackBits (compression type 1)
            let row_size = w;
            let mut byte_counts: Vec<u16> = Vec::with_capacity(h);
            let mut compressed_rows: Vec<Vec<u8>> = Vec::with_capacity(h);

            for y in 0..h {
                let row = &plane[y * row_size..(y + 1) * row_size];
                let encoded = packbits_encode(row);
                byte_counts.push(encoded.len() as u16);
                compressed_rows.push(encoded);
            }

            // Build data: byte count table + compressed rows
            let mut data = Vec::with_capacity(h * 2 + plane.len());
            for &count in &byte_counts {
                data.extend_from_slice(&count.to_be_bytes());
            }
            for row in &compressed_rows {
                data.extend_from_slice(row);
            }

            ChannelEncoded { id, compression: 1, data }
        }
        PsdDepth::Sixteen => {
            // ZIP with prediction (compression type 3)
            // Convert the big-endian byte plane to u16 values
            let pixel_count = w * h;
            let mut channel_u16 = Vec::with_capacity(pixel_count);
            for i in 0..pixel_count {
                let hi = plane[i * 2] as u16;
                let lo = plane[i * 2 + 1] as u16;
                channel_u16.push((hi << 8) | lo);
            }

            let data = zip_predict_encode_16(&channel_u16, w as u32, h as u32);
            ChannelEncoded { id, compression: 3, data }
        }
    }
}

// ─── Global Mask Info ──────────────────────────────────────────────────

fn write_global_mask_info(out: &mut Cursor<Vec<u8>>) {
    write_u32(out, 0); // length = 0
}

// ─── Section 5: Merged Composite ───────────────────────────────────────

fn write_merged_composite(out: &mut Cursor<Vec<u8>>, doc: &PsdDocument) {
    let planes = flatten_layers(doc);
    let w = doc.width as usize;
    let h = doc.height as usize;

    match doc.depth {
        PsdDepth::Eight => {
            // PackBits compression (type 1)
            write_u16(out, 1);

            // Merged composite has 3 planes (R, G, B) for RGB mode.
            // Alpha is not stored in the merged image.
            let channel_planes = [&planes.r, &planes.g, &planes.b];
            let mut all_byte_counts: Vec<Vec<u16>> = Vec::new();
            let mut all_compressed: Vec<Vec<Vec<u8>>> = Vec::new();

            for plane in &channel_planes {
                let mut byte_counts = Vec::with_capacity(h);
                let mut compressed_rows = Vec::with_capacity(h);
                for y in 0..h {
                    let row = &plane[y * w..(y + 1) * w];
                    let encoded = packbits_encode(row);
                    byte_counts.push(encoded.len() as u16);
                    compressed_rows.push(encoded);
                }
                all_byte_counts.push(byte_counts);
                all_compressed.push(compressed_rows);
            }

            for counts in &all_byte_counts {
                for &count in counts {
                    write_u16(out, count);
                }
            }

            for rows in &all_compressed {
                for row in rows {
                    out.write_all(row).unwrap();
                }
            }
        }
        PsdDepth::Sixteen => {
            // Raw (type 0) for maximum compatibility.
            // The merged image is 3 planes (R, G, B) of big-endian u16 bytes,
            // written one plane after another.
            write_u16(out, 0);

            out.write_all(&planes.r).unwrap();
            out.write_all(&planes.g).unwrap();
            out.write_all(&planes.b).unwrap();
        }
    }
}

// ─── Helpers ───────────────────────────────────────────────────────────

fn write_u16(out: &mut Cursor<Vec<u8>>, v: u16) {
    out.write_all(&v.to_be_bytes()).unwrap();
}

fn write_u32(out: &mut Cursor<Vec<u8>>, v: u32) {
    out.write_all(&v.to_be_bytes()).unwrap();
}

fn write_i16(out: &mut Cursor<Vec<u8>>, v: i16) {
    out.write_all(&v.to_be_bytes()).unwrap();
}

fn write_i32(out: &mut Cursor<Vec<u8>>, v: i32) {
    out.write_all(&v.to_be_bytes()).unwrap();
}

fn write_u16_to_vec(v: &mut Vec<u8>, val: u16) {
    v.extend_from_slice(&val.to_be_bytes());
}

fn write_u32_to_vec(v: &mut Vec<u8>, val: u32) {
    v.extend_from_slice(&val.to_be_bytes());
}

/// Write a u32 placeholder at `start`, then backpatch it with the actual length
/// of data written after the placeholder.
fn backpatch_u32(out: &mut Cursor<Vec<u8>>, start: u64) {
    let end = out.position();
    let length = (end - start - 4) as u32; // subtract 4 for the placeholder itself
    out.seek(SeekFrom::Start(start)).unwrap();
    out.write_all(&length.to_be_bytes()).unwrap();
    out.seek(SeekFrom::Start(end)).unwrap();
}

/// Like backpatch_u32 but ensures the data is padded to an even boundary.
fn backpatch_u32_even(out: &mut Cursor<Vec<u8>>, start: u64) {
    let end = out.position();
    let length = end - start - 4;
    if length % 2 != 0 {
        out.write_all(&[0]).unwrap();
    }
    let final_end = out.position();
    let final_length = (final_end - start - 4) as u32;
    out.seek(SeekFrom::Start(start)).unwrap();
    out.write_all(&final_length.to_be_bytes()).unwrap();
    out.seek(SeekFrom::Start(final_end)).unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::BlendMode;
    use super::super::types::{PsdDocument, PsdLayer, PsdRect, PsdDepth, PsdMask, GroupKind};

    fn make_red_layer(w: u32, h: u32) -> PsdLayer {
        let pixel_count = (w * h) as usize;
        let mut data = Vec::with_capacity(pixel_count * 4);
        for _ in 0..pixel_count {
            data.extend_from_slice(&[255, 0, 0, 255]);
        }
        PsdLayer {
            name: "Red".to_string(),
            visible: true,
            opacity: 255,
            blend_mode: BlendMode::Normal,
            clip_to_below: false,
            rect: PsdRect::from_xywh(0, 0, w, h),
            pixel_data: data,
            mask: None,
            group_kind: GroupKind::Normal,
        }
    }

    #[test]
    fn write_minimal_psd_has_correct_header() {
        let doc = PsdDocument {
            width: 4,
            height: 4,
            depth: PsdDepth::Eight,
            layers: vec![make_red_layer(4, 4)],
            icc_profile: None,
        };
        let psd = write_psd(&doc);

        assert_eq!(&psd[0..4], b"8BPS");
        assert_eq!(u16::from_be_bytes([psd[4], psd[5]]), 1); // version
        assert_eq!(u16::from_be_bytes([psd[12], psd[13]]), 3); // channels (RGB)
        assert_eq!(u32::from_be_bytes([psd[14], psd[15], psd[16], psd[17]]), 4); // height
        assert_eq!(u32::from_be_bytes([psd[18], psd[19], psd[20], psd[21]]), 4); // width
        assert_eq!(u16::from_be_bytes([psd[22], psd[23]]), 8); // depth
        assert_eq!(u16::from_be_bytes([psd[24], psd[25]]), 3); // color mode RGB
    }

    #[test]
    fn write_psd_nonzero_size() {
        let doc = PsdDocument {
            width: 10,
            height: 10,
            depth: PsdDepth::Eight,
            layers: vec![make_red_layer(10, 10)],
            icc_profile: None,
        };
        let psd = write_psd(&doc);
        assert!(psd.len() > 26, "PSD file too small: {} bytes", psd.len());
    }

    #[test]
    fn write_16bit_psd_has_correct_depth() {
        let mut layer = make_red_layer(2, 2);
        // Convert to 16-bit: each pixel is 8 bytes (4 * u16 big-endian)
        let mut data16 = Vec::new();
        for _ in 0..4 {
            data16.extend_from_slice(&[0xFF, 0xFF]); // R = 65535
            data16.extend_from_slice(&[0x00, 0x00]); // G = 0
            data16.extend_from_slice(&[0x00, 0x00]); // B = 0
            data16.extend_from_slice(&[0xFF, 0xFF]); // A = 65535
        }
        layer.pixel_data = data16;

        let doc = PsdDocument {
            width: 2,
            height: 2,
            depth: PsdDepth::Sixteen,
            layers: vec![layer],
            icc_profile: None,
        };
        let psd = write_psd(&doc);
        assert_eq!(u16::from_be_bytes([psd[22], psd[23]]), 16);
    }

    #[test]
    fn write_psd_with_group() {
        let group_end = PsdLayer {
            name: "".to_string(),
            visible: true,
            opacity: 255,
            blend_mode: BlendMode::Normal,
            clip_to_below: false,
            rect: PsdRect::new(0, 0, 0, 0),
            pixel_data: Vec::new(),
            mask: None,
            group_kind: GroupKind::GroupEnd,
        };
        let child = make_red_layer(4, 4);
        let group_open = PsdLayer {
            name: "My Group".to_string(),
            visible: true,
            opacity: 255,
            blend_mode: BlendMode::Normal,
            clip_to_below: false,
            rect: PsdRect::new(0, 0, 0, 0),
            pixel_data: Vec::new(),
            mask: None,
            group_kind: GroupKind::GroupOpen,
        };

        let doc = PsdDocument {
            width: 4,
            height: 4,
            depth: PsdDepth::Eight,
            layers: vec![group_end, child, group_open],
            icc_profile: None,
        };
        let psd = write_psd(&doc);
        // Should not panic and should produce valid data
        assert!(psd.len() > 100);
    }

    #[test]
    fn write_psd_with_mask() {
        let mut layer = make_red_layer(4, 4);
        layer.mask = Some(PsdMask {
            rect: PsdRect::from_xywh(0, 0, 4, 4),
            data: vec![128; 16], // 50% mask
            default_color: 0,
        });

        let doc = PsdDocument {
            width: 4,
            height: 4,
            depth: PsdDepth::Eight,
            layers: vec![layer],
            icc_profile: None,
        };
        let psd = write_psd(&doc);
        assert!(psd.len() > 100);
    }
}
