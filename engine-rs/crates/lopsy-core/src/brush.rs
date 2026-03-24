/// Generate a circular brush stamp with hardness falloff
/// Returns a flat array of alpha values (size x size), row-major
pub fn generate_brush_stamp(size: u32, hardness: f32) -> Vec<f32> {
    let s = size as usize;
    let mut stamp = vec![0.0f32; s * s];
    let center = (size as f32 - 1.0) / 2.0;
    let radius = size as f32 / 2.0;

    if radius < 0.5 {
        if s > 0 {
            stamp[0] = 1.0;
        }
        return stamp;
    }

    let hard_radius = radius * hardness.clamp(0.0, 1.0);

    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            let dist = (dx * dx + dy * dy).sqrt();

            let alpha = if dist > radius {
                0.0
            } else if dist <= hard_radius {
                1.0
            } else {
                let t = (dist - hard_radius) / (radius - hard_radius);
                1.0 - t * t // quadratic falloff
            };

            stamp[y as usize * s + x as usize] = alpha;
        }
    }
    stamp
}

/// Interpolate points along a line with given spacing
/// Returns flat [x0, y0, x1, y1, ...] pairs
pub fn interpolate_points(
    from_x: f64, from_y: f64,
    to_x: f64, to_y: f64,
    spacing: f64,
) -> Vec<f64> {
    let dx = to_x - from_x;
    let dy = to_y - from_y;
    let dist = (dx * dx + dy * dy).sqrt();

    if dist < 1e-10 || spacing < 1e-10 {
        return vec![from_x, from_y];
    }

    let steps = (dist / spacing).ceil() as usize;
    let mut points = Vec::with_capacity((steps + 1) * 2);

    for i in 0..=steps {
        let t = i as f64 / steps as f64;
        points.push(from_x + dx * t);
        points.push(from_y + dy * t);
    }
    points
}

/// Compute a shift-click line constrained to 0/45/90 degree angles
/// Returns [start_x, start_y, end_x, end_y]
pub fn compute_shift_click_line(
    from_x: f64, from_y: f64,
    to_x: f64, to_y: f64,
) -> [f64; 4] {
    let dx = to_x - from_x;
    let dy = to_y - from_y;
    let angle = dy.atan2(dx);

    // Snap to nearest 45 degree increment
    let snap_angle = (angle / std::f64::consts::FRAC_PI_4).round() * std::f64::consts::FRAC_PI_4;
    let dist = (dx * dx + dy * dy).sqrt();

    let end_x = from_x + dist * snap_angle.cos();
    let end_y = from_y + dist * snap_angle.sin();

    [from_x, from_y, end_x, end_y]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_brush_stamp_center() {
        let stamp = generate_brush_stamp(5, 1.0);
        assert_eq!(stamp.len(), 25);
        // Center pixel should be 1.0
        assert!((stamp[12] - 1.0).abs() < 1e-5);
    }

    #[test]
    fn test_brush_stamp_soft() {
        let stamp = generate_brush_stamp(11, 0.0);
        // Center should be 1.0
        assert!((stamp[60] - 1.0).abs() < 1e-5);
        // Edge should be ~0
        assert!(stamp[0] < 0.1);
    }

    #[test]
    fn test_brush_stamp_size_1() {
        let stamp = generate_brush_stamp(1, 1.0);
        assert_eq!(stamp.len(), 1);
        assert!((stamp[0] - 1.0).abs() < 1e-5);
    }

    #[test]
    fn test_interpolate_points() {
        let pts = interpolate_points(0.0, 0.0, 10.0, 0.0, 5.0);
        assert_eq!(pts.len() % 2, 0);
        assert!(pts.len() >= 4); // at least start + end
        assert!((pts[0] - 0.0).abs() < 1e-10);
        assert!((pts[pts.len() - 2] - 10.0).abs() < 1e-10);
    }

    #[test]
    fn test_interpolate_zero_distance() {
        let pts = interpolate_points(5.0, 5.0, 5.0, 5.0, 3.0);
        assert_eq!(pts.len(), 2);
    }

    #[test]
    fn test_shift_click_horizontal() {
        let [sx, sy, ex, ey] = compute_shift_click_line(0.0, 0.0, 100.0, 5.0);
        assert!((sx - 0.0).abs() < 1e-10);
        assert!((sy - 0.0).abs() < 1e-10);
        // Should snap to horizontal
        assert!((ey - 0.0).abs() < 1.0);
        assert!((ex - 100.0).abs() < 2.0);
    }

    #[test]
    fn test_shift_click_45deg() {
        let [_, _, ex, ey] = compute_shift_click_line(0.0, 0.0, 70.0, 72.0);
        // Should snap to 45 degrees
        assert!((ex - ey).abs() < 2.0);
    }
}
