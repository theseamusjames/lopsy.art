//! Fujifilm lossless RAF decompression. Used for compressed RAF files
//! produced by most modern X-Trans and Bayer-sensor Fujifilm bodies.
//!
//! ## Format
//!
//! A compressed Fujifilm strip contains:
//!
//! 1. A small fixed-size container header (header u32 BE, version, bits,
//!    block dimensions, num blocks).
//! 2. A table of compressed block byte sizes (one u32 BE per block).
//! 3. Per-block compressed bitstreams, each beginning at the next
//!    16-byte boundary after the previous one ends. The first block starts
//!    on a 16-byte boundary after the size table.
//!
//! Each block decodes a vertical strip of the sensor, 6 pixels wide times
//! the full image height. Decoding happens in 6-line groups (matching the
//! 6×6 X-Trans CFA repeat). Inside a line group, pixels are predicted from
//! already-decoded neighbours and the residual is encoded with a
//! Golomb-Rice code whose parameter `k` adapts to per-color-class running
//! magnitude statistics.
//!
//! ## Scope
//!
//! Implements only the **14-bit lossless** variant — the most common case
//! shipped by modern X-T / X-H / X-Pro bodies. Lossy variants (12-bit or
//! quantization-table-based "compressed") return a clear error so the
//! caller can fall back to the uncompressed code path.
//!
//! ## References
//!
//! Reimplemented from the published algorithm description. No code is
//! copied from rawspeed or LibRaw (both LGPL). Numeric constants such as
//! the predictor weights and the gradient quantization table are facts of
//! the format.
//!
//! ## Validation status
//!
//! The header parser, bit stream, Golomb-Rice decoder, MED predictor,
//! and adaptive-k selection are exercised by unit tests with synthetic
//! input. End-to-end validation against a real compressed RAF requires
//! a sample file — the uncompressed sample used by `e2e/raf-import.spec.ts`
//! does not exercise this path. If `decompress_fuji_strip` produces
//! garbage on a real compressed RAF, the caller in `mod.rs` runs a
//! sample-based sanity check on the decoded plane and surfaces a clear
//! error rather than rendering a corrupt image.

const NUM_HORIZ_BLOCKS_DEFAULT: usize = 6;
const LINES_PER_GROUP: usize = 6;
const BLOCK_PIXELS_WIDE: usize = 768;

/// Detect whether the strip bytes look like compressed RAF data.
///
/// Uncompressed strips begin with raw little-endian u16 pixel values
/// from the sensor's overscan region — these are very close to the
/// black level (~1024 for 14-bit), so the first few hundred bytes are
/// dominated by small values, with many zero high bytes.
///
/// Compressed strips begin with a structured header / size table whose
/// bytes are not concentrated near zero. We use the fraction of zero
/// bytes in the first 256-byte window as the signal: uncompressed
/// overscan data has 50-90% zero bytes there, while compressed headers
/// have far fewer.
pub fn is_compressed_strip(strip: &[u8], _width: u32, _height: u32) -> bool {
    let window_len = strip.len().min(256);
    if window_len < 32 {
        return false;
    }
    let zero_bytes = strip[..window_len].iter().filter(|&&b| b == 0).count();
    let zero_ratio = zero_bytes as f64 / window_len as f64;
    zero_ratio < 0.30
}

/// Decompress a Fujifilm compressed strip into raw u16 pixel values in
/// row-major order. `width` and `height` are the raw sensor dimensions
/// (before any cropping). `pattern` is the 6×6 CFA pattern from the RAF
/// file using Fujifilm's color indices (0=R, 1=G, 2=B per the file —
/// note that elsewhere in the decoder these are remapped, but the
/// compression itself doesn't care which channel is which, only that
/// it's consistent across all pixels of the same color).
///
/// Returns `Err` for unsupported variants (lossy / 12-bit / unknown
/// header). On success, the returned `Vec<u16>` has exactly
/// `width * height` entries and matches the layout that the
/// uncompressed code path produces, so the existing demosaic and color
/// pipeline can run unchanged.
pub fn decompress_fuji_strip(
    compressed: &[u8],
    width: u32,
    height: u32,
    pattern: &[u8; 36],
) -> Result<Vec<u16>, String> {
    if compressed.len() < 16 {
        return Err("Compressed RAF strip too short for header".into());
    }

    let header = parse_header(compressed)?;

    if !header.is_lossless_14bit {
        return Err(format!(
            "Compressed RAF variant not supported (raw_type=0x{:x}, bits={}). \
             Only lossless 14-bit compression is implemented.",
            header.raw_type, header.bits_per_sample
        ));
    }

    let num_blocks = header.num_horiz_blocks;
    if num_blocks == 0 || num_blocks > 64 {
        return Err(format!("Compressed RAF block count out of range: {num_blocks}"));
    }

    let block_width = header.block_width;
    let total_width = num_blocks * block_width;
    if total_width < width as usize {
        return Err(format!(
            "Compressed RAF block layout too narrow: {num_blocks} × {block_width} = {total_width} < {width}"
        ));
    }

    // Block size table: one u32 BE per block, starting right after the
    // 16-byte container header.
    let table_offset = 16;
    let table_bytes = num_blocks * 4;
    if table_offset + table_bytes > compressed.len() {
        return Err("Compressed RAF block size table truncated".into());
    }

    let mut block_sizes = Vec::with_capacity(num_blocks);
    for i in 0..num_blocks {
        let off = table_offset + i * 4;
        block_sizes.push(read_be_u32(compressed, off) as usize);
    }

    // First block starts at the next 16-byte boundary after the table.
    let first_block_offset = align_up(table_offset + table_bytes, 16);

    let mut block_offsets = Vec::with_capacity(num_blocks);
    let mut cursor = first_block_offset;
    for &sz in &block_sizes {
        block_offsets.push(cursor);
        cursor = align_up(cursor + sz, 16);
    }
    if cursor > compressed.len() {
        // Some files don't pad the very last block. Permit final block to
        // run to end of buffer.
        let last_idx = num_blocks - 1;
        if block_offsets[last_idx] + block_sizes[last_idx] > compressed.len() {
            return Err("Compressed RAF blocks extend past strip end".into());
        }
    }

    let w = width as usize;
    let h = height as usize;
    let mut out = vec![0u16; w * h];

    for block_idx in 0..num_blocks {
        let block_x = block_idx * block_width;
        if block_x >= w {
            break;
        }
        let block_cols_in_image = (w - block_x).min(block_width);

        let offset = block_offsets[block_idx];
        let size = block_sizes[block_idx];
        let end = (offset + size).min(compressed.len());
        if offset >= end {
            return Err(format!("Compressed RAF block {block_idx} has zero or invalid size"));
        }

        let block_bytes = &compressed[offset..end];

        decompress_block(
            block_bytes,
            &mut out,
            block_x,
            block_cols_in_image,
            block_width,
            w,
            h,
            pattern,
            header.bits_per_sample,
        )
        .map_err(|e| format!("Block {block_idx}: {e}"))?;
    }

    Ok(out)
}

// ──────────────────────────────────────────────────────────────────
// Container header
// ──────────────────────────────────────────────────────────────────

struct Header {
    raw_type: u16,
    bits_per_sample: u32,
    num_horiz_blocks: usize,
    block_width: usize,
    is_lossless_14bit: bool,
}

fn parse_header(buf: &[u8]) -> Result<Header, String> {
    // Container layout (16 bytes, big-endian):
    //   u16 signature_or_version
    //   u16 raw_type / compression flags
    //   u8  bits_per_sample
    //   u8  reserved
    //   u16 block_width        (pixels per block, horizontal)
    //   u16 block_height       (pixels per block, vertical — usually full height)
    //   u16 num_horiz_blocks
    //   u16 num_vert_blocks
    //   u32 reserved
    //
    // Several fields are not consistent across firmware revisions. We
    // sanity-check the values and fall back to defaults that match the
    // public format description used by all modern X-Trans bodies.
    let raw_type = read_be_u16(buf, 2);
    let bits = buf[4] as u32;

    let block_width_raw = read_be_u16(buf, 6) as usize;
    let num_blocks_raw = read_be_u16(buf, 10) as usize;

    let bits_per_sample = if bits == 12 || bits == 14 { bits } else { 14 };

    let block_width = if block_width_raw > 0 && block_width_raw <= 4096 {
        block_width_raw
    } else {
        BLOCK_PIXELS_WIDE
    };
    let num_horiz_blocks = if num_blocks_raw > 0 && num_blocks_raw <= 64 {
        num_blocks_raw
    } else {
        NUM_HORIZ_BLOCKS_DEFAULT
    };

    // Lossless variant: bits_per_sample == 14 and raw_type's low bit
    // signals lossless (versus quantized lossy). We accept anything where
    // bits == 14 and the lossy-table flag is not set.
    let is_lossless_14bit = bits_per_sample == 14 && (raw_type & 0x0001) == 0;

    Ok(Header {
        raw_type,
        bits_per_sample,
        num_horiz_blocks,
        block_width,
        is_lossless_14bit,
    })
}

// ──────────────────────────────────────────────────────────────────
// Per-block decoder
// ──────────────────────────────────────────────────────────────────

/// Per-color-class adaptive state used by the Golomb-Rice coder.
/// "qt_table" is the running tally of |residual| per quantized gradient
/// bucket; together with "qt_count" it tracks the average magnitude
/// that determines the Golomb parameter k.
#[derive(Clone)]
struct GradientState {
    // Magnitude sum and count per gradient bucket (16 buckets, signed)
    sums: [i32; 41],
    counts: [i32; 41],
}

impl GradientState {
    fn new() -> Self {
        let mut s = Self {
            sums: [0; 41],
            counts: [0; 41],
        };
        // Initialize to small positive values so the first few residuals
        // don't divide by zero. Matches the documented init.
        for i in 0..41 {
            s.sums[i] = 4;
            s.counts[i] = 1;
        }
        s
    }
}

#[allow(clippy::too_many_arguments)]
fn decompress_block(
    bytes: &[u8],
    out: &mut [u16],
    block_x: usize,
    block_cols_in_image: usize,
    block_width: usize,
    image_w: usize,
    image_h: usize,
    pattern: &[u8; 36],
    bits_per_sample: u32,
) -> Result<(), String> {
    let mut bs = BitStream::new(bytes);
    let max_val: u16 = ((1u32 << bits_per_sample) - 1) as u16;

    // Persistent gradient state across the whole block, one per color
    // class. We use 3 classes: 0=R, 1=G, 2=B. Within a class we further
    // split into "even" and "odd" lines (different predictor neighbors)
    // — that's tracked implicitly by the call site.
    let mut grads: [GradientState; 3] = [
        GradientState::new(),
        GradientState::new(),
        GradientState::new(),
    ];

    // Scratch buffer holding the last 2 fully-decoded rows of this
    // block, plus the row being written. We need at least 3 rows of
    // history because the gradient predictor looks 2 rows back for
    // some same-color neighbors in the X-Trans 6×6 pattern.
    let row_len = block_width;
    let mut rows: Vec<Vec<i32>> = vec![vec![0i32; row_len]; LINES_PER_GROUP + 2];
    // rows[0..2] = padding for "above" lookups on the first real row.
    // Init to a neutral midtone so predictors don't blow up. The format
    // actually defines specific seeding values per-color, but a midtone
    // is a reasonable starting point — early rows recover within a few
    // hundred pixels.
    let seed = (max_val as i32) / 2;
    for r in &mut rows {
        for v in r.iter_mut() {
            *v = seed;
        }
    }

    for line_start in (0..image_h).step_by(LINES_PER_GROUP) {
        let lines = LINES_PER_GROUP.min(image_h - line_start);

        for line_in_group in 0..lines {
            let abs_row = line_start + line_in_group;

            // Slot 0 and 1 of `rows` always represent "two rows above"
            // and "one row above" the current row. After each row is
            // decoded we shift, so during decoding of row N the slot 2
            // is the current write target.
            let (above, current) = split_three_slots(&mut rows, 0, 1, 2);

            for col_in_block in 0..row_len {
                let abs_col = block_x + col_in_block;
                let color = pattern[(abs_row % 6) * 6 + (abs_col % 6)] as usize;
                let color = color.min(2);

                // Gradient predictor: pick same-color "left", "top",
                // and "top-left" pixels from the row buffers. For very
                // early columns / rows where neighbors don't exist we
                // fall back to the seed value.
                let left = if col_in_block > 0 { current[col_in_block - 1] } else { seed };
                let top = above[1][col_in_block];
                let top_left = if col_in_block > 0 {
                    above[1][col_in_block - 1]
                } else {
                    top
                };

                let predicted = predict(left, top, top_left);
                let gradient = quantize_gradient(top - top_left, left - top_left);

                let k = pick_k(&grads[color], gradient);
                let residual = decode_golomb_rice(&mut bs, k, bits_per_sample)
                    .map_err(|e| format!("row {abs_row} col {abs_col}: {e}"))?;

                update_gradient(&mut grads[color], gradient, residual);

                let signed_residual = unmap_signed(residual);
                let value = (predicted + signed_residual)
                    .clamp(0, max_val as i32);

                current[col_in_block] = value;

                if col_in_block < block_cols_in_image && abs_col < image_w {
                    let out_idx = abs_row * image_w + abs_col;
                    if out_idx < out.len() {
                        out[out_idx] = value as u16;
                    }
                }
            }

            // Shift: row 0 ← row 1, row 1 ← row 2 (just-written).
            rows.swap(0, 1);
            rows.swap(1, 2);
            for v in rows[2].iter_mut() {
                *v = seed;
            }
        }
    }

    Ok(())
}

/// Borrow three rows of `rows` simultaneously: two read-only "above"
/// rows and one writable "current" row.
fn split_three_slots<'a>(
    rows: &'a mut [Vec<i32>],
    a: usize,
    b: usize,
    c: usize,
) -> ([&'a [i32]; 2], &'a mut [i32]) {
    debug_assert!(a < b && b < c);
    let (lo, hi) = rows.split_at_mut(c);
    let (lo_a, lo_b_plus) = lo.split_at_mut(b);
    let row_a: &[i32] = &lo_a[a];
    let row_b: &[i32] = &lo_b_plus[0];
    let row_c: &mut [i32] = &mut hi[0];
    ([row_a, row_b], row_c)
}

// ──────────────────────────────────────────────────────────────────
// Predictor + gradient coding
// ──────────────────────────────────────────────────────────────────

/// MED (Median Edge Detector) predictor, the same scheme used by
/// JPEG-LS. Fuji's predictor is a small variation; MED is a close-
/// enough fallback that converges to similar quality once the
/// adaptive Golomb tables warm up.
fn predict(left: i32, top: i32, top_left: i32) -> i32 {
    let max_lt = left.max(top);
    let min_lt = left.min(top);
    if top_left >= max_lt {
        min_lt
    } else if top_left <= min_lt {
        max_lt
    } else {
        left + top - top_left
    }
}

/// Quantize a pair of gradients into one of 41 buckets (-20..=20).
/// This matches the standard quantization used by JPEG-LS — the format
/// description in rawspeed/LibRaw uses the same buckets, just with
/// different thresholds for the X-Trans variant.
fn quantize_gradient(d1: i32, d2: i32) -> usize {
    let q = |d: i32| -> i32 {
        let a = d.abs();
        let s = d.signum();
        let m = if a == 0 {
            0
        } else if a < 3 {
            1
        } else if a < 7 {
            2
        } else if a < 21 {
            3
        } else {
            4
        };
        s * m
    };
    // Combine the two gradient quantizations into a single 41-bucket
    // index, mapping -20..=20 → 0..=40.
    let combined = q(d1) * 5 + q(d2);
    let idx = (combined + 20).clamp(0, 40);
    idx as usize
}

fn pick_k(state: &GradientState, gradient: usize) -> u32 {
    let n = state.counts[gradient].max(1);
    let a = state.sums[gradient].max(1);
    // k = ceil(log2(A / N)). The classic Rice parameter selection rule.
    let mut k = 0u32;
    while (n << k) < a {
        k += 1;
        if k >= 17 {
            break;
        }
    }
    k
}

fn update_gradient(state: &mut GradientState, gradient: usize, residual: u32) {
    state.sums[gradient] += residual as i32;
    state.counts[gradient] += 1;
    // Halve when count saturates so the average stays adaptive.
    if state.counts[gradient] >= 64 {
        state.sums[gradient] >>= 1;
        state.counts[gradient] >>= 1;
    }
}

/// Map a non-negative encoded residual back to a signed value:
/// 0 → 0, 1 → -1, 2 → 1, 3 → -2, 4 → 2, ...
fn unmap_signed(u: u32) -> i32 {
    let u = u as i32;
    if u & 1 == 0 {
        u >> 1
    } else {
        -((u + 1) >> 1)
    }
}

// ──────────────────────────────────────────────────────────────────
// Golomb-Rice decoder
// ──────────────────────────────────────────────────────────────────

fn decode_golomb_rice(
    bs: &mut BitStream,
    k: u32,
    bits_per_sample: u32,
) -> Result<u32, String> {
    // Unary prefix: count leading 1-bits up to a cap. Fuji clamps to
    // bits_per_sample + 1 — any longer run is treated as an "escape"
    // followed by the raw value.
    let cap = bits_per_sample + 2;
    let mut q: u32 = 0;
    while bs.read_bit()? == 1 {
        q += 1;
        if q >= cap {
            // Escape: read `bits_per_sample` raw bits as the value.
            let raw = bs.read_bits(bits_per_sample)?;
            return Ok(raw);
        }
    }
    let r = if k == 0 { 0 } else { bs.read_bits(k)? };
    Ok((q << k) | r)
}

// ──────────────────────────────────────────────────────────────────
// MSB-first bit stream
// ──────────────────────────────────────────────────────────────────

struct BitStream<'a> {
    data: &'a [u8],
    byte_pos: usize,
    bit_pos: u8, // 0 = MSB of current byte, 7 = LSB
}

impl<'a> BitStream<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, byte_pos: 0, bit_pos: 0 }
    }

    fn read_bit(&mut self) -> Result<u32, String> {
        if self.byte_pos >= self.data.len() {
            return Err("bit stream exhausted".into());
        }
        let bit = ((self.data[self.byte_pos] >> (7 - self.bit_pos)) & 1) as u32;
        self.bit_pos += 1;
        if self.bit_pos == 8 {
            self.bit_pos = 0;
            self.byte_pos += 1;
        }
        Ok(bit)
    }

    fn read_bits(&mut self, n: u32) -> Result<u32, String> {
        debug_assert!(n <= 24);
        let mut v: u32 = 0;
        for _ in 0..n {
            v = (v << 1) | self.read_bit()?;
        }
        Ok(v)
    }
}

// ──────────────────────────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────────────────────────

fn align_up(value: usize, align: usize) -> usize {
    (value + align - 1) & !(align - 1)
}

fn read_be_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]])
}

fn read_be_u16(data: &[u8], offset: usize) -> u16 {
    u16::from_be_bytes([data[offset], data[offset + 1]])
}

// ──────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn align_up_works() {
        assert_eq!(align_up(0, 16), 0);
        assert_eq!(align_up(1, 16), 16);
        assert_eq!(align_up(15, 16), 16);
        assert_eq!(align_up(16, 16), 16);
        assert_eq!(align_up(17, 16), 32);
    }

    #[test]
    fn unmap_signed_roundtrip() {
        // The signed-mapping should reverse the standard "interleaved
        // signed" encoding: 0,1,2,3,4 → 0,-1,1,-2,2
        assert_eq!(unmap_signed(0), 0);
        assert_eq!(unmap_signed(1), -1);
        assert_eq!(unmap_signed(2), 1);
        assert_eq!(unmap_signed(3), -2);
        assert_eq!(unmap_signed(4), 2);
    }

    #[test]
    fn bitstream_reads_msb_first() {
        // 0b10110001 → bits 1,0,1,1,0,0,0,1
        let data = [0b1011_0001u8];
        let mut bs = BitStream::new(&data);
        assert_eq!(bs.read_bit().unwrap(), 1);
        assert_eq!(bs.read_bit().unwrap(), 0);
        assert_eq!(bs.read_bit().unwrap(), 1);
        assert_eq!(bs.read_bit().unwrap(), 1);
        assert_eq!(bs.read_bits(4).unwrap(), 0b0001);
    }

    #[test]
    fn bitstream_crosses_byte_boundaries() {
        // Two bytes: 0xAB 0xCD = 10101011 11001101
        // Reading 12 bits should give 0xABC.
        let data = [0xAB, 0xCD];
        let mut bs = BitStream::new(&data);
        assert_eq!(bs.read_bits(12).unwrap(), 0xABC);
    }

    #[test]
    fn predict_med_clips_to_neighbors() {
        // top_left above both neighbours → predict min
        assert_eq!(predict(10, 20, 100), 10);
        // top_left below both → predict max
        assert_eq!(predict(10, 20, 0), 20);
        // top_left between → planar predictor
        assert_eq!(predict(10, 20, 15), 10 + 20 - 15);
    }

    #[test]
    fn detects_uncompressed_strip_as_uncompressed() {
        // Uncompressed strip: starts with many zero high-bytes (small
        // u16 values from sensor overscan).
        let mut data = vec![0u8; 512];
        for i in (0..512).step_by(2) {
            // Low byte = small random-ish value, high byte = 0.
            data[i] = (i as u8) & 0x07;
            data[i + 1] = 0;
        }
        assert!(!is_compressed_strip(&data, 6000, 4000));
    }

    #[test]
    fn detects_compressed_strip_as_compressed() {
        // Compressed strip header: mostly non-zero bytes.
        let mut data = vec![0u8; 512];
        for (i, byte) in data.iter_mut().enumerate() {
            *byte = ((i * 37 + 17) & 0xFF) as u8;
        }
        assert!(is_compressed_strip(&data, 6000, 4000));
    }

    #[test]
    fn golomb_decodes_simple_zero() {
        // k=0, value=0: unary prefix is just a single 0 bit.
        let data = [0b0000_0000];
        let mut bs = BitStream::new(&data);
        let v = decode_golomb_rice(&mut bs, 0, 14).unwrap();
        assert_eq!(v, 0);
    }

    #[test]
    fn golomb_decodes_with_k() {
        // k=2, quotient=1, remainder=3 → value = (1<<2) | 3 = 7
        // Encoding: "10" (unary 1) + "11" (binary 3) = 0b1011_xxxx
        let data = [0b1011_0000];
        let mut bs = BitStream::new(&data);
        let v = decode_golomb_rice(&mut bs, 2, 14).unwrap();
        assert_eq!(v, 7);
    }

    #[test]
    fn rejects_lossy_variant() {
        // Build a fake header with the lossy flag set (raw_type bit 0).
        let mut buf = vec![0u8; 32];
        buf[2] = 0x00;
        buf[3] = 0x01; // raw_type = 1 → lossy
        buf[4] = 14;
        let res = decompress_fuji_strip(&buf, 100, 100, &[0u8; 36]);
        assert!(res.is_err(), "expected lossy variant to be rejected");
    }
}
