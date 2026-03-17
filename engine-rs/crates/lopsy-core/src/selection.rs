use crate::geometry::Rect;

/// Create a rectangular selection mask
pub fn create_rect_selection(
    width: u32, height: u32,
    sel_x: i32, sel_y: i32, sel_w: u32, sel_h: u32,
) -> Vec<u8> {
    let mut mask = vec![0u8; (width * height) as usize];
    let x1 = sel_x.max(0) as u32;
    let y1 = sel_y.max(0) as u32;
    let x2 = ((sel_x + sel_w as i32) as u32).min(width);
    let y2 = ((sel_y + sel_h as i32) as u32).min(height);

    for y in y1..y2 {
        for x in x1..x2 {
            mask[(y * width + x) as usize] = 255;
        }
    }
    mask
}

/// Create an elliptical selection mask
pub fn create_ellipse_selection(
    width: u32, height: u32,
    sel_x: i32, sel_y: i32, sel_w: u32, sel_h: u32,
) -> Vec<u8> {
    let mut mask = vec![0u8; (width * height) as usize];
    let cx = sel_x as f64 + sel_w as f64 / 2.0;
    let cy = sel_y as f64 + sel_h as f64 / 2.0;
    let rx = sel_w as f64 / 2.0;
    let ry = sel_h as f64 / 2.0;

    if rx < 0.5 || ry < 0.5 {
        return mask;
    }

    let y1 = sel_y.max(0) as u32;
    let y2 = ((sel_y + sel_h as i32) as u32).min(height);
    let x1 = sel_x.max(0) as u32;
    let x2 = ((sel_x + sel_w as i32) as u32).min(width);

    for y in y1..y2 {
        for x in x1..x2 {
            let dx = (x as f64 + 0.5 - cx) / rx;
            let dy = (y as f64 + 0.5 - cy) / ry;
            if dx * dx + dy * dy <= 1.0 {
                mask[(y * width + x) as usize] = 255;
            }
        }
    }
    mask
}

/// Invert a selection mask
pub fn invert_selection(mask: &[u8]) -> Vec<u8> {
    mask.iter().map(|&v| 255 - v).collect()
}

/// Combine two selection masks
/// mode: 0=replace, 1=add(union), 2=subtract, 3=intersect
pub fn combine_selections(a: &[u8], b: &[u8], mode: u32) -> Vec<u8> {
    assert_eq!(a.len(), b.len());
    a.iter().zip(b.iter()).map(|(&av, &bv)| {
        match mode {
            0 => bv,
            1 => av.max(bv),
            2 => av.saturating_sub(bv),
            3 => av.min(bv),
            _ => av,
        }
    }).collect()
}

/// Find bounding box of non-zero pixels in a mask
pub fn selection_bounds(mask: &[u8], width: u32, height: u32) -> Option<Rect> {
    let mut min_x = width as i32;
    let mut min_y = height as i32;
    let mut max_x = -1i32;
    let mut max_y = -1i32;

    for y in 0..height {
        for x in 0..width {
            if mask[(y * width + x) as usize] > 0 {
                min_x = min_x.min(x as i32);
                min_y = min_y.min(y as i32);
                max_x = max_x.max(x as i32);
                max_y = max_y.max(y as i32);
            }
        }
    }

    if max_x < 0 {
        None
    } else {
        Some(Rect::new(min_x, min_y, (max_x - min_x + 1) as u32, (max_y - min_y + 1) as u32))
    }
}

/// Check if a mask is entirely zero
pub fn is_empty_selection(mask: &[u8]) -> bool {
    mask.iter().all(|&v| v == 0)
}

/// Trace selection contours — returns pairs of (x1,y1,x2,y2) line segments
pub fn trace_selection_contours(mask: &[u8], width: u32, height: u32) -> Vec<f64> {
    let mut segments = Vec::new();
    let w = width as i32;
    let h = height as i32;

    for y in 0..=h {
        for x in 0..=w {
            let inside = if x < w && y < h { mask[(y as u32 * width + x as u32) as usize] > 127 } else { false };

            // Horizontal edge: check above
            if y > 0 && x < w {
                let above = mask[((y - 1) as u32 * width + x as u32) as usize] > 127;
                if inside != above {
                    segments.extend_from_slice(&[x as f64, y as f64, (x + 1) as f64, y as f64]);
                }
            } else if y == 0 && x < w && inside {
                segments.extend_from_slice(&[x as f64, 0.0, (x + 1) as f64, 0.0]);
            }

            // Vertical edge: check left
            if x > 0 {
                let left = if y < h { mask[(y as u32 * width + (x - 1) as u32) as usize] > 127 } else { false };
                if y < h && inside != left {
                    segments.extend_from_slice(&[x as f64, y as f64, x as f64, (y + 1) as f64]);
                }
            } else if y < h && inside {
                segments.extend_from_slice(&[0.0, y as f64, 0.0, (y + 1) as f64]);
            }
        }
    }
    segments
}

/// Get selection edge segments — horizontal edges then vertical edges
pub fn get_selection_edges(mask: &[u8], width: u32, height: u32) -> Vec<f64> {
    trace_selection_contours(mask, width, height)
}

/// Create a polygon mask from flat point array [x0,y0,x1,y1,...]
pub fn create_polygon_mask(points: &[f64], width: u32, height: u32) -> Vec<u8> {
    let mut mask = vec![0u8; (width * height) as usize];
    let n = points.len() / 2;
    if n < 3 {
        return mask;
    }

    // Scanline fill
    for y in 0..height {
        let py = y as f64 + 0.5;
        let mut intersections = Vec::new();

        for i in 0..n {
            let j = (i + 1) % n;
            let (x0, y0) = (points[i * 2], points[i * 2 + 1]);
            let (x1, y1) = (points[j * 2], points[j * 2 + 1]);

            if (y0 <= py && y1 > py) || (y1 <= py && y0 > py) {
                let t = (py - y0) / (y1 - y0);
                intersections.push(x0 + t * (x1 - x0));
            }
        }

        intersections.sort_by(|a, b| a.partial_cmp(b).unwrap());

        for pair in intersections.chunks(2) {
            if pair.len() == 2 {
                let x_start = (pair[0].max(0.0) as u32).min(width);
                let x_end = (pair[1].ceil().max(0.0) as u32).min(width);
                for x in x_start..x_end {
                    mask[(y * width + x) as usize] = 255;
                }
            }
        }
    }
    mask
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rect_selection() {
        let mask = create_rect_selection(10, 10, 2, 3, 4, 5);
        assert_eq!(mask[3 * 10 + 2], 255);
        assert_eq!(mask[7 * 10 + 5], 255);
        assert_eq!(mask[0], 0);
        assert_eq!(mask[3 * 10 + 6], 0);
    }

    #[test]
    fn test_ellipse_selection() {
        let mask = create_ellipse_selection(20, 20, 5, 5, 10, 10);
        // Center should be selected
        assert_eq!(mask[10 * 20 + 10], 255);
        // Corner should not
        assert_eq!(mask[0], 0);
    }

    #[test]
    fn test_invert() {
        let mask = vec![0, 128, 255];
        let inv = invert_selection(&mask);
        assert_eq!(inv, vec![255, 127, 0]);
    }

    #[test]
    fn test_combine_add() {
        let a = vec![100, 0, 200];
        let b = vec![50, 150, 100];
        let c = combine_selections(&a, &b, 1);
        assert_eq!(c, vec![100, 150, 200]);
    }

    #[test]
    fn test_combine_subtract() {
        let a = vec![200, 50, 100];
        let b = vec![100, 100, 50];
        let c = combine_selections(&a, &b, 2);
        assert_eq!(c, vec![100, 0, 50]);
    }

    #[test]
    fn test_selection_bounds() {
        let mut mask = vec![0u8; 100];
        mask[35] = 255; // (5, 3)
        mask[67] = 255; // (7, 6)
        let b = selection_bounds(&mask, 10, 10).unwrap();
        assert_eq!(b.x, 5);
        assert_eq!(b.y, 3);
        assert_eq!(b.width, 3);
        assert_eq!(b.height, 4);
    }

    #[test]
    fn test_empty_selection() {
        assert!(is_empty_selection(&[0, 0, 0]));
        assert!(!is_empty_selection(&[0, 1, 0]));
    }

    #[test]
    fn test_polygon_mask() {
        // Triangle covering most of 10x10
        let points = vec![5.0, 0.0, 10.0, 10.0, 0.0, 10.0];
        let mask = create_polygon_mask(&points, 10, 10);
        // Bottom middle should be filled
        assert_eq!(mask[9 * 10 + 5], 255);
        // Top corners should be empty
        assert_eq!(mask[0], 0);
    }

    #[test]
    fn test_contours_simple_rect() {
        let mask = create_rect_selection(4, 4, 1, 1, 2, 2);
        let contours = trace_selection_contours(&mask, 4, 4);
        assert!(!contours.is_empty());
        assert_eq!(contours.len() % 4, 0); // each segment is 4 floats
    }
}
