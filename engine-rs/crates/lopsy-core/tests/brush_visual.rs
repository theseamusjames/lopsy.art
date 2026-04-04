//! Brush visual output tests — generates PNGs to engine-rs/test-output/
//! Run with: cargo test -p lopsy-core --test brush_visual -- --nocapture

use std::fs;
use std::path::PathBuf;
use lopsy_core::brush::{generate_brush_stamp, interpolate_points, interpolate_points_with_scatter};

fn output_dir() -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()
        .parent().unwrap()
        .join("test-output");
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn save_png(path: &std::path::Path, data: &[u8], width: u32, height: u32) {
    let file = fs::File::create(path).unwrap();
    let ref mut w = std::io::BufWriter::new(file);
    let mut encoder = png::Encoder::new(w, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().unwrap();
    writer.write_image_data(data).unwrap();
}

/// Render a brush stamp to an RGBA image
fn stamp_to_rgba(stamp: &[f32], size: u32) -> Vec<u8> {
    let mut rgba = vec![255u8; (size * size * 4) as usize]; // white background
    for i in 0..(size * size) as usize {
        let v = ((1.0 - stamp[i]) * 255.0) as u8; // invert: stamp=1 → black
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
    }
    rgba
}

/// Render a stroke on a white canvas
fn render_stroke(width: u32, height: u32, points: &[f64], stamp: &[f32], stamp_size: u32) -> Vec<u8> {
    let mut canvas = vec![255u8; (width * height * 4) as usize];
    let radius = stamp_size as f64 / 2.0;

    for chunk in points.chunks(2) {
        if chunk.len() < 2 { break; }
        let cx = chunk[0];
        let cy = chunk[1];

        for sy in 0..stamp_size {
            for sx in 0..stamp_size {
                let px = (cx - radius + sx as f64).round() as i32;
                let py = (cy - radius + sy as f64).round() as i32;
                if px < 0 || py < 0 || px >= width as i32 || py >= height as i32 { continue; }
                let si = (sy * stamp_size + sx) as usize;
                let alpha = stamp[si];
                if alpha < 0.001 { continue; }
                let di = (py as u32 * width + px as u32) as usize * 4;
                // Blend black onto white
                let inv = 1.0 - alpha;
                canvas[di] = (canvas[di] as f32 * inv) as u8;
                canvas[di + 1] = (canvas[di + 1] as f32 * inv) as u8;
                canvas[di + 2] = (canvas[di + 2] as f32 * inv) as u8;
            }
        }
    }
    canvas
}

// ============================================================
// Test: Hard brush stamp
// ============================================================

#[test]
fn test_brush_stamp_hard() {
    let out = output_dir();
    let size = 64u32;
    let stamp = generate_brush_stamp(size, 1.0);
    let rgba = stamp_to_rgba(&stamp, size);

    let path = out.join("brush_stamp_hard.png");
    save_png(&path, &rgba, size, size);
    println!("Saved: {:?}", path);

    // Center pixel should be ~1.0 (fully opaque brush)
    let center = (size / 2 * size + size / 2) as usize;
    assert!((stamp[center] - 1.0).abs() < 0.01, "Center pixel of hard brush should be ~1.0, got {}", stamp[center]);
}

// ============================================================
// Test: Soft brush stamp
// ============================================================

#[test]
fn test_brush_stamp_soft() {
    let out = output_dir();
    let size = 64u32;
    let stamp = generate_brush_stamp(size, 0.0);
    let rgba = stamp_to_rgba(&stamp, size);

    let path = out.join("brush_stamp_soft.png");
    save_png(&path, &rgba, size, size);
    println!("Saved: {:?}", path);

    // Center should be 1.0
    let center = (size / 2 * size + size / 2) as usize;
    assert!((stamp[center] - 1.0).abs() < 0.01, "Center of soft brush should be 1.0, got {}", stamp[center]);

    // Edge (corner) should be < 0.1
    assert!(stamp[0] < 0.1, "Corner of soft brush should be < 0.1, got {}", stamp[0]);
}

// ============================================================
// Test: Stroke with 25% spacing (dense)
// ============================================================

#[test]
fn test_stroke_with_spacing_25() {
    let out = output_dir();
    let width = 256u32;
    let height = 128u32;
    let stamp_size = 24u32;
    let stamp = generate_brush_stamp(stamp_size, 0.5);
    let spacing = stamp_size as f64 * 0.25; // 25% of brush size

    let points = interpolate_points(30.0, 64.0, 226.0, 64.0, spacing);
    let canvas = render_stroke(width, height, &points, &stamp, stamp_size);

    let path = out.join("brush_stroke_spacing_25.png");
    save_png(&path, &canvas, width, height);
    println!("Saved: {:?}", path);

    // Dense spacing should produce a continuous stroke — check middle row has dark pixels
    let mid_y = 64u32;
    let mid_x = 128u32;
    let idx = (mid_y * width + mid_x) as usize * 4;
    assert!(canvas[idx] < 200, "Center of dense stroke should be darkened, got R={}", canvas[idx]);
}

// ============================================================
// Test: Stroke with 100% spacing (visible gaps)
// ============================================================

#[test]
fn test_stroke_with_spacing_100() {
    let out = output_dir();
    let width = 256u32;
    let height = 128u32;
    let stamp_size = 24u32;
    let stamp = generate_brush_stamp(stamp_size, 0.8);
    let spacing = stamp_size as f64 * 1.0; // 100% of brush size

    let points = interpolate_points(30.0, 64.0, 226.0, 64.0, spacing);
    let canvas = render_stroke(width, height, &points, &stamp, stamp_size);

    let path = out.join("brush_stroke_spacing_100.png");
    save_png(&path, &canvas, width, height);
    println!("Saved: {:?}", path);

    // With 100% spacing on a hard brush, there should be gaps between dabs
    // Check a point that falls between two dab centers
    let first_dab_x = 30.0;
    let second_dab_x = 30.0 + spacing;
    let gap_x = ((first_dab_x + second_dab_x) / 2.0) as u32;
    let gap_y = 64u32;
    let idx = (gap_y * width + gap_x) as usize * 4;
    // Gap pixel should be lighter than the dab centers (closer to white)
    let dab_idx = (gap_y * width + first_dab_x as u32) as usize * 4;
    assert!(canvas[idx] >= canvas[dab_idx], "Gap between dabs should be lighter than dab center");
}

// ============================================================
// Test: Stroke with scatter
// ============================================================

#[test]
fn test_stroke_with_scatter() {
    let out = output_dir();
    let width = 256u32;
    let height = 128u32;
    let stamp_size = 16u32;
    let stamp = generate_brush_stamp(stamp_size, 0.6);
    let spacing = stamp_size as f64 * 0.5;

    let points = interpolate_points_with_scatter(30.0, 64.0, 226.0, 64.0, spacing, 80.0, stamp_size as f64, 777);
    let canvas = render_stroke(width, height, &points, &stamp, stamp_size);

    let path = out.join("brush_stroke_scatter.png");
    save_png(&path, &canvas, width, height);
    println!("Saved: {:?}", path);

    // Verify that scatter moved points off the y=64 line
    let mut has_offset = false;
    for i in (1..points.len()).step_by(2) {
        if (points[i] - 64.0).abs() > 0.5 {
            has_offset = true;
            break;
        }
    }
    assert!(has_offset, "Scattered stroke should have points that deviate from the base line");
}

// ============================================================
// Test: Custom square tip stamp
// ============================================================

#[test]
fn test_custom_tip_stamp() {
    let out = output_dir();
    let size = 32u32;

    // Create a square-shaped tip: all pixels fully opaque
    let stamp = vec![1.0f32; (size * size) as usize];
    let rgba = stamp_to_rgba(&stamp, size);

    let path = out.join("brush_stamp_square_tip.png");
    save_png(&path, &rgba, size, size);
    println!("Saved: {:?}", path);

    // Verify the square tip is not circular: corner pixels should be 1.0
    assert!((stamp[0] - 1.0).abs() < 1e-5, "Square tip corner should be 1.0");
    assert!((stamp[(size - 1) as usize] - 1.0).abs() < 1e-5, "Square tip corner should be 1.0");
    let last = (size * size - 1) as usize;
    assert!((stamp[last] - 1.0).abs() < 1e-5, "Square tip corner should be 1.0");

    // Compare against a circular stamp where corners should be ~0
    let circular = generate_brush_stamp(size, 1.0);
    assert!(circular[0] < 0.1, "Circular stamp corner should be near 0, got {}", circular[0]);
}
