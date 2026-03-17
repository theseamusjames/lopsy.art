/// Sparse pixel data — stores only non-transparent pixels
pub struct SparsePixelData {
    pub indices: Vec<u32>,
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Convert dense RGBA pixel data to sparse representation
/// Returns None if all pixels are transparent or if sparse would be larger
pub fn to_sparse(data: &[u8], width: u32, height: u32) -> Option<SparsePixelData> {
    let total = (width * height) as usize;
    assert_eq!(data.len(), total * 4);

    let mut indices = Vec::new();
    let mut rgba = Vec::new();

    for i in 0..total {
        let a = data[i * 4 + 3];
        if a > 0 {
            indices.push(i as u32);
            rgba.extend_from_slice(&data[i * 4..i * 4 + 4]);
        }
    }

    if indices.is_empty() {
        return None;
    }

    // Only use sparse if it saves memory
    let sparse_size = indices.len() * 4 + rgba.len(); // u32 indices + rgba bytes
    let dense_size = total * 4;
    if sparse_size >= dense_size {
        return None;
    }

    Some(SparsePixelData {
        indices,
        rgba,
        width,
        height,
    })
}

/// Convert sparse data to dense RGBA buffer with offset placement
pub fn from_sparse(
    sparse: &SparsePixelData,
    full_w: u32, full_h: u32,
    offset_x: i32, offset_y: i32,
) -> Vec<u8> {
    let mut out = vec![0u8; (full_w * full_h * 4) as usize];
    let sw = sparse.width as i32;

    for (idx, &pixel_idx) in sparse.indices.iter().enumerate() {
        let sx = (pixel_idx % sparse.width) as i32 + offset_x;
        let sy = (pixel_idx / sparse.width) as i32 + offset_y;
        let _ = sw; // suppress unused

        if sx >= 0 && sx < full_w as i32 && sy >= 0 && sy < full_h as i32 {
            let dst = ((sy as u32 * full_w + sx as u32) * 4) as usize;
            let src = idx * 4;
            out[dst..dst + 4].copy_from_slice(&sparse.rgba[src..src + 4]);
        }
    }
    out
}

/// Convert sparse data directly to dense without offset
pub fn sparse_to_dense(sparse: &SparsePixelData) -> Vec<u8> {
    let mut out = vec![0u8; (sparse.width * sparse.height * 4) as usize];

    for (idx, &pixel_idx) in sparse.indices.iter().enumerate() {
        let dst = (pixel_idx * 4) as usize;
        let src = idx * 4;
        out[dst..dst + 4].copy_from_slice(&sparse.rgba[src..src + 4]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sparse_roundtrip() {
        let mut data = vec![0u8; 4 * 4 * 4]; // 4x4 image
        // Set pixel at (1,1) to red
        let idx = (1 * 4 + 1) * 4;
        data[idx] = 255;
        data[idx + 3] = 255;
        // Set pixel at (2,3) to blue
        let idx2 = (3 * 4 + 2) * 4;
        data[idx2 + 2] = 255;
        data[idx2 + 3] = 255;

        let sparse = to_sparse(&data, 4, 4).unwrap();
        assert_eq!(sparse.indices.len(), 2);

        let dense = sparse_to_dense(&sparse);
        assert_eq!(dense[idx], 255);
        assert_eq!(dense[idx + 3], 255);
        assert_eq!(dense[idx2 + 2], 255);
        assert_eq!(dense[idx2 + 3], 255);
        // Other pixels should be 0
        assert_eq!(dense[0], 0);
    }

    #[test]
    fn test_sparse_all_transparent() {
        let data = vec![0u8; 100 * 4];
        assert!(to_sparse(&data, 10, 10).is_none());
    }

    #[test]
    fn test_sparse_with_offset() {
        let mut data = vec![0u8; 2 * 2 * 4]; // 2x2
        data[0] = 255; data[3] = 255; // pixel (0,0) = red

        let sparse = to_sparse(&data, 2, 2).unwrap();
        let full = from_sparse(&sparse, 10, 10, 5, 3);

        // Pixel should be at (5,3) in the full image
        let dst_idx = (3 * 10 + 5) * 4;
        assert_eq!(full[dst_idx], 255);
        assert_eq!(full[dst_idx + 3], 255);
    }

    #[test]
    fn test_sparse_fully_opaque_returns_none() {
        // All pixels opaque — sparse would be larger
        let data = vec![255u8; 10 * 10 * 4];
        assert!(to_sparse(&data, 10, 10).is_none());
    }
}
