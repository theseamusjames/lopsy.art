/// Content-aware scale via seam carving.
///
/// Removes low-energy seams (vertical or horizontal pixel paths) to reduce
/// image dimensions while preserving visually important content.

fn luminance(r: u8, g: u8, b: u8) -> f32 {
    0.299 * r as f32 + 0.587 * g as f32 + 0.114 * b as f32
}

fn compute_energy(pixels: &[u8], w: u32, h: u32) -> Vec<f32> {
    let w = w as usize;
    let h = h as usize;
    let mut energy = vec![0.0f32; w * h];

    for y in 0..h {
        for x in 0..w {
            let x0 = if x > 0 { x - 1 } else { 0 };
            let x1 = if x < w - 1 { x + 1 } else { w - 1 };
            let y0 = if y > 0 { y - 1 } else { 0 };
            let y1 = if y < h - 1 { y + 1 } else { h - 1 };

            let idx = |xx: usize, yy: usize| (yy * w + xx) * 4;

            let lx0 = luminance(pixels[idx(x0, y)], pixels[idx(x0, y) + 1], pixels[idx(x0, y) + 2]);
            let lx1 = luminance(pixels[idx(x1, y)], pixels[idx(x1, y) + 1], pixels[idx(x1, y) + 2]);
            let ly0 = luminance(pixels[idx(x, y0)], pixels[idx(x, y0) + 1], pixels[idx(x, y0) + 2]);
            let ly1 = luminance(pixels[idx(x, y1)], pixels[idx(x, y1) + 1], pixels[idx(x, y1) + 2]);

            let dx = lx1 - lx0;
            let dy = ly1 - ly0;
            energy[y * w + x] = (dx * dx + dy * dy).sqrt();
        }
    }
    energy
}

fn find_vertical_seam(energy: &[f32], w: u32, h: u32) -> Vec<u32> {
    let w = w as usize;
    let h = h as usize;
    let mut dp = vec![0.0f32; w * h];

    dp[..w].copy_from_slice(&energy[..w]);

    for y in 1..h {
        for x in 0..w {
            let up = dp[(y - 1) * w + x];
            let up_left = if x > 0 { dp[(y - 1) * w + x - 1] } else { f32::MAX };
            let up_right = if x < w - 1 { dp[(y - 1) * w + x + 1] } else { f32::MAX };
            dp[y * w + x] = energy[y * w + x] + up.min(up_left).min(up_right);
        }
    }

    let mut seam = vec![0u32; h];
    let last_row = &dp[(h - 1) * w..h * w];
    let mut min_x = 0;
    let mut min_val = last_row[0];
    for x in 1..w {
        if last_row[x] < min_val {
            min_val = last_row[x];
            min_x = x;
        }
    }
    seam[h - 1] = min_x as u32;

    for y in (0..h - 1).rev() {
        let x = seam[y + 1] as usize;
        let mut best_x = x;
        let mut best_val = dp[y * w + x];
        if x > 0 && dp[y * w + x - 1] < best_val {
            best_val = dp[y * w + x - 1];
            best_x = x - 1;
        }
        if x < w - 1 && dp[y * w + x + 1] < best_val {
            best_x = x + 1;
        }
        seam[y] = best_x as u32;
    }
    seam
}

fn remove_vertical_seam(pixels: &[u8], w: u32, h: u32, seam: &[u32]) -> Vec<u8> {
    let new_w = w - 1;
    let mut out = vec![0u8; (new_w * h * 4) as usize];

    for y in 0..h {
        let sx = seam[y as usize] as usize;
        let src_row = (y * w * 4) as usize;
        let dst_row = (y * new_w * 4) as usize;

        let left_bytes = sx * 4;
        if left_bytes > 0 {
            out[dst_row..dst_row + left_bytes]
                .copy_from_slice(&pixels[src_row..src_row + left_bytes]);
        }

        let right_bytes = ((w as usize - sx - 1) * 4) as usize;
        if right_bytes > 0 {
            let src_start = src_row + (sx + 1) * 4;
            let dst_start = dst_row + left_bytes;
            out[dst_start..dst_start + right_bytes]
                .copy_from_slice(&pixels[src_start..src_start + right_bytes]);
        }
    }
    out
}

fn remove_vertical_seam_energy(energy: &[f32], w: u32, h: u32, seam: &[u32]) -> Vec<f32> {
    let new_w = (w - 1) as usize;
    let mut out = vec![0.0f32; new_w * h as usize];

    for y in 0..h as usize {
        let sx = seam[y] as usize;
        let src_row = y * w as usize;
        let dst_row = y * new_w;

        if sx > 0 {
            out[dst_row..dst_row + sx].copy_from_slice(&energy[src_row..src_row + sx]);
        }
        let right = w as usize - sx - 1;
        if right > 0 {
            out[dst_row + sx..dst_row + sx + right]
                .copy_from_slice(&energy[src_row + sx + 1..src_row + sx + 1 + right]);
        }
    }
    out
}

fn update_energy_near_seam(pixels: &[u8], energy: &mut [f32], w: u32, h: u32, seam: &[u32]) {
    let w = w as usize;
    let h = h as usize;

    for y in 0..h {
        let sx = seam[y] as usize;
        let x_start = if sx > 1 { sx - 1 } else { 0 };
        let x_end = if sx + 1 < w { sx + 1 } else { w - 1 };

        for x in x_start..=x_end {
            let x0 = if x > 0 { x - 1 } else { 0 };
            let x1 = if x < w - 1 { x + 1 } else { w - 1 };
            let y0 = if y > 0 { y - 1 } else { 0 };
            let y1 = if y < h - 1 { y + 1 } else { h - 1 };

            let idx = |xx: usize, yy: usize| (yy * w + xx) * 4;
            let lx0 = luminance(pixels[idx(x0, y)], pixels[idx(x0, y) + 1], pixels[idx(x0, y) + 2]);
            let lx1 = luminance(pixels[idx(x1, y)], pixels[idx(x1, y) + 1], pixels[idx(x1, y) + 2]);
            let ly0 = luminance(pixels[idx(x, y0)], pixels[idx(x, y0) + 1], pixels[idx(x, y0) + 2]);
            let ly1 = luminance(pixels[idx(x, y1)], pixels[idx(x, y1) + 1], pixels[idx(x, y1) + 2]);

            let dx = lx1 - lx0;
            let dy = ly1 - ly0;
            energy[y * w + x] = (dx * dx + dy * dy).sqrt();
        }
    }
}

fn transpose_pixels(pixels: &[u8], w: u32, h: u32) -> Vec<u8> {
    let mut out = vec![0u8; (w * h * 4) as usize];
    for y in 0..h {
        for x in 0..w {
            let src = ((y * w + x) * 4) as usize;
            let dst = ((x * h + y) * 4) as usize;
            out[dst..dst + 4].copy_from_slice(&pixels[src..src + 4]);
        }
    }
    out
}

/// Content-aware scale: reduce image dimensions by removing low-energy seams.
/// Only supports reduction (dst_w <= src_w, dst_h <= src_h). For enlargement
/// in either axis, falls back to bilinear interpolation on that axis first.
pub fn content_aware_scale(
    pixels: &[u8],
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
) -> Vec<u8> {
    if src_w == 0 || src_h == 0 || dst_w == 0 || dst_h == 0 {
        return vec![0u8; (dst_w * dst_h * 4) as usize];
    }
    if src_w == dst_w && src_h == dst_h {
        return pixels.to_vec();
    }

    let mut buf = pixels.to_vec();
    let mut cur_w = src_w;
    let mut cur_h = src_h;

    // If enlarging on either axis, bilinear-scale that axis first
    if dst_w > src_w || dst_h > src_h {
        let inter_w = if dst_w > src_w { dst_w } else { src_w };
        let inter_h = if dst_h > src_h { dst_h } else { src_h };
        buf = crate::pixel_buffer::scale_pixel_data(&buf, cur_w, cur_h, inter_w, inter_h);
        cur_w = inter_w;
        cur_h = inter_h;
    }

    // Remove vertical seams to reduce width
    if dst_w < cur_w {
        let seams_to_remove = cur_w - dst_w;
        let mut energy = compute_energy(&buf, cur_w, cur_h);

        for _ in 0..seams_to_remove {
            let seam = find_vertical_seam(&energy, cur_w, cur_h);
            buf = remove_vertical_seam(&buf, cur_w, cur_h, &seam);
            energy = remove_vertical_seam_energy(&energy, cur_w, cur_h, &seam);
            cur_w -= 1;
            if cur_w <= 1 {
                break;
            }
            update_energy_near_seam(&buf, &mut energy, cur_w, cur_h, &seam);
        }
    }

    // Remove horizontal seams to reduce height: transpose → vertical carve → transpose
    if dst_h < cur_h {
        let seams_to_remove = cur_h - dst_h;
        buf = transpose_pixels(&buf, cur_w, cur_h);
        let mut tw = cur_h;
        let th = cur_w;
        let mut energy = compute_energy(&buf, tw, th);

        for _ in 0..seams_to_remove {
            let seam = find_vertical_seam(&energy, tw, th);
            buf = remove_vertical_seam(&buf, tw, th, &seam);
            energy = remove_vertical_seam_energy(&energy, tw, th, &seam);
            tw -= 1;
            if tw <= 1 {
                break;
            }
            update_energy_near_seam(&buf, &mut energy, tw, th, &seam);
        }

        buf = transpose_pixels(&buf, tw, th);
    }

    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid_image(w: u32, h: u32, r: u8, g: u8, b: u8) -> Vec<u8> {
        let mut data = vec![0u8; (w * h * 4) as usize];
        for i in 0..(w * h) as usize {
            data[i * 4] = r;
            data[i * 4 + 1] = g;
            data[i * 4 + 2] = b;
            data[i * 4 + 3] = 255;
        }
        data
    }

    #[test]
    fn identity_scale() {
        let img = solid_image(4, 4, 128, 128, 128);
        let result = content_aware_scale(&img, 4, 4, 4, 4);
        assert_eq!(result.len(), img.len());
        assert_eq!(result, img);
    }

    #[test]
    fn reduce_width() {
        let img = solid_image(10, 5, 100, 150, 200);
        let result = content_aware_scale(&img, 10, 5, 7, 5);
        assert_eq!(result.len(), (7 * 5 * 4) as usize);
    }

    #[test]
    fn reduce_height() {
        let img = solid_image(5, 10, 100, 150, 200);
        let result = content_aware_scale(&img, 5, 10, 5, 7);
        assert_eq!(result.len(), (5 * 7 * 4) as usize);
    }

    #[test]
    fn reduce_both() {
        let img = solid_image(10, 10, 100, 150, 200);
        let result = content_aware_scale(&img, 10, 10, 7, 8);
        assert_eq!(result.len(), (7 * 8 * 4) as usize);
    }

    #[test]
    fn preserves_high_contrast_column() {
        // Image: 5 cols of black except middle col is white
        let w = 5u32;
        let h = 3u32;
        let mut img = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let idx = ((y * w + x) * 4) as usize;
                let val = if x == 2 { 255 } else { 0 };
                img[idx] = val;
                img[idx + 1] = val;
                img[idx + 2] = val;
                img[idx + 3] = 255;
            }
        }
        // Reduce width by 1: should remove a black column, not the white one
        let result = content_aware_scale(&img, w, h, 4, h);
        // The white column should still be present somewhere
        let mut found_white = false;
        for i in 0..(4 * h) as usize {
            if result[i * 4] == 255 {
                found_white = true;
                break;
            }
        }
        assert!(found_white, "high-energy white column should be preserved");
    }
}
