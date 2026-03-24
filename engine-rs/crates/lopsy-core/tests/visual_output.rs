//! Visual output tests — generates PNG images to engine-rs/test-output/ for human review.
//! Run with: cargo test -p lopsy-core --test visual_output -- --nocapture

use std::fs;
use std::path::PathBuf;

use lopsy_core::blend::blend_colors;
use lopsy_core::brush::{generate_brush_stamp, interpolate_points};
use lopsy_core::color::{BlendMode, Color};
use lopsy_core::filters::adjustments;
use lopsy_core::filters::blur;
use lopsy_core::filters::noise;
use lopsy_core::flood_fill;
use lopsy_core::pixel_buffer;
use lopsy_core::selection;

fn output_dir() -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
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

fn solid_image(width: u32, height: u32, r: u8, g: u8, b: u8, a: u8) -> Vec<u8> {
    let total = (width * height) as usize;
    let mut data = vec![0u8; total * 4];
    for i in 0..total {
        data[i * 4] = r;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = b;
        data[i * 4 + 3] = a;
    }
    data
}

fn gradient_image(width: u32, height: u32, r: u8, g: u8, b: u8) -> Vec<u8> {
    let mut data = vec![0u8; (width * height * 4) as usize];
    for y in 0..height {
        for x in 0..width {
            let i = (y * width + x) as usize * 4;
            let t = x as f32 / (width - 1) as f32;
            let a = 1.0 - 0.5 * (y as f32 / (height - 1) as f32);
            data[i] = (r as f32 * t) as u8;
            data[i + 1] = (g as f32 * t) as u8;
            data[i + 2] = (b as f32 * t) as u8;
            data[i + 3] = (a * 255.0) as u8;
        }
    }
    data
}

fn checker_image(width: u32, height: u32, cell_size: u32) -> Vec<u8> {
    let mut data = vec![0u8; (width * height * 4) as usize];
    for y in 0..height {
        for x in 0..width {
            let i = (y * width + x) as usize * 4;
            let cx = x / cell_size;
            let cy = y / cell_size;
            if (cx + cy) % 2 == 0 {
                data[i] = 200; data[i + 1] = 50; data[i + 2] = 50; data[i + 3] = 255;
            } else {
                data[i] = 50; data[i + 1] = 50; data[i + 2] = 200; data[i + 3] = 255;
            }
        }
    }
    data
}

fn mask_to_rgba(mask: &[u8], width: u32, height: u32) -> Vec<u8> {
    let total = (width * height) as usize;
    let mut rgba = vec![0u8; total * 4];
    for i in 0..total {
        let v = if i < mask.len() { mask[i] } else { 0 };
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
    }
    rgba
}

// ============================================================
// Test: All 16 Blend Modes
// ============================================================

#[test]
fn test_blend_modes_grid() {
    let out = output_dir();
    let cell = 64u32;
    let cols = 4u32;
    let rows = 4u32;
    let width = cell * cols;
    let height = cell * rows;
    let mut canvas = vec![0u8; (width * height * 4) as usize];

    let modes = [
        BlendMode::Normal,
        BlendMode::Multiply,
        BlendMode::Screen,
        BlendMode::Overlay,
        BlendMode::Darken,
        BlendMode::Lighten,
        BlendMode::ColorDodge,
        BlendMode::ColorBurn,
        BlendMode::HardLight,
        BlendMode::SoftLight,
        BlendMode::Difference,
        BlendMode::Exclusion,
        BlendMode::Hue,
        BlendMode::Saturation,
        BlendMode::Color,
        BlendMode::Luminosity,
    ];

    for (idx, &mode) in modes.iter().enumerate() {
        let col = (idx as u32) % cols;
        let row = (idx as u32) / cols;
        let ox = col * cell;
        let oy = row * cell;

        for py in 0..cell {
            for px in 0..cell {
                let t = px as f32 / (cell - 1) as f32;
                let src = Color::new(1.0 * t, 0.5 * t, 0.0, 0.8);
                let u = py as f32 / (cell - 1) as f32;
                let dst = Color::new(0.0, 0.2 * u, 0.9 * u, 1.0);

                let result = blend_colors(src, dst, mode);
                let i = ((oy + py) * width + (ox + px)) as usize * 4;
                canvas[i] = (result.r.clamp(0.0, 1.0) * 255.0) as u8;
                canvas[i + 1] = (result.g.clamp(0.0, 1.0) * 255.0) as u8;
                canvas[i + 2] = (result.b.clamp(0.0, 1.0) * 255.0) as u8;
                canvas[i + 3] = (result.a.clamp(0.0, 1.0) * 255.0) as u8;
            }
        }
    }

    let path = out.join("blend_modes_grid.png");
    save_png(&path, &canvas, width, height);
    println!("Saved: {}", path.display());
}

// ============================================================
// Test: Brush Stamps
// ============================================================

#[test]
fn test_brush_stamps() {
    let out = output_dir();

    let sizes = [16u32, 32, 64];
    let hardnesses = [0.0f32, 0.25, 0.5, 0.75, 1.0];

    let cols = hardnesses.len() as u32;
    let rows = sizes.len() as u32;
    let max_size = 64u32;
    let padding = 4u32;
    let cell = max_size + padding * 2;
    let width = cell * cols;
    let height = cell * rows;
    let mut canvas = solid_image(width, height, 255, 255, 255, 255);

    for (ri, &size) in sizes.iter().enumerate() {
        for (ci, &hardness) in hardnesses.iter().enumerate() {
            let stamp = generate_brush_stamp(size, hardness);
            let ox = ci as u32 * cell + padding + (max_size - size) / 2;
            let oy = ri as u32 * cell + padding + (max_size - size) / 2;

            for sy in 0..size {
                for sx in 0..size {
                    let v = stamp[(sy * size + sx) as usize];
                    let i = ((oy + sy) * width + (ox + sx)) as usize * 4;
                    if i + 3 < canvas.len() {
                        let gray = (255.0 * (1.0 - v)) as u8;
                        canvas[i] = gray;
                        canvas[i + 1] = gray;
                        canvas[i + 2] = gray;
                    }
                }
            }
        }
    }

    let path = out.join("brush_stamps.png");
    save_png(&path, &canvas, width, height);
    println!("Saved: {}", path.display());
}

// ============================================================
// Test: Brush Stroke (interpolated dabs)
// ============================================================

#[test]
fn test_brush_stroke() {
    let out = output_dir();
    let width = 256u32;
    let height = 256u32;
    let mut canvas = solid_image(width, height, 255, 255, 255, 255);

    let stamp_size = 20u32;
    let stamp = generate_brush_stamp(stamp_size, 0.5);

    let points = [
        (30.0, 200.0),
        (80.0, 50.0),
        (150.0, 180.0),
        (220.0, 30.0),
    ];

    for i in 0..points.len() - 1 {
        let (x0, y0) = points[i];
        let (x1, y1) = points[i + 1];
        let interp = interpolate_points(x0, y0, x1, y1, 4.0);

        for chunk in interp.chunks(2) {
            if chunk.len() < 2 { break; }
            let cx = chunk[0];
            let cy = chunk[1];

            let half = stamp_size as f64 / 2.0;
            for sy in 0..stamp_size {
                for sx in 0..stamp_size {
                    let px = (cx - half + sx as f64) as i32;
                    let py = (cy - half + sy as f64) as i32;
                    if px < 0 || py < 0 || px >= width as i32 || py >= height as i32 {
                        continue;
                    }
                    let v = stamp[(sy * stamp_size + sx) as usize];
                    let idx = (py as u32 * width + px as u32) as usize * 4;
                    let alpha = v * 0.3;
                    let inv = 1.0 - alpha;
                    canvas[idx] = (canvas[idx] as f32 * inv + 20.0 * alpha) as u8;
                    canvas[idx + 1] = (canvas[idx + 1] as f32 * inv + 40.0 * alpha) as u8;
                    canvas[idx + 2] = (canvas[idx + 2] as f32 * inv + 120.0 * alpha) as u8;
                }
            }
        }
    }

    let path = out.join("brush_stroke.png");
    save_png(&path, &canvas, width, height);
    println!("Saved: {}", path.display());
}

// ============================================================
// Test: Filters
// ============================================================

#[test]
fn test_filters() {
    let out = output_dir();
    let width = 128u32;
    let height = 128u32;

    // Gaussian blur
    {
        let mut data = checker_image(width, height, 16);
        blur::gaussian_blur(&mut data, width, height, 5);
        save_png(&out.join("filter_gaussian_blur.png"), &data, width, height);
        println!("Saved: filter_gaussian_blur.png");
    }

    // Box blur
    {
        let mut data = checker_image(width, height, 16);
        blur::box_blur(&mut data, width, height, 5);
        save_png(&out.join("filter_box_blur.png"), &data, width, height);
        println!("Saved: filter_box_blur.png");
    }

    // Invert
    {
        let mut data = checker_image(width, height, 16);
        adjustments::invert(&mut data, width, height);
        save_png(&out.join("filter_invert.png"), &data, width, height);
        println!("Saved: filter_invert.png");
    }

    // Posterize
    {
        let mut data = gradient_image(width, height, 255, 180, 50);
        adjustments::posterize(&mut data, width, height, 4);
        save_png(&out.join("filter_posterize.png"), &data, width, height);
        println!("Saved: filter_posterize.png");
    }

    // Threshold
    {
        let mut data = gradient_image(width, height, 255, 255, 255);
        adjustments::threshold(&mut data, width, height, 128);
        save_png(&out.join("filter_threshold.png"), &data, width, height);
        println!("Saved: filter_threshold.png");
    }

    // Add noise
    {
        let mut data = solid_image(width, height, 128, 128, 128, 255);
        noise::add_noise(&mut data, width, height, 0.3, false, 42);
        save_png(&out.join("filter_add_noise.png"), &data, width, height);
        println!("Saved: filter_add_noise.png");
    }

    // Fill with noise
    {
        let mut data = solid_image(width, height, 0, 0, 0, 255);
        noise::fill_with_noise(&mut data, width, height, false, 42);
        save_png(&out.join("filter_fill_noise.png"), &data, width, height);
        println!("Saved: filter_fill_noise.png");
    }

    // Brightness
    {
        let mut data = gradient_image(width, height, 200, 100, 50);
        adjustments::brightness_contrast(&mut data, width, height, 0.3, 0.0);
        save_png(&out.join("filter_brightness.png"), &data, width, height);
        println!("Saved: filter_brightness.png");
    }

    // Contrast
    {
        let mut data = gradient_image(width, height, 200, 100, 50);
        adjustments::brightness_contrast(&mut data, width, height, 0.0, 0.6);
        save_png(&out.join("filter_contrast.png"), &data, width, height);
        println!("Saved: filter_contrast.png");
    }

    // Desaturate
    {
        let mut data = gradient_image(width, height, 255, 50, 50);
        adjustments::desaturate(&mut data, width, height);
        save_png(&out.join("filter_desaturate.png"), &data, width, height);
        println!("Saved: filter_desaturate.png");
    }
}

// ============================================================
// Test: Selections
// ============================================================

#[test]
fn test_selections() {
    let out = output_dir();
    let width = 128u32;
    let height = 128u32;

    // Rect
    {
        let mask = selection::create_rect_selection(width, height, 20, 20, 80, 60);
        save_png(&out.join("selection_rect.png"), &mask_to_rgba(&mask, width, height), width, height);
        println!("Saved: selection_rect.png");
    }

    // Ellipse
    {
        let mask = selection::create_ellipse_selection(width, height, 20, 20, 80, 80);
        save_png(&out.join("selection_ellipse.png"), &mask_to_rgba(&mask, width, height), width, height);
        println!("Saved: selection_ellipse.png");
    }

    // Add rect + ellipse
    {
        let rect = selection::create_rect_selection(width, height, 10, 10, 60, 60);
        let ellipse = selection::create_ellipse_selection(width, height, 50, 50, 70, 70);
        let combined = selection::combine_selections(&rect, &ellipse, 1);
        save_png(&out.join("selection_combined_add.png"), &mask_to_rgba(&combined, width, height), width, height);
        println!("Saved: selection_combined_add.png");
    }

    // Subtract
    {
        let rect = selection::create_rect_selection(width, height, 10, 10, 100, 100);
        let ellipse = selection::create_ellipse_selection(width, height, 30, 30, 60, 60);
        let subtracted = selection::combine_selections(&rect, &ellipse, 2);
        save_png(&out.join("selection_subtracted.png"), &mask_to_rgba(&subtracted, width, height), width, height);
        println!("Saved: selection_subtracted.png");
    }

    // Polygon triangle
    {
        let points = [64.0, 10.0, 10.0, 110.0, 118.0, 110.0];
        let mask = selection::create_polygon_mask(&points, width, height);
        save_png(&out.join("selection_polygon_triangle.png"), &mask_to_rgba(&mask, width, height), width, height);
        println!("Saved: selection_polygon_triangle.png");
    }

    // Inverted ellipse
    {
        let ellipse = selection::create_ellipse_selection(width, height, 30, 30, 68, 68);
        let inverted = selection::invert_selection(&ellipse);
        save_png(&out.join("selection_inverted.png"), &mask_to_rgba(&inverted, width, height), width, height);
        println!("Saved: selection_inverted.png");
    }
}

// ============================================================
// Test: Flood fill
// ============================================================

#[test]
fn test_flood_fill_visual() {
    let out = output_dir();
    let width = 128u32;
    let height = 128u32;

    let mut img = solid_image(width, height, 255, 255, 255, 255);
    // Red rectangle
    for y in 30..80 {
        for x in 30..100 {
            let i = (y * width + x) as usize * 4;
            img[i] = 255; img[i + 1] = 0; img[i + 2] = 0; img[i + 3] = 255;
        }
    }
    // Blue circle
    for y in 0..height {
        for x in 0..width {
            let dx = x as f32 - 80.0;
            let dy = y as f32 - 90.0;
            if dx * dx + dy * dy < 25.0 * 25.0 {
                let i = (y * width + x) as usize * 4;
                img[i] = 0; img[i + 1] = 0; img[i + 2] = 255; img[i + 3] = 255;
            }
        }
    }

    save_png(&out.join("flood_fill_source.png"), &img, width, height);

    // Contiguous fill from white corner
    let mask = flood_fill::flood_fill(&img, width, height, 0, 0, 0, true);
    save_png(&out.join("flood_fill_contiguous.png"), &mask_to_rgba(&mask, width, height), width, height);

    // Non-contiguous fill matching red
    let mask = flood_fill::flood_fill(&img, width, height, 50, 50, 0, false);
    save_png(&out.join("flood_fill_noncontiguous_red.png"), &mask_to_rgba(&mask, width, height), width, height);

    println!("Saved: flood_fill_*.png");
}

// ============================================================
// Test: Pixel operations (scale, crop)
// ============================================================

#[test]
fn test_pixel_operations() {
    let out = output_dir();
    let width = 64u32;
    let height = 64u32;
    let source = checker_image(width, height, 8);
    save_png(&out.join("pixelops_source.png"), &source, width, height);

    // Scale up 2x
    let scaled = pixel_buffer::scale_pixel_data(&source, width, height, width * 2, height * 2);
    save_png(&out.join("pixelops_scaled_2x.png"), &scaled, width * 2, height * 2);

    // Scale down 0.5x
    let scaled_down = pixel_buffer::scale_pixel_data(&source, width, height, width / 2, height / 2);
    save_png(&out.join("pixelops_scaled_half.png"), &scaled_down, width / 2, height / 2);

    // Crop to content bounds
    let mut sparse = solid_image(128, 128, 0, 0, 0, 0);
    for y in 40..80 {
        for x in 30..90 {
            let i = (y * 128 + x) as usize * 4;
            sparse[i] = 255; sparse[i + 1] = 100; sparse[i + 2] = 50; sparse[i + 3] = 255;
        }
    }
    save_png(&out.join("pixelops_before_crop.png"), &sparse, 128, 128);

    let (cropped, rect) = pixel_buffer::crop_to_content_bounds(&sparse, 128, 128);
    if rect.width > 0 && rect.height > 0 {
        save_png(&out.join("pixelops_after_crop.png"), &cropped, rect.width, rect.height);
        println!("Saved: pixelops_after_crop.png ({}x{} at {}, {})", rect.width, rect.height, rect.x, rect.y);
    }
    println!("Saved: pixelops_*.png");
}

// ============================================================
// Test: Layer compositing simulation
// ============================================================

#[test]
fn test_compositing_simulation() {
    let out = output_dir();
    let width = 256u32;
    let height = 256u32;

    let layer1 = gradient_image(width, height, 255, 128, 0);
    save_png(&out.join("composite_layer1.png"), &layer1, width, height);

    let mut layer2 = vec![0u8; (width * height * 4) as usize];
    for &cy in &[64i32, 192] {
        for &cx in &[64i32, 192] {
            for y in 0..height {
                for x in 0..width {
                    let dx = x as f32 - cx as f32;
                    let dy = y as f32 - cy as f32;
                    if dx * dx + dy * dy < 50.0 * 50.0 {
                        let i = (y * width + x) as usize * 4;
                        layer2[i] = 50;
                        layer2[i + 1] = 100;
                        layer2[i + 2] = 255;
                        layer2[i + 3] = 200;
                    }
                }
            }
        }
    }
    save_png(&out.join("composite_layer2.png"), &layer2, width, height);

    for &(mode, name) in &[
        (BlendMode::Normal, "normal"),
        (BlendMode::Multiply, "multiply"),
        (BlendMode::Screen, "screen"),
        (BlendMode::Overlay, "overlay"),
    ] {
        let mut result = vec![0u8; (width * height * 4) as usize];
        composite_layers(&layer1, &layer2, &mut result, width, height, mode, 1.0);
        save_png(&out.join(format!("composite_{name}.png")), &result, width, height);
    }
    println!("Saved: composite_*.png");
}

fn composite_layers(
    bottom: &[u8], top: &[u8], result: &mut [u8],
    width: u32, height: u32, mode: BlendMode, opacity: f32,
) {
    let total = (width * height) as usize;
    for i in 0..total {
        let bi = i * 4;
        let dst = Color::new(
            bottom[bi] as f32 / 255.0, bottom[bi + 1] as f32 / 255.0,
            bottom[bi + 2] as f32 / 255.0, bottom[bi + 3] as f32 / 255.0,
        );
        let src = Color::new(
            top[bi] as f32 / 255.0, top[bi + 1] as f32 / 255.0,
            top[bi + 2] as f32 / 255.0, top[bi + 3] as f32 / 255.0 * opacity,
        );
        let blended = blend_colors(src, dst, mode);
        result[bi] = (blended.r.clamp(0.0, 1.0) * 255.0) as u8;
        result[bi + 1] = (blended.g.clamp(0.0, 1.0) * 255.0) as u8;
        result[bi + 2] = (blended.b.clamp(0.0, 1.0) * 255.0) as u8;
        result[bi + 3] = (blended.a.clamp(0.0, 1.0) * 255.0) as u8;
    }
}

// ============================================================
// Test: ICC profiles
// ============================================================

#[test]
fn test_icc_profiles() {
    let out = output_dir();
    let srgb = lopsy_core::export::build_icc_profile(lopsy_core::color::ColorSpace::Srgb);
    let p3 = lopsy_core::export::build_icc_profile(lopsy_core::color::ColorSpace::DisplayP3);
    fs::write(out.join("profile_srgb.icc"), &srgb).unwrap();
    fs::write(out.join("profile_display_p3.icc"), &p3).unwrap();
    println!("Saved: profile_srgb.icc ({}B), profile_display_p3.icc ({}B)", srgb.len(), p3.len());
}
