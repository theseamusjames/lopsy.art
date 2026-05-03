/// Minimal WOFF2 → SFNT decoder for Google Fonts compatibility.
///
/// WOFF2 spec: https://www.w3.org/TR/WOFF2/
/// We support CFF (OTF) and TrueType fonts. The glyf/loca tables in TrueType
/// fonts may use composite glyph transformation, which we handle via a
/// reconstructed loca/glyf pass. For CFF fonts no special handling is needed.
use std::io::Read;

const WOFF2_SIGNATURE: u32 = 0x774F4632; // 'wOF2'
const SFNT_VERSION_TRUETYPE: u32 = 0x00010000;
#[allow(dead_code)]
const SFNT_VERSION_CFF: u32 = 0x4F54544F; // 'OTTO'

// Known WOFF2 table tags
const TAG_GLYF: u32 = 0x676C7966;
const TAG_LOCA: u32 = 0x6C6F6361;
const TAG_HEAD: u32 = 0x68656164;

#[derive(Debug, Clone)]
struct TableEntry {
    tag: u32,
    flags: u8,
    transform_length: Option<u32>,
    #[allow(dead_code)]
    orig_length: u32,
    data_start: usize, // offset within decompressed block
    data_len: usize,
}

fn read_u8(data: &[u8], pos: &mut usize) -> Option<u8> {
    let v = *data.get(*pos)?;
    *pos += 1;
    Some(v)
}

fn read_u16_be(data: &[u8], pos: &mut usize) -> Option<u16> {
    let hi = *data.get(*pos)? as u16;
    let lo = *data.get(*pos + 1)? as u16;
    *pos += 2;
    Some((hi << 8) | lo)
}

fn read_u32_be(data: &[u8], pos: &mut usize) -> Option<u32> {
    let b0 = *data.get(*pos)? as u32;
    let b1 = *data.get(*pos + 1)? as u32;
    let b2 = *data.get(*pos + 2)? as u32;
    let b3 = *data.get(*pos + 3)? as u32;
    *pos += 4;
    Some((b0 << 24) | (b1 << 16) | (b2 << 8) | b3)
}

/// Read a WOFF2 UIntBase128 variable-length integer.
fn read_uint_base128(data: &[u8], pos: &mut usize) -> Option<u32> {
    let mut result: u32 = 0;
    for _ in 0..5 {
        let byte = read_u8(data, pos)?;
        // Leading byte must not be 0x80
        if result == 0 && byte == 0x80 {
            return None;
        }
        result = (result << 7) | (byte & 0x7F) as u32;
        if byte & 0x80 == 0 {
            return Some(result);
        }
    }
    None // Overflow
}

/// Read a 255UInt16 variable-length integer from the WOFF2 glyph data.
fn read_255_uint16(data: &[u8], pos: &mut usize) -> Option<u16> {
    let code = read_u8(data, pos)?;
    match code {
        253 => read_u16_be(data, pos),
        254 => {
            let b = read_u8(data, pos)? as u16;
            Some(b + 506)
        }
        255 => {
            let b = read_u8(data, pos)? as u16;
            Some(b + 253)
        }
        _ => Some(code as u16),
    }
}

fn write_u16_be(buf: &mut Vec<u8>, v: u16) {
    buf.push((v >> 8) as u8);
    buf.push(v as u8);
}

fn write_u32_be(buf: &mut Vec<u8>, v: u32) {
    buf.push((v >> 24) as u8);
    buf.push((v >> 16) as u8);
    buf.push((v >> 8) as u8);
    buf.push(v as u8);
}

/// Parse known table tag from flags byte (bits 0-5).
fn tag_from_flags_index(index: u8) -> Option<u32> {
    // WOFF2 known tags table (spec Table 3)
    const KNOWN_TAGS: &[u32] = &[
        0x636D6170, // cmap
        0x68656164, // head
        0x68686561, // hhea
        0x686D7478, // hmtx
        0x6D617870, // maxp
        0x6E616D65, // name
        0x4F532F32, // OS/2
        0x706F7374, // post
        0x63767420, // cvt
        0x6670676D, // fpgm
        0x676C7966, // glyf
        0x6C6F6361, // loca
        0x70726570, // prep
        0x43464620, // CFF
        0x56485141, // VHEA
        0x766D7478, // vmtx
        0x42415345, // BASE
        0x47444546, // GDEF
        0x47504F53, // GPOS
        0x47535542, // GSUB
        0x45425343, // EBSC
        0x4A535446, // JSTF
        0x4D415448, // MATH
        0x43424454, // CBDT
        0x43424C43, // CBLC
        0x434F4C52, // COLR
        0x43504154, // CPAT (CPAL)
        0x53564720, // SVG
        0x73626978, // sbix
        0x61636E74, // acnt
        0x61766172, // avar
        0x62646174, // bdat
        0x626C6F63, // bloc
        0x62736C6E, // bsln
        0x63686172, // char
        0x66656174, // feat
        0x67766172, // gvar
        0x6866656D, // hsty? skip for now
        0x6A757374, // just
        0x6B657278, // kerx
        0x6D6F7274, // mort
        0x6D6F7278, // morx
        0x6F706264, // opbd
        0x70726F70, // prop
        0x74726B68, // trak
        0x7A617066, // zapf
        0x53696C66, // Silf
        0x47617420, // Glat
        0x476C6F63, // Gloc
        0x46656174, // Feat
        0x53696C6C, // Sill
    ];
    KNOWN_TAGS.get(index as usize).copied()
}

/// Decode WOFF2 bytes to SFNT (OpenType) bytes.
/// Returns None if the data is not valid WOFF2 or decoding fails.
pub fn decode_woff2(woff2_data: &[u8]) -> Option<Vec<u8>> {
    let mut pos = 0;

    // Parse header (48 bytes)
    let signature = read_u32_be(woff2_data, &mut pos)?;
    if signature != WOFF2_SIGNATURE {
        return None;
    }

    let sfnt_version = read_u32_be(woff2_data, &mut pos)?;
    let _flavor = sfnt_version;
    let _length = read_u32_be(woff2_data, &mut pos)?;
    let num_tables = read_u16_be(woff2_data, &mut pos)?;
    let _reserved = read_u16_be(woff2_data, &mut pos)?;
    let total_sfnt_size = read_u32_be(woff2_data, &mut pos)?;
    let _ = total_sfnt_size;
    let _total_compressed_size = read_u32_be(woff2_data, &mut pos)?;
    // major/minor version
    let _major = read_u16_be(woff2_data, &mut pos)?;
    let _minor = read_u16_be(woff2_data, &mut pos)?;
    let meta_offset = read_u32_be(woff2_data, &mut pos)?;
    let meta_length = read_u32_be(woff2_data, &mut pos)?;
    let _meta_orig_length = read_u32_be(woff2_data, &mut pos)?;
    let priv_offset = read_u32_be(woff2_data, &mut pos)?;
    let priv_length = read_u32_be(woff2_data, &mut pos)?;

    let _ = (meta_offset, meta_length, priv_offset, priv_length);

    // Parse table directory
    let mut tables: Vec<TableEntry> = Vec::with_capacity(num_tables as usize);
    let mut compressed_data_offset = 0u32;

    for _ in 0..num_tables {
        let flags_byte = read_u8(woff2_data, &mut pos)?;
        let tag_index = flags_byte & 0x3F;
        let transform_version = (flags_byte >> 6) & 0x03;

        let tag = if tag_index == 63 {
            // Arbitrary tag follows
            read_u32_be(woff2_data, &mut pos)?
        } else {
            tag_from_flags_index(tag_index)?
        };

        let orig_length = read_uint_base128(woff2_data, &mut pos)?;
        let transform_length = if has_transform(tag, transform_version) {
            Some(read_uint_base128(woff2_data, &mut pos)?)
        } else {
            None
        };

        let data_len = transform_length.unwrap_or(orig_length) as usize;

        tables.push(TableEntry {
            tag,
            flags: flags_byte,
            transform_length,
            orig_length,
            data_start: compressed_data_offset as usize,
            data_len,
        });

        compressed_data_offset += data_len as u32;
    }

    // Everything after the table directory is the compressed block
    let compressed_block = &woff2_data[pos..];

    // Decompress via Brotli
    let total_needed = compressed_data_offset as usize;
    let mut decompressed = vec![0u8; total_needed];
    {
        let mut reader = brotli::Decompressor::new(compressed_block, 4096);
        let mut written = 0;
        loop {
            if written >= total_needed {
                break;
            }
            let n = reader.read(&mut decompressed[written..]).ok()?;
            if n == 0 {
                break;
            }
            written += n;
        }
        if written < total_needed {
            return None;
        }
    }

    // Now build the SFNT output.
    // For most CFF fonts, tables have no transform (transform_version = 0 for all).
    // For TrueType, glyf/loca may have transforms that we need to invert.
    let _is_truetype = sfnt_version == SFNT_VERSION_TRUETYPE || sfnt_version == 0x74727565; // 'true'

    // Reconstruct table data (apply inverse transforms if needed)
    let mut table_data: Vec<(u32, Vec<u8>)> = Vec::with_capacity(tables.len());
    let mut head_index_hint: Option<usize> = None;
    let mut glyf_table_idx: Option<usize> = None;
    let mut loca_table_idx: Option<usize> = None;
    let mut glyf_transformed: Option<Vec<u8>> = None;

    for (i, entry) in tables.iter().enumerate() {
        let raw = &decompressed[entry.data_start..entry.data_start + entry.data_len];
        let transform_version = (entry.flags >> 6) & 0x03;

        if entry.tag == TAG_HEAD {
            head_index_hint = Some(table_data.len());
        }

        let data = match entry.tag {
            TAG_GLYF if entry.transform_length.is_some() => {
                glyf_table_idx = Some(table_data.len());
                glyf_transformed = Some(raw.to_vec());
                vec![]
            }
            TAG_LOCA if entry.transform_length.is_some() => {
                loca_table_idx = Some(table_data.len());
                vec![]
            }
            _ if entry.transform_length.is_some() && transform_version != 0 => {
                raw.to_vec()
            }
            _ => raw.to_vec(),
        };

        table_data.push((entry.tag, data));
        let _ = (head_index_hint, i);
    }

    if let (Some(gi), Some(transformed)) = (glyf_table_idx, glyf_transformed) {
        if let Some((glyf, loca, idx_fmt)) = reconstruct_glyf_loca(&transformed) {
            table_data[gi].1 = glyf;
            if let Some(li) = loca_table_idx {
                table_data[li].1 = loca;
            } else {
                table_data.push((TAG_LOCA, loca));
            }
            if let Some(hi) = head_index_hint {
                let head = &mut table_data[hi].1;
                if head.len() >= 52 {
                    head[50] = (idx_fmt >> 8) as u8;
                    head[51] = idx_fmt as u8;
                }
            }
        }
    }

    // Assemble SFNT binary
    build_sfnt(sfnt_version, &table_data)
}

/// Returns true if the given (tag, transform_version) has a transform_length field.
fn has_transform(tag: u32, transform_version: u8) -> bool {
    // Per spec: glyf and loca have transforms when transform_version != 3
    // All other tables have transforms when transform_version != 0
    match tag {
        TAG_GLYF | TAG_LOCA => transform_version != 3,
        _ => transform_version != 0,
    }
}

fn decode_triplet(flag: usize, data: &[u8], pos: &mut usize) -> Option<(i32, i32)> {
    fn with_sign(positive: bool, val: i32) -> i32 {
        if positive { val } else { -val }
    }

    if flag < 10 {
        let b0 = *data.get(*pos)? as i32;
        *pos += 1;
        let dy = with_sign(flag & 1 != 0, ((flag as i32 & 14) << 7) + b0);
        Some((0, dy))
    } else if flag < 20 {
        let b0 = *data.get(*pos)? as i32;
        *pos += 1;
        let f = (flag - 10) as i32;
        let dx = with_sign(flag & 1 != 0, ((f & 14) << 7) + b0);
        Some((dx, 0))
    } else if flag < 84 {
        let b1 = *data.get(*pos)? as i32;
        *pos += 1;
        let b0 = (flag - 20) as i32;
        let dx = with_sign(flag & 1 != 0, 1 + (b0 & 0x30) + (b1 >> 4));
        let dy = with_sign((flag >> 1) & 1 != 0, 1 + ((b0 & 0x0C) << 2) + (b1 & 0x0F));
        Some((dx, dy))
    } else if flag < 120 {
        let d0 = *data.get(*pos)? as i32;
        let d1 = *data.get(*pos + 1)? as i32;
        *pos += 2;
        let b0 = (flag - 84) as i32;
        let dx = with_sign(flag & 1 != 0, 1 + ((b0 / 12) << 8) + d0);
        let dy = with_sign((flag >> 1) & 1 != 0, 1 + (((b0 % 12) >> 2) << 8) + d1);
        Some((dx, dy))
    } else if flag < 124 {
        let d0 = *data.get(*pos)? as i32;
        let d1 = *data.get(*pos + 1)? as i32;
        let d2 = *data.get(*pos + 2)? as i32;
        *pos += 3;
        let dx = with_sign(flag & 1 != 0, 1 + (d0 << 4) + (d1 >> 4));
        let dy = with_sign((flag >> 1) & 1 != 0, 1 + ((d1 & 0x0F) << 8) + d2);
        Some((dx, dy))
    } else {
        let d0 = *data.get(*pos)? as i32;
        let d1 = *data.get(*pos + 1)? as i32;
        let d2 = *data.get(*pos + 2)? as i32;
        let d3 = *data.get(*pos + 3)? as i32;
        *pos += 4;
        let dx = with_sign(flag & 1 != 0, 1 + (d0 << 8) + d1);
        let dy = with_sign((flag >> 1) & 1 != 0, 1 + (d2 << 8) + d3);
        Some((dx, dy))
    }
}

/// Reconstruct standard glyf and loca tables from WOFF2 transformed glyf data.
/// Returns `(glyf_bytes, loca_bytes, index_format)`.
fn reconstruct_glyf_loca(transformed: &[u8]) -> Option<(Vec<u8>, Vec<u8>, u16)> {
    if transformed.len() < 36 {
        return None;
    }

    let mut pos = 0;
    let version = read_u32_be(transformed, &mut pos)?;
    if version != 0 {
        return None;
    }
    let _reserved = read_u16_be(transformed, &mut pos)?;
    let option_flags = read_u16_be(transformed, &mut pos)?;
    let num_glyphs = read_u16_be(transformed, &mut pos)? as usize;
    let index_format = read_u16_be(transformed, &mut pos)?;

    let nc_size = read_u32_be(transformed, &mut pos)? as usize;
    let np_size = read_u32_be(transformed, &mut pos)? as usize;
    let fl_size = read_u32_be(transformed, &mut pos)? as usize;
    let gl_size = read_u32_be(transformed, &mut pos)? as usize;
    let co_size = read_u32_be(transformed, &mut pos)? as usize;
    let bb_size = read_u32_be(transformed, &mut pos)? as usize;
    let in_size = read_u32_be(transformed, &mut pos)? as usize;

    let total = nc_size + np_size + fl_size + gl_size + co_size + bb_size + in_size;
    if pos + total > transformed.len() {
        return None;
    }

    let nc_stream = &transformed[pos..pos + nc_size];
    let np_stream = &transformed[pos + nc_size..pos + nc_size + np_size];
    let fl_stream = &transformed[pos + nc_size + np_size..pos + nc_size + np_size + fl_size];
    let gl_stream = &transformed[pos + nc_size + np_size + fl_size..pos + nc_size + np_size + fl_size + gl_size];
    let co_stream = &transformed[pos + nc_size + np_size + fl_size + gl_size..pos + nc_size + np_size + fl_size + gl_size + co_size];
    let bb_stream = &transformed[pos + nc_size + np_size + fl_size + gl_size + co_size..pos + nc_size + np_size + fl_size + gl_size + co_size + bb_size];
    let in_stream = &transformed[pos + nc_size + np_size + fl_size + gl_size + co_size + bb_size..pos + total];

    let mut contour_counts: Vec<i16> = Vec::with_capacity(num_glyphs);
    let mut nc_pos = 0;
    for _ in 0..num_glyphs {
        let val = read_u16_be(nc_stream, &mut nc_pos)? as i16;
        contour_counts.push(val);
    }

    let bbox_bitmap_len = if bb_size > 0 { (num_glyphs + 7) / 8 } else { 0 };
    if bb_stream.len() < bbox_bitmap_len {
        return None;
    }

    let mut np_pos: usize = 0;
    let mut fl_pos: usize = 0;
    let mut gl_pos: usize = 0;
    let mut co_pos: usize = 0;
    let mut bb_pos: usize = bbox_bitmap_len;
    let mut in_pos: usize = 0;

    let overlap_bit = (option_flags & 1) != 0;

    let mut glyf = Vec::new();
    let mut offsets: Vec<u32> = Vec::with_capacity(num_glyphs + 1);

    for i in 0..num_glyphs {
        offsets.push(glyf.len() as u32);
        let nc = contour_counts[i];

        let has_bbox = if bbox_bitmap_len > 0 {
            (bb_stream[i / 8] >> (7 - (i % 8))) & 1 != 0
        } else {
            false
        };

        if nc == 0 {
            continue;
        }

        if nc > 0 {
            // Simple glyph
            let num_c = nc as usize;
            let mut pts_per_contour = Vec::with_capacity(num_c);
            let mut total_pts = 0usize;
            for _ in 0..num_c {
                let n = read_255_uint16(np_stream, &mut np_pos)? as usize;
                total_pts += n;
                pts_per_contour.push(n);
            }

            let mut xs: Vec<i16> = Vec::with_capacity(total_pts);
            let mut ys: Vec<i16> = Vec::with_capacity(total_pts);
            let mut on_curves: Vec<bool> = Vec::with_capacity(total_pts);
            let mut x_acc: i32 = 0;
            let mut y_acc: i32 = 0;

            for _ in 0..total_pts {
                let flag = *fl_stream.get(fl_pos)?;
                fl_pos += 1;
                let on_curve = (flag & 0x80) == 0;
                let (dx, dy) = decode_triplet((flag & 0x7F) as usize, gl_stream, &mut gl_pos)?;
                x_acc += dx;
                y_acc += dy;
                xs.push(x_acc as i16);
                ys.push(y_acc as i16);
                on_curves.push(on_curve);
            }

            let instr_len = read_255_uint16(gl_stream, &mut gl_pos)? as usize;

            let (x_min, y_min, x_max, y_max) = if has_bbox {
                let xn = read_u16_be(bb_stream, &mut bb_pos)? as i16;
                let yn = read_u16_be(bb_stream, &mut bb_pos)? as i16;
                let xx = read_u16_be(bb_stream, &mut bb_pos)? as i16;
                let yx = read_u16_be(bb_stream, &mut bb_pos)? as i16;
                (xn, yn, xx, yx)
            } else {
                let mut xn = i16::MAX;
                let mut yn = i16::MAX;
                let mut xx = i16::MIN;
                let mut yx = i16::MIN;
                for j in 0..total_pts {
                    xn = xn.min(xs[j]);
                    yn = yn.min(ys[j]);
                    xx = xx.max(xs[j]);
                    yx = yx.max(ys[j]);
                }
                if total_pts == 0 { (0, 0, 0, 0) } else { (xn, yn, xx, yx) }
            };

            // glyf header
            glyf.extend_from_slice(&nc.to_be_bytes());
            glyf.extend_from_slice(&x_min.to_be_bytes());
            glyf.extend_from_slice(&y_min.to_be_bytes());
            glyf.extend_from_slice(&x_max.to_be_bytes());
            glyf.extend_from_slice(&y_max.to_be_bytes());

            // endPtsOfContours
            let mut cumulative: usize = 0;
            for &n in &pts_per_contour {
                cumulative += n;
                if cumulative == 0 {
                    return None;
                }
                glyf.extend_from_slice(&((cumulative - 1) as u16).to_be_bytes());
            }

            // instructions
            glyf.extend_from_slice(&(instr_len as u16).to_be_bytes());
            if instr_len > 0 {
                if in_pos + instr_len > in_stream.len() {
                    return None;
                }
                glyf.extend_from_slice(&in_stream[in_pos..in_pos + instr_len]);
                in_pos += instr_len;
            }

            // delta-encode coordinates for standard glyf format
            let mut prev_x: i16 = 0;
            let mut prev_y: i16 = 0;
            let mut glyf_flags: Vec<u8> = Vec::with_capacity(total_pts);
            let mut x_data: Vec<u8> = Vec::new();
            let mut y_data: Vec<u8> = Vec::new();

            for j in 0..total_pts {
                let dx = xs[j].wrapping_sub(prev_x);
                let dy = ys[j].wrapping_sub(prev_y);
                prev_x = xs[j];
                prev_y = ys[j];

                let mut flag: u8 = 0;
                if on_curves[j] {
                    flag |= 0x01;
                }
                if j == 0 && overlap_bit {
                    flag |= 0x40;
                }

                if dx == 0 {
                    flag |= 0x10;
                } else if (-255..=255).contains(&dx) {
                    flag |= 0x02;
                    if dx > 0 {
                        flag |= 0x10;
                    }
                    x_data.push(dx.unsigned_abs() as u8);
                } else {
                    x_data.extend_from_slice(&dx.to_be_bytes());
                }

                if dy == 0 {
                    flag |= 0x20;
                } else if (-255..=255).contains(&dy) {
                    flag |= 0x04;
                    if dy > 0 {
                        flag |= 0x20;
                    }
                    y_data.push(dy.unsigned_abs() as u8);
                } else {
                    y_data.extend_from_slice(&dy.to_be_bytes());
                }

                glyf_flags.push(flag);
            }

            glyf.extend_from_slice(&glyf_flags);
            glyf.extend_from_slice(&x_data);
            glyf.extend_from_slice(&y_data);

            if glyf.len() % 2 != 0 {
                glyf.push(0);
            }
        } else {
            // Composite glyph (nc == -1)
            let (x_min, y_min, x_max, y_max) = if has_bbox {
                let xn = read_u16_be(bb_stream, &mut bb_pos)? as i16;
                let yn = read_u16_be(bb_stream, &mut bb_pos)? as i16;
                let xx = read_u16_be(bb_stream, &mut bb_pos)? as i16;
                let yx = read_u16_be(bb_stream, &mut bb_pos)? as i16;
                (xn, yn, xx, yx)
            } else {
                (0i16, 0i16, 0i16, 0i16)
            };

            glyf.extend_from_slice(&(-1i16).to_be_bytes());
            glyf.extend_from_slice(&x_min.to_be_bytes());
            glyf.extend_from_slice(&y_min.to_be_bytes());
            glyf.extend_from_slice(&x_max.to_be_bytes());
            glyf.extend_from_slice(&y_max.to_be_bytes());

            let mut last_flags_offset: usize;
            loop {
                if co_pos + 4 > co_stream.len() {
                    return None;
                }
                last_flags_offset = glyf.len();
                let flags = u16::from_be_bytes([co_stream[co_pos], co_stream[co_pos + 1]]);
                let more = (flags & 0x0020) != 0;

                glyf.extend_from_slice(&co_stream[co_pos..co_pos + 4]);
                co_pos += 4;

                let arg_size = if flags & 0x0001 != 0 { 4 } else { 2 };
                let xform_size = if flags & 0x0008 != 0 {
                    2
                } else if flags & 0x0040 != 0 {
                    4
                } else if flags & 0x0080 != 0 {
                    8
                } else {
                    0
                };
                let extra = arg_size + xform_size;
                if co_pos + extra > co_stream.len() {
                    return None;
                }
                glyf.extend_from_slice(&co_stream[co_pos..co_pos + extra]);
                co_pos += extra;

                if !more {
                    break;
                }
            }

            let instr_len = read_255_uint16(gl_stream, &mut gl_pos)? as usize;
            if instr_len > 0 {
                let old = u16::from_be_bytes([glyf[last_flags_offset], glyf[last_flags_offset + 1]]);
                let patched = old | 0x0100;
                glyf[last_flags_offset] = (patched >> 8) as u8;
                glyf[last_flags_offset + 1] = patched as u8;
                glyf.extend_from_slice(&(instr_len as u16).to_be_bytes());
                if in_pos + instr_len > in_stream.len() {
                    return None;
                }
                glyf.extend_from_slice(&in_stream[in_pos..in_pos + instr_len]);
                in_pos += instr_len;
            }

            if glyf.len() % 2 != 0 {
                glyf.push(0);
            }
        }
    }

    offsets.push(glyf.len() as u32);

    let loca = if index_format == 0 {
        let mut l = Vec::with_capacity(offsets.len() * 2);
        for &off in &offsets {
            l.extend_from_slice(&((off / 2) as u16).to_be_bytes());
        }
        l
    } else {
        let mut l = Vec::with_capacity(offsets.len() * 4);
        for &off in &offsets {
            l.extend_from_slice(&off.to_be_bytes());
        }
        l
    };

    Some((glyf, loca, index_format))
}

/// Build an SFNT binary from a list of (tag, data) pairs.
fn build_sfnt(sfnt_version: u32, tables: &[(u32, Vec<u8>)]) -> Option<Vec<u8>> {
    // Filter out zero-length tables (loca placeholder, etc.)
    let valid_tables: Vec<&(u32, Vec<u8>)> = tables.iter()
        .filter(|(_, d)| !d.is_empty())
        .collect();

    let n = valid_tables.len() as u16;
    let search_range = (n.next_power_of_two() / 2) * 16;
    let entry_selector = (n.next_power_of_two() / 2).trailing_zeros() as u16;
    let range_shift = n * 16 - search_range;

    let table_directory_size = 12 + n as usize * 16;
    let mut offsets: Vec<u32> = Vec::with_capacity(n as usize);
    let mut current_offset = table_directory_size as u32;

    for (_, data) in &valid_tables {
        offsets.push(current_offset);
        current_offset += (data.len() as u32 + 3) & !3; // 4-byte aligned
    }

    let total_size = current_offset as usize;
    let mut out = Vec::with_capacity(total_size);

    // SFNT header
    write_u32_be(&mut out, sfnt_version);
    write_u16_be(&mut out, n);
    write_u16_be(&mut out, search_range);
    write_u16_be(&mut out, entry_selector);
    write_u16_be(&mut out, range_shift);

    // Table records (sorted by tag for spec compliance)
    let mut sorted: Vec<(usize, u32, u32)> = valid_tables.iter().enumerate()
        .zip(offsets.iter())
        .map(|((i, (tag, _)), off)| (i, *tag, *off))
        .collect();
    sorted.sort_by_key(|(_, tag, _)| *tag);

    for &(i, tag, offset) in &sorted {
        let data = &valid_tables[i].1;
        let checksum = compute_checksum(data);
        let length = data.len() as u32;

        write_u32_be(&mut out, tag);
        write_u32_be(&mut out, checksum);
        write_u32_be(&mut out, offset);
        write_u32_be(&mut out, length);
    }

    // Table data (in sorted order)
    for &(i, _, _) in &sorted {
        let data = &valid_tables[i].1;
        out.extend_from_slice(data);
        // Pad to 4-byte boundary
        let pad = (4 - (data.len() % 4)) % 4;
        for _ in 0..pad {
            out.push(0);
        }
    }

    // Fix head table checkSumAdjustment
    fix_head_checksum(&mut out);

    Some(out)
}

fn compute_checksum(data: &[u8]) -> u32 {
    let mut sum: u32 = 0;
    let mut i = 0;
    while i + 4 <= data.len() {
        let v = u32::from_be_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]);
        sum = sum.wrapping_add(v);
        i += 4;
    }
    if i < data.len() {
        let mut last = [0u8; 4];
        last[..data.len() - i].copy_from_slice(&data[i..]);
        sum = sum.wrapping_add(u32::from_be_bytes(last));
    }
    sum
}

fn fix_head_checksum(sfnt: &mut [u8]) {
    // Compute whole-font checksum and write to head.checkSumAdjustment
    // head.checkSumAdjustment is at offset 8 within the head table data.
    // Find the head table offset from the directory.
    if sfnt.len() < 12 {
        return;
    }
    let n_tables = u16::from_be_bytes([sfnt[4], sfnt[5]]) as usize;
    let head_tag = 0x68656164u32;
    let mut head_data_offset: Option<usize> = None;

    for i in 0..n_tables {
        let rec_start = 12 + i * 16;
        if rec_start + 16 > sfnt.len() {
            break;
        }
        let tag = u32::from_be_bytes([sfnt[rec_start], sfnt[rec_start+1], sfnt[rec_start+2], sfnt[rec_start+3]]);
        if tag == head_tag {
            let off = u32::from_be_bytes([sfnt[rec_start+8], sfnt[rec_start+9], sfnt[rec_start+10], sfnt[rec_start+11]]) as usize;
            head_data_offset = Some(off);
            break;
        }
    }

    let head_off = match head_data_offset {
        Some(o) if o + 12 <= sfnt.len() => o,
        _ => return,
    };

    // Zero checkSumAdjustment before computing
    sfnt[head_off + 8] = 0;
    sfnt[head_off + 9] = 0;
    sfnt[head_off + 10] = 0;
    sfnt[head_off + 11] = 0;

    let checksum = compute_checksum(sfnt);
    let adj = 0xB1B0AFBAu32.wrapping_sub(checksum);
    sfnt[head_off + 8] = (adj >> 24) as u8;
    sfnt[head_off + 9] = (adj >> 16) as u8;
    sfnt[head_off + 10] = (adj >> 8) as u8;
    sfnt[head_off + 11] = adj as u8;
}

/// Check if data starts with the WOFF2 magic signature.
pub fn is_woff2(data: &[u8]) -> bool {
    data.len() >= 4 && data[0] == b'w' && data[1] == b'O' && data[2] == b'F' && data[3] == b'2'
}
