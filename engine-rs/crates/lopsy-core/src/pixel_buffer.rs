use crate::geometry::Rect;

/// Clone pixel data
pub fn clone_pixel_data(data: &[u8]) -> Vec<u8> {
    data.to_vec()
}

/// Find bounding box of non-transparent pixels and crop to it
/// Returns (cropped data, bounding rect)
pub fn crop_to_content_bounds(data: &[u8], width: u32, height: u32) -> (Vec<u8>, Rect) {
    let mut min_x = width;
    let mut min_y = height;
    let mut max_x = 0u32;
    let mut max_y = 0u32;
    let mut has_content = false;

    for y in 0..height {
        for x in 0..width {
            let a = data[((y * width + x) * 4 + 3) as usize];
            if a > 0 {
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
                has_content = true;
            }
        }
    }

    if !has_content {
        return (Vec::new(), Rect::new(0, 0, 0, 0));
    }

    let cw = max_x - min_x + 1;
    let ch = max_y - min_y + 1;
    let mut cropped = vec![0u8; (cw * ch * 4) as usize];

    for y in 0..ch {
        let src_offset = ((min_y + y) * width + min_x) as usize * 4;
        let dst_offset = (y * cw) as usize * 4;
        let row_bytes = (cw * 4) as usize;
        cropped[dst_offset..dst_offset + row_bytes]
            .copy_from_slice(&data[src_offset..src_offset + row_bytes]);
    }

    (cropped, Rect::new(min_x as i32, min_y as i32, cw, ch))
}

/// Expand cropped data back to full canvas size
pub fn expand_from_crop(
    cropped: &[u8], cw: u32, ch: u32,
    ox: i32, oy: i32,
    fw: u32, fh: u32,
) -> Vec<u8> {
    let mut out = vec![0u8; (fw * fh * 4) as usize];

    for y in 0..ch {
        let dst_y = oy + y as i32;
        if dst_y < 0 || dst_y >= fh as i32 {
            continue;
        }
        let src_offset = (y * cw * 4) as usize;
        let copy_x_start = if ox < 0 { (-ox) as u32 } else { 0 };
        let copy_x_end = cw.min((fw as i32 - ox) as u32);
        if copy_x_start >= copy_x_end {
            continue;
        }
        let dst_x = (ox + copy_x_start as i32) as u32;
        let copy_len = (copy_x_end - copy_x_start) as usize * 4;
        let src_start = src_offset + copy_x_start as usize * 4;
        let dst_start = (dst_y as u32 * fw + dst_x) as usize * 4;
        out[dst_start..dst_start + copy_len]
            .copy_from_slice(&cropped[src_start..src_start + copy_len]);
    }
    out
}

/// Scale pixel data using bilinear interpolation
pub fn scale_pixel_data(
    data: &[u8], src_w: u32, src_h: u32,
    dst_w: u32, dst_h: u32,
) -> Vec<u8> {
    if dst_w == 0 || dst_h == 0 {
        return Vec::new();
    }

    let mut out = vec![0u8; (dst_w * dst_h * 4) as usize];

    for dy in 0..dst_h {
        for dx in 0..dst_w {
            let sx = (dx as f64 + 0.5) * src_w as f64 / dst_w as f64 - 0.5;
            let sy = (dy as f64 + 0.5) * src_h as f64 / dst_h as f64 - 0.5;

            let x0 = sx.floor().max(0.0) as u32;
            let y0 = sy.floor().max(0.0) as u32;
            let x1 = (x0 + 1).min(src_w - 1);
            let y1 = (y0 + 1).min(src_h - 1);

            let fx = sx - x0 as f64;
            let fy = sy - y0 as f64;

            let dst_idx = ((dy * dst_w + dx) * 4) as usize;
            for c in 0..4 {
                let c00 = data[((y0 * src_w + x0) * 4) as usize + c] as f64;
                let c10 = data[((y0 * src_w + x1) * 4) as usize + c] as f64;
                let c01 = data[((y1 * src_w + x0) * 4) as usize + c] as f64;
                let c11 = data[((y1 * src_w + x1) * 4) as usize + c] as f64;

                let v = c00 * (1.0 - fx) * (1.0 - fy)
                    + c10 * fx * (1.0 - fy)
                    + c01 * (1.0 - fx) * fy
                    + c11 * fx * fy;

                out[dst_idx + c] = v.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
}

/// Resize canvas: place layer data at offset in new canvas size
pub fn resize_canvas_pixel_data(
    data: &[u8], src_w: u32, src_h: u32,
    layer_x: i32, layer_y: i32,
    dst_w: u32, dst_h: u32,
    offset_x: i32, offset_y: i32,
) -> Vec<u8> {
    let mut out = vec![0u8; (dst_w * dst_h * 4) as usize];
    let new_x = layer_x + offset_x;
    let new_y = layer_y + offset_y;

    for y in 0..src_h {
        let dst_y = new_y + y as i32;
        if dst_y < 0 || dst_y >= dst_h as i32 {
            continue;
        }
        for x in 0..src_w {
            let dst_x = new_x + x as i32;
            if dst_x < 0 || dst_x >= dst_w as i32 {
                continue;
            }
            let src_idx = ((y * src_w + x) * 4) as usize;
            let dst_idx = ((dst_y as u32 * dst_w + dst_x as u32) * 4) as usize;
            out[dst_idx..dst_idx + 4].copy_from_slice(&data[src_idx..src_idx + 4]);
        }
    }
    out
}

/// Crop layer pixel data to a given crop region
pub fn crop_layer_pixel_data(
    data: &[u8], src_w: u32, _src_h: u32,
    layer_x: i32, layer_y: i32,
    crop_x: i32, crop_y: i32, crop_w: u32, crop_h: u32,
) -> Vec<u8> {
    let mut out = vec![0u8; (crop_w * crop_h * 4) as usize];

    for cy in 0..crop_h {
        for cx in 0..crop_w {
            let abs_x = crop_x + cx as i32;
            let abs_y = crop_y + cy as i32;
            let src_x = abs_x - layer_x;
            let src_y = abs_y - layer_y;

            if src_x >= 0 && src_x < src_w as i32 && src_y >= 0 {
                let src_idx = ((src_y as u32 * src_w + src_x as u32) * 4) as usize;
                if src_idx + 4 <= data.len() {
                    let dst_idx = ((cy * crop_w + cx) * 4) as usize;
                    out[dst_idx..dst_idx + 4].copy_from_slice(&data[src_idx..src_idx + 4]);
                }
            }
        }
    }
    out
}

/// Create RGBA surface from grayscale mask (white pixels with mask as alpha)
pub fn create_mask_surface(mask_data: &[u8], width: u32, height: u32) -> Vec<u8> {
    let total = (width * height) as usize;
    assert_eq!(mask_data.len(), total);
    let mut out = vec![0u8; total * 4];
    for i in 0..total {
        out[i * 4] = 255;
        out[i * 4 + 1] = 255;
        out[i * 4 + 2] = 255;
        out[i * 4 + 3] = mask_data[i];
    }
    out
}

/// Extract alpha channel from RGBA surface as grayscale mask
pub fn extract_mask_from_surface(surface: &[u8], width: u32, height: u32) -> Vec<u8> {
    let total = (width * height) as usize;
    assert_eq!(surface.len(), total * 4);
    let mut mask = vec![0u8; total];
    for i in 0..total {
        mask[i] = surface[i * 4 + 3];
    }
    mask
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crop_and_expand_roundtrip() {
        let w = 10u32;
        let h = 10u32;
        let mut data = vec![0u8; (w * h * 4) as usize];
        // Red pixel at (3, 4)
        let idx = ((4 * w + 3) * 4) as usize;
        data[idx] = 255;
        data[idx + 3] = 255;

        let (cropped, rect) = crop_to_content_bounds(&data, w, h);
        assert_eq!(rect.x, 3);
        assert_eq!(rect.y, 4);
        assert_eq!(rect.width, 1);
        assert_eq!(rect.height, 1);
        assert_eq!(cropped.len(), 4);
        assert_eq!(cropped[0], 255);

        let expanded = expand_from_crop(&cropped, rect.width, rect.height, rect.x, rect.y, w, h);
        assert_eq!(expanded[idx], 255);
        assert_eq!(expanded[idx + 3], 255);
        assert_eq!(expanded[0], 0);
    }

    #[test]
    fn test_crop_empty() {
        let data = vec![0u8; 100 * 4];
        let (cropped, rect) = crop_to_content_bounds(&data, 10, 10);
        assert!(cropped.is_empty());
        assert_eq!(rect.width, 0);
    }

    #[test]
    fn test_scale_identity() {
        let mut data = vec![128u8; 4 * 4 * 4];
        data[0] = 255;
        let scaled = scale_pixel_data(&data, 4, 4, 4, 4);
        assert_eq!(scaled.len(), data.len());
    }

    #[test]
    fn test_scale_double() {
        let data = vec![100u8; 2 * 2 * 4];
        let scaled = scale_pixel_data(&data, 2, 2, 4, 4);
        assert_eq!(scaled.len(), 4 * 4 * 4);
        // All values should be close to 100
        for &v in &scaled {
            assert!((v as i32 - 100).unsigned_abs() <= 1);
        }
    }

    #[test]
    fn test_mask_surface_roundtrip() {
        let mask = vec![0u8, 128, 255, 50];
        let surface = create_mask_surface(&mask, 2, 2);
        assert_eq!(surface.len(), 16);
        assert_eq!(surface[3], 0);
        assert_eq!(surface[7], 128);
        assert_eq!(surface[11], 255);

        let extracted = extract_mask_from_surface(&surface, 2, 2);
        assert_eq!(extracted, mask);
    }

    #[test]
    fn test_resize_canvas() {
        let mut data = vec![0u8; 2 * 2 * 4];
        data[0] = 255; data[3] = 255; // pixel (0,0) = red

        let resized = resize_canvas_pixel_data(&data, 2, 2, 0, 0, 4, 4, 1, 1);
        // Original (0,0) should now be at (1,1)
        let idx = (1 * 4 + 1) * 4;
        assert_eq!(resized[idx], 255);
        assert_eq!(resized[idx + 3], 255);
        assert_eq!(resized[0], 0); // (0,0) should be empty
    }
}
