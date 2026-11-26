//! Sony's lossless compressed raw ("Lossless Compressed RAW", `Compression`
//! 7): the mosaic in tiles (`TileWidth` × `TileLength`, `TileOffsets`,
//! `TileByteCounts`), each tile one lossless JPEG (ITU T.81 process 14)
//! decoded by `dng::ljpeg`. A tile's frame is half the tile's width and
//! half its height with four components, one sample of each for every 2×2
//! block of the tile: components 0 and 1 are the block's top row, left
//! then right, 2 and 3 its bottom row. The samples are linear, at the
//! raw's own bit depth; there is no curve.
//!
//! The component layout was established on the real ILCE-7M4 file
//! (`ILCE-7M4_DSC06674_FullFrame-LossLess-Compressed-Large.ARW`): its
//! frames are 256 × 256 × 4 for 512 × 512 tiles, the decoded mosaic has
//! the colour filter's 2×2 structure everywhere and no seams at tile
//! edges, and it lines up with the camera's embedded JPEG.

use crate::dng::ljpeg::decode_lossless_jpeg;

/// Decode the `width` × `height` mosaic from its tiles. Tiles run left to
/// right, then down; the right and bottom ones may reach past the image.
pub fn decode_tiles(data: &[u8], width: usize, height: usize, tile_w: usize, tile_h: usize, offsets: &[u32], counts: &[u32]) -> Result<Vec<u16>, String> {
    if tile_w == 0 || tile_h == 0 || !tile_w.is_multiple_of(2) || !tile_h.is_multiple_of(2) || tile_w > 65_536 || tile_h > 65_536 {
        return Err(format!("This Sony RAW's {tile_w}×{tile_h} tiles are not supported"));
    }
    let (across, down) = (width.div_ceil(tile_w), height.div_ceil(tile_h));
    if offsets.len() < across * down || counts.len() < across * down {
        return Err("This Sony RAW's tile table is damaged".into());
    }
    let mut mosaic: Vec<u16> = Vec::new();
    mosaic.try_reserve_exact(width * height).map_err(|_| "not enough memory for the Sony RAW's pixels".to_string())?;
    mosaic.resize(width * height, 0);
    for ty in 0..down {
        for tx in 0..across {
            let i = ty * across + tx;
            let start = offsets[i] as usize;
            let tile = start
                .checked_add(counts[i] as usize)
                .filter(|&end| end <= data.len())
                .map(|end| &data[start..end])
                .ok_or("This Sony RAW is cut short: a tile runs past the end of the file")?;
            let samples = decode_lossless_jpeg(tile).map_err(|e| format!("This Sony RAW's data is damaged ({e})"))?;
            // Half the tile each way, four components.
            let (fw, fh) = (tile_w / 2, tile_h / 2);
            if samples.len() != fw * fh * 4 {
                return Err("This Sony RAW's lossless data is not a full-size sensor mosaic (a Medium or Small RAW?), which is not supported".into());
            }
            for fy in 0..fh {
                for dy in 0..2 {
                    let y = ty * tile_h + 2 * fy + dy;
                    if y >= height {
                        continue;
                    }
                    for fx in 0..fw {
                        for dx in 0..2 {
                            let x = tx * tile_w + 2 * fx + dx;
                            if x < width {
                                mosaic[y * width + x] = samples[(fy * fw + fx) * 4 + dy * 2 + dx];
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(mosaic)
}
