/// Minimal WOFF2 → SFNT decoder for Google Fonts compatibility.
///
/// WOFF2 spec: https://www.w3.org/TR/WOFF2/
/// We support CFF (OTF) and TrueType fonts. The glyf/loca tables in TrueType
/// fonts may use composite glyph transformation, which we handle via a
/// reconstructed loca/glyf pass. For CFF fonts no special handling is needed.
use std::io::Read;

const WOFF2_SIGNATURE: u32 = 0x774F4632; // 'wOF2'

// Known WOFF2 table tags
const TAG_GLYF: u32 = 0x676C7966;
const TAG_LOCA: u32 = 0x6C6F6361;
const TAG_HEAD: u32 = 0x68656164;
const TAG_HHEA: u32 = 0x68686561;
const TAG_HMTX: u32 = 0x686D7478;
const TAG_MAXP: u32 = 0x6D617870;

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

/// WOFF2 known table tags (spec section 5.1, Table 3). A table directory
/// entry's flags byte stores the index into this list in bits 0-5; index 63
/// means an arbitrary 4-byte tag follows.
const KNOWN_TAGS: [[u8; 4]; 63] = [
    *b"cmap",
    *b"head",
    *b"hhea",
    *b"hmtx",
    *b"maxp",
    *b"name",
    *b"OS/2",
    *b"post",
    *b"cvt ",
    *b"fpgm",
    *b"glyf",
    *b"loca",
    *b"prep",
    *b"CFF ",
    *b"VORG",
    *b"EBDT",
    *b"EBLC",
    *b"gasp",
    *b"hdmx",
    *b"kern",
    *b"LTSH",
    *b"PCLT",
    *b"VDMX",
    *b"vhea",
    *b"vmtx",
    *b"BASE",
    *b"GDEF",
    *b"GPOS",
    *b"GSUB",
    *b"EBSC",
    *b"JSTF",
    *b"MATH",
    *b"CBDT",
    *b"CBLC",
    *b"COLR",
    *b"CPAL",
    *b"SVG ",
    *b"sbix",
    *b"acnt",
    *b"avar",
    *b"bdat",
    *b"bloc",
    *b"bsln",
    *b"cvar",
    *b"fdsc",
    *b"feat",
    *b"fmtx",
    *b"fvar",
    *b"gvar",
    *b"hsty",
    *b"just",
    *b"lcar",
    *b"mort",
    *b"morx",
    *b"opbd",
    *b"prop",
    *b"trak",
    *b"Zapf",
    *b"Silf",
    *b"Glat",
    *b"Gloc",
    *b"Feat",
    *b"Sill",
];

fn tag_from_flags_index(index: u8) -> Option<u32> {
    KNOWN_TAGS.get(index as usize).map(|t| u32::from_be_bytes(*t))
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

    let mut table_data: Vec<(u32, Vec<u8>)> = Vec::with_capacity(tables.len());
    let mut glyf_transformed: Option<&[u8]> = None;
    let mut hmtx_transformed: Option<&[u8]> = None;

    for entry in &tables {
        let raw = &decompressed[entry.data_start..entry.data_start + entry.data_len];
        let transform_version = (entry.flags >> 6) & 0x03;
        match entry.tag {
            // Placeholders filled in once glyf is reconstructed.
            TAG_GLYF if entry.transform_length.is_some() => glyf_transformed = Some(raw),
            TAG_LOCA if entry.transform_length.is_some() => {}
            TAG_HMTX if transform_version == 1 => hmtx_transformed = Some(raw),
            _ if entry.transform_length.is_some() => return None,
            _ => {
                table_data.push((entry.tag, raw.to_vec()));
                continue;
            }
        }
        table_data.push((entry.tag, Vec::new()));
    }

    if let Some(transformed) = glyf_transformed {
        let (glyf, loca, idx_fmt) = reconstruct_glyf_loca(transformed)?;
        let head = table_mut(&mut table_data, TAG_HEAD)?;
        if head.len() < 52 {
            return None;
        }
        head[50] = (idx_fmt >> 8) as u8;
        head[51] = idx_fmt as u8;
        *table_mut(&mut table_data, TAG_GLYF)? = glyf;
        match table_mut(&mut table_data, TAG_LOCA) {
            Some(slot) => *slot = loca,
            None => table_data.push((TAG_LOCA, loca)),
        }
    }

    if let Some(transformed) = hmtx_transformed {
        let hmtx = reconstruct_hmtx(transformed, &table_data)?;
        *table_mut(&mut table_data, TAG_HMTX)? = hmtx;
    }

    build_sfnt(sfnt_version, &table_data)
}

fn table_mut(tables: &mut [(u32, Vec<u8>)], tag: u32) -> Option<&mut Vec<u8>> {
    tables.iter_mut().find(|(t, _)| *t == tag).map(|(_, d)| d)
}

fn table_ref(tables: &[(u32, Vec<u8>)], tag: u32) -> Option<&[u8]> {
    tables.iter().find(|(t, _)| *t == tag).map(|(_, d)| d.as_slice())
}

/// Invert the WOFF2 hmtx transform (spec section 5.4): left side bearings the
/// encoder dropped are equal to each glyph's xMin in the (reconstructed) glyf.
fn reconstruct_hmtx(transformed: &[u8], tables: &[(u32, Vec<u8>)]) -> Option<Vec<u8>> {
    let hhea = table_ref(tables, TAG_HHEA)?;
    let maxp = table_ref(tables, TAG_MAXP)?;
    let head = table_ref(tables, TAG_HEAD)?;
    let glyf = table_ref(tables, TAG_GLYF)?;
    let loca = table_ref(tables, TAG_LOCA)?;
    let num_h_metrics = u16::from_be_bytes([*hhea.get(34)?, *hhea.get(35)?]) as usize;
    let num_glyphs = u16::from_be_bytes([*maxp.get(4)?, *maxp.get(5)?]) as usize;
    let long_loca = u16::from_be_bytes([*head.get(50)?, *head.get(51)?]) != 0;
    if num_h_metrics == 0 || num_h_metrics > num_glyphs {
        return None;
    }

    let x_min = |gid: usize| -> Option<i16> {
        let (start, end) = if long_loca {
            let at = |i: usize| -> Option<usize> {
                Some(u32::from_be_bytes([*loca.get(i * 4)?, *loca.get(i * 4 + 1)?, *loca.get(i * 4 + 2)?, *loca.get(i * 4 + 3)?]) as usize)
            };
            (at(gid)?, at(gid + 1)?)
        } else {
            let at = |i: usize| -> Option<usize> {
                Some(u16::from_be_bytes([*loca.get(i * 2)?, *loca.get(i * 2 + 1)?]) as usize * 2)
            };
            (at(gid)?, at(gid + 1)?)
        };
        if end <= start {
            return Some(0);
        }
        Some(i16::from_be_bytes([*glyf.get(start + 2)?, *glyf.get(start + 3)?]))
    };

    let mut pos = 0;
    let flags = read_u8(transformed, &mut pos)?;
    let mut advances = Vec::with_capacity(num_h_metrics);
    for _ in 0..num_h_metrics {
        advances.push(read_u16_be(transformed, &mut pos)?);
    }
    let mut lsbs = Vec::with_capacity(num_glyphs);
    for gid in 0..num_h_metrics {
        lsbs.push(if flags & 1 != 0 { x_min(gid)? } else { read_u16_be(transformed, &mut pos)? as i16 });
    }
    for gid in num_h_metrics..num_glyphs {
        lsbs.push(if flags & 2 != 0 { x_min(gid)? } else { read_u16_be(transformed, &mut pos)? as i16 });
    }

    let mut out = Vec::with_capacity(num_h_metrics * 4 + (num_glyphs - num_h_metrics) * 2);
    for (gid, lsb) in lsbs.iter().enumerate() {
        if gid < num_h_metrics {
            write_u16_be(&mut out, advances[gid]);
        }
        out.extend_from_slice(&lsb.to_be_bytes());
    }
    Some(out)
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
        let dx = with_sign(flag & 1 != 0, (d0 << 4) + (d1 >> 4));
        let dy = with_sign((flag >> 1) & 1 != 0, ((d1 & 0x0F) << 8) + d2);
        Some((dx, dy))
    } else {
        let d0 = *data.get(*pos)? as i32;
        let d1 = *data.get(*pos + 1)? as i32;
        let d2 = *data.get(*pos + 2)? as i32;
        let d3 = *data.get(*pos + 3)? as i32;
        *pos += 4;
        let dx = with_sign(flag & 1 != 0, (d0 << 8) + d1);
        let dy = with_sign((flag >> 1) & 1 != 0, (d2 << 8) + d3);
        Some((dx, dy))
    }
}

/// Reconstruct standard glyf and loca tables from WOFF2 transformed glyf data.
/// Returns `(glyf_bytes, loca_bytes, index_format)`.
fn reconstruct_glyf_loca(transformed: &[u8]) -> Option<(Vec<u8>, Vec<u8>, u16)> {
    let mut pos = 0;
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
    let has_overlap_bitmap = (option_flags & 1) != 0;
    let overlap_bitmap: &[u8] = if has_overlap_bitmap {
        transformed.get(pos + total..pos + total + (num_glyphs + 7) / 8)?
    } else {
        &[]
    };

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
                if j == 0 && has_overlap_bitmap && (overlap_bitmap[i / 8] >> (7 - (i % 8))) & 1 != 0 {
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
            // The spec requires an explicit bbox for every composite glyph.
            if !has_bbox {
                return None;
            }
            let x_min = read_u16_be(bb_stream, &mut bb_pos)? as i16;
            let y_min = read_u16_be(bb_stream, &mut bb_pos)? as i16;
            let x_max = read_u16_be(bb_stream, &mut bb_pos)? as i16;
            let y_max = read_u16_be(bb_stream, &mut bb_pos)? as i16;

            glyf.extend_from_slice(&(-1i16).to_be_bytes());
            glyf.extend_from_slice(&x_min.to_be_bytes());
            glyf.extend_from_slice(&y_min.to_be_bytes());
            glyf.extend_from_slice(&x_max.to_be_bytes());
            glyf.extend_from_slice(&y_max.to_be_bytes());

            let mut has_instructions = false;
            loop {
                if co_pos + 4 > co_stream.len() {
                    return None;
                }
                let flags = u16::from_be_bytes([co_stream[co_pos], co_stream[co_pos + 1]]);
                let more = (flags & 0x0020) != 0;
                has_instructions |= (flags & 0x0100) != 0;

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

            if has_instructions {
                let instr_len = read_255_uint16(gl_stream, &mut gl_pos)? as usize;
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

/// Build an SFNT binary from a list of (tag, data) pairs. Zero-length
/// tables (e.g. a transformed loca placeholder) are dropped; records and
/// data are both written in tag order as the OpenType spec requires.
pub(crate) fn build_sfnt(sfnt_version: u32, tables: &[(u32, Vec<u8>)]) -> Option<Vec<u8>> {
    let mut sorted: Vec<&(u32, Vec<u8>)> = tables.iter().filter(|(_, d)| !d.is_empty()).collect();
    sorted.sort_by_key(|(tag, _)| *tag);

    let n = u16::try_from(sorted.len()).ok()?;
    let max_pow2 = if n == 0 { 0 } else { 1u16 << (15 - n.leading_zeros()) };
    let search_range = max_pow2 * 16;
    let entry_selector = if max_pow2 == 0 { 0 } else { max_pow2.trailing_zeros() as u16 };
    let range_shift = n * 16 - search_range;

    let mut out = Vec::new();
    write_u32_be(&mut out, sfnt_version);
    write_u16_be(&mut out, n);
    write_u16_be(&mut out, search_range);
    write_u16_be(&mut out, entry_selector);
    write_u16_be(&mut out, range_shift);

    let mut offset = 12 + sorted.len() * 16;
    for (tag, data) in &sorted {
        write_u32_be(&mut out, *tag);
        write_u32_be(&mut out, compute_checksum(data));
        write_u32_be(&mut out, u32::try_from(offset).ok()?);
        write_u32_be(&mut out, data.len() as u32);
        offset += (data.len() + 3) & !3;
    }

    for (_, data) in &sorted {
        out.extend_from_slice(data);
        let pad = (4 - (data.len() % 4)) % 4;
        out.extend(std::iter::repeat(0u8).take(pad));
    }

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tag(t: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*t)
    }

    fn write_base128(buf: &mut Vec<u8>, mut v: u32) {
        let mut bytes = vec![(v & 0x7F) as u8];
        v >>= 7;
        while v > 0 {
            bytes.push(((v & 0x7F) as u8) | 0x80);
            v >>= 7;
        }
        bytes.reverse();
        buf.extend_from_slice(&bytes);
    }

    /// Encode `tables` as a WOFF2 file with every table stored untransformed
    /// (null transform for glyf/loca), using the known-tag index when the tag
    /// has one.
    fn encode_woff2(sfnt_version: u32, tables: &[(u32, Vec<u8>)]) -> Vec<u8> {
        let mut dir = Vec::new();
        let mut payload = Vec::new();
        for (t, data) in tables {
            let index = KNOWN_TAGS.iter().position(|k| u32::from_be_bytes(*k) == *t);
            let transform_bits = if *t == TAG_GLYF || *t == TAG_LOCA { 3u8 << 6 } else { 0 };
            match index {
                Some(i) => dir.push(i as u8 | transform_bits),
                None => {
                    dir.push(63 | transform_bits);
                    write_u32_be(&mut dir, *t);
                }
            }
            write_base128(&mut dir, data.len() as u32);
            payload.extend_from_slice(data);
        }
        let mut compressed = Vec::new();
        {
            let mut w = brotli::CompressorWriter::new(&mut compressed, 4096, 5, 22);
            w.write_all(&payload).unwrap();
        }
        let mut out = Vec::new();
        write_u32_be(&mut out, WOFF2_SIGNATURE);
        write_u32_be(&mut out, sfnt_version);
        write_u32_be(&mut out, 0); // length (unused by decoder)
        write_u16_be(&mut out, tables.len() as u16);
        write_u16_be(&mut out, 0);
        write_u32_be(&mut out, 0); // totalSfntSize
        write_u32_be(&mut out, compressed.len() as u32);
        write_u16_be(&mut out, 1);
        write_u16_be(&mut out, 0);
        for _ in 0..5 {
            write_u32_be(&mut out, 0); // meta / private block fields
        }
        out.extend_from_slice(&dir);
        out.extend_from_slice(&compressed);
        out
    }

    fn sfnt_tables(sfnt: &[u8]) -> Vec<(u32, Vec<u8>)> {
        let n = u16::from_be_bytes([sfnt[4], sfnt[5]]) as usize;
        (0..n)
            .map(|i| {
                let r = 12 + i * 16;
                let be = |o: usize| u32::from_be_bytes([sfnt[o], sfnt[o + 1], sfnt[o + 2], sfnt[o + 3]]);
                let off = be(r + 8) as usize;
                let len = be(r + 12) as usize;
                (be(r), sfnt[off..off + len].to_vec())
            })
            .collect()
    }

    #[test]
    fn known_tag_indices_follow_the_spec_table() {
        let expect = |i: u8, t: &[u8; 4]| assert_eq!(tag_from_flags_index(i), Some(tag(t)), "index {i}");
        expect(0, b"cmap");
        expect(10, b"glyf");
        expect(13, b"CFF ");
        expect(14, b"VORG");
        expect(17, b"gasp");
        expect(19, b"kern");
        expect(23, b"vhea");
        expect(24, b"vmtx");
        expect(26, b"GDEF");
        expect(27, b"GPOS");
        expect(28, b"GSUB");
        expect(35, b"CPAL");
        expect(39, b"avar");
        expect(43, b"cvar");
        expect(47, b"fvar");
        expect(48, b"gvar");
        expect(57, b"Zapf");
        expect(62, b"Sill");
    }

    #[test]
    fn index_63_is_not_a_known_tag() {
        assert_eq!(KNOWN_TAGS.len(), 63);
        assert_eq!(tag_from_flags_index(63), None);
    }

    #[test]
    fn decoded_tables_keep_their_tags_and_bytes() {
        let tables: Vec<(u32, Vec<u8>)> = [b"gasp", b"kern", b"GDEF", b"GPOS", b"GSUB", b"fvar", b"gvar", b"HVAR"]
            .iter()
            .enumerate()
            .map(|(i, t)| (tag(t), vec![i as u8 + 1; 8 + i * 4]))
            .collect();
        let sfnt = decode_woff2(&encode_woff2(0x0001_0000, &tables)).expect("decodes");
        let mut decoded = sfnt_tables(&sfnt);
        decoded.sort_by_key(|(t, _)| *t);
        let mut expected = tables.clone();
        expected.sort_by_key(|(t, _)| *t);
        assert_eq!(decoded, expected);
    }

    #[test]
    fn real_truetype_font_round_trips_through_woff2() {
        let ttf: &[u8] = include_bytes!("fonts/Inter-Regular.ttf");
        let tables = sfnt_tables(ttf);
        let woff2 = encode_woff2(0x0001_0000, &tables);
        let sfnt = decode_woff2(&woff2).expect("decodes");

        let mut db = cosmic_text::fontdb::Database::new();
        db.load_font_data(sfnt.clone());
        let face = db.faces().next().expect("decoded font parses as a face");
        assert!(face.families.iter().any(|(name, _)| name == "Inter"));

        let mut decoded_tags: Vec<u32> = sfnt_tables(&sfnt).into_iter().map(|(t, _)| t).collect();
        let mut original_tags: Vec<u32> = tables.iter().map(|(t, _)| *t).collect();
        decoded_tags.sort_unstable();
        original_tags.sort_unstable();
        assert_eq!(decoded_tags, original_tags);
    }

    #[test]
    fn google_fonts_woff2_with_gasp_kern_and_gsub_decodes_to_a_usable_face() {
        // css2 latin subset of IM Fell DW Pica SC: its table directory uses
        // known-tag indices 17 (gasp), 19 (kern) and 28 (GSUB), which the
        // old tag table mapped to the wrong tables.
        let woff2: &[u8] = include_bytes!("../tests/fixtures/IMFellDWPicaSC-latin.woff2");
        let sfnt = decode_woff2(woff2).expect("decodes");
        let tags: Vec<u32> = sfnt_tables(&sfnt).into_iter().map(|(t, _)| t).collect();
        for t in [b"gasp", b"kern", b"GSUB", b"glyf", b"loca", b"cmap"] {
            assert!(tags.contains(&tag(t)), "missing {}", String::from_utf8_lossy(t));
        }
        assert!(!tags.contains(&tag(b"sbix")));

        let mut db = cosmic_text::fontdb::Database::new();
        db.load_font_data(sfnt);
        let face = db.faces().next().expect("decoded font parses as a face");
        let family = &face.families[0].0;
        assert!(family.eq_ignore_ascii_case("IM Fell DW Pica SC"), "family {family}");
    }
}
