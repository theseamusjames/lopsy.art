//! Color quantization for the Indexed Color document mode: median-cut
//! palette building plus nearest-color mapping with optional
//! Floyd-Steinberg dithering.

use std::collections::HashMap;

/// Above this many candidate pixels, palette building subsamples with a
/// fixed stride instead of scanning every pixel. Median cut only needs a
/// statistically representative sample to find good split points, and a
/// 4000x4000 image (16M pixels) would otherwise dominate palette build
/// time. The stride is derived from pixel count, so the same image always
/// produces the same sample (deterministic, no RNG).
const MAX_SAMPLE_PIXELS: usize = 256 * 1024;

/// A distinct colour and how many sampled pixels carry it.
#[derive(Clone, Copy)]
struct WeightedColor {
    rgb: [u8; 3],
    count: u64,
}

/// A median-cut box holds distinct colours, never repeated pixels, so a
/// split can't produce two boxes of the same colour when one colour
/// dominates the image (#1375).
struct ColorBox {
    colors: Vec<WeightedColor>,
}

impl ColorBox {
    fn channel_range(&self, channel: usize) -> u8 {
        let mut lo = u8::MAX;
        let mut hi = u8::MIN;
        for c in &self.colors {
            lo = lo.min(c.rgb[channel]);
            hi = hi.max(c.rgb[channel]);
        }
        hi.saturating_sub(lo)
    }

    fn widest_channel(&self) -> (usize, u8) {
        let mut best_channel = 0;
        let mut best_range = 0u8;
        for channel in 0..3 {
            let range = self.channel_range(channel);
            if range > best_range {
                best_range = range;
                best_channel = channel;
            }
        }
        (best_channel, best_range)
    }

    fn average(&self) -> [u8; 4] {
        let mut sum = [0u64; 3];
        let mut n = 0u64;
        for c in &self.colors {
            for ch in 0..3 {
                sum[ch] += c.rgb[ch] as u64 * c.count;
            }
            n += c.count;
        }
        let n = n.max(1);
        [
            ((sum[0] + n / 2) / n) as u8,
            ((sum[1] + n / 2) / n) as u8,
            ((sum[2] + n / 2) / n) as u8,
            255,
        ]
    }

    /// Splits at the pixel-weighted median of the widest channel, moved to
    /// the nearest place where that channel's value changes so both halves
    /// are non-empty and don't share a value on the split axis. Callers only
    /// split boxes whose widest range is > 0, so such a place exists.
    fn split(mut self) -> (ColorBox, ColorBox) {
        let (channel, _) = self.widest_channel();
        self.colors.sort_by_key(|c| c.rgb[channel]);
        let total: u64 = self.colors.iter().map(|c| c.count).sum();
        let mut acc = 0u64;
        let mut median = self.colors.len() - 1;
        for (i, c) in self.colors.iter().enumerate() {
            acc += c.count;
            if acc * 2 >= total {
                median = i;
                break;
            }
        }
        let is_boundary = |i: usize| {
            i > 0 && i < self.colors.len() && self.colors[i - 1].rgb[channel] != self.colors[i].rgb[channel]
        };
        let after = (median + 1..self.colors.len()).find(|&i| is_boundary(i));
        let before = (1..=median).rev().find(|&i| is_boundary(i));
        let mid = match (before, after) {
            (Some(b), Some(a)) => if median + 1 - b <= a - (median + 1) { b } else { a },
            (Some(b), None) => b,
            (None, Some(a)) => a,
            (None, None) => self.colors.len() / 2,
        };
        let right = self.colors.split_off(mid);
        (ColorBox { colors: self.colors }, ColorBox { colors: right })
    }
}

/// Build a palette of at most `max_colors` entries from an RGBA8 buffer using
/// median cut. Fully transparent pixels are ignored. Returns RGBA entries
/// with no duplicates.
///
/// When the image has no more than `max_colors` distinct opaque colours the
/// palette is exactly those colours, so converting never changes such an
/// image. Otherwise palette building subsamples pixels with a fixed stride
/// (see `MAX_SAMPLE_PIXELS`) rather than scanning every pixel; this keeps
/// build time bounded on multi-megapixel images while remaining
/// deterministic.
pub fn median_cut(pixels: &[u8], max_colors: usize) -> Vec<[u8; 4]> {
    if max_colors == 0 || pixels.len() < 4 {
        return Vec::new();
    }

    if let Some(exact) = exact_palette(pixels, max_colors) {
        return exact;
    }

    let colors = collect_sampled_colors(pixels);
    if colors.is_empty() {
        return Vec::new();
    }

    let mut boxes = vec![ColorBox { colors }];

    while boxes.len() < max_colors {
        let split_index = boxes
            .iter()
            .enumerate()
            .filter(|(_, b)| b.colors.len() > 1 && b.widest_channel().1 > 0)
            .max_by_key(|(_, b)| b.widest_channel().1)
            .map(|(i, _)| i);

        let Some(index) = split_index else { break };
        let box_to_split = boxes.swap_remove(index);
        let (a, b) = box_to_split.split();
        boxes.push(a);
        boxes.push(b);
    }

    let mut palette: Vec<[u8; 4]> = Vec::with_capacity(boxes.len());
    for entry in boxes.iter().map(ColorBox::average) {
        if !palette.contains(&entry) {
            palette.push(entry);
        }
    }
    palette
}

/// Every distinct opaque colour of the full image, in first-seen order, or
/// None as soon as there are more than `max_colors`. Photographs bail out
/// within the first few pixels, so the full scan is only paid by images
/// that really are low-colour.
fn exact_palette(pixels: &[u8], max_colors: usize) -> Option<Vec<[u8; 4]>> {
    let mut palette: Vec<[u8; 4]> = Vec::with_capacity(max_colors.min(256));
    let mut last: Option<[u8; 4]> = None;
    for chunk in pixels.chunks_exact(4) {
        if chunk[3] == 0 {
            continue;
        }
        let entry = [chunk[0], chunk[1], chunk[2], 255];
        if last == Some(entry) {
            continue;
        }
        last = Some(entry);
        if palette.contains(&entry) {
            continue;
        }
        if palette.len() >= max_colors {
            return None;
        }
        palette.push(entry);
    }
    Some(palette)
}

/// Distinct RGB colours with their pixel counts from opaque-enough pixels,
/// subsampling with a fixed stride when the pixel count exceeds
/// `MAX_SAMPLE_PIXELS`. Sorted by packed RGB so the result is deterministic.
fn collect_sampled_colors(pixels: &[u8]) -> Vec<WeightedColor> {
    let pixel_count = pixels.len() / 4;
    if pixel_count == 0 {
        return Vec::new();
    }

    let stride = (pixel_count / MAX_SAMPLE_PIXELS).max(1);

    let mut counts: HashMap<u32, u64> = HashMap::new();
    let mut i = 0usize;
    while i < pixel_count {
        let base = i * 4;
        if pixels[base + 3] > 0 {
            let key = (pixels[base] as u32) << 16 | (pixels[base + 1] as u32) << 8 | pixels[base + 2] as u32;
            *counts.entry(key).or_insert(0) += 1;
        }
        i += stride;
    }
    let mut colors: Vec<WeightedColor> = counts
        .into_iter()
        .map(|(key, count)| WeightedColor {
            rgb: [(key >> 16) as u8, (key >> 8) as u8, key as u8],
            count,
        })
        .collect();
    colors.sort_by_key(|c| (c.rgb[0], c.rgb[1], c.rgb[2]));
    colors
}

/// Index of the nearest palette entry, or None when the palette is empty.
pub fn nearest_palette_index(palette: &[[u8; 4]], r: u8, g: u8, b: u8) -> Option<usize> {
    if palette.is_empty() {
        return None;
    }

    let mut best_index = 0;
    let mut best_dist = u32::MAX;
    for (i, entry) in palette.iter().enumerate() {
        let dist = squared_distance(entry, r, g, b);
        if dist < best_dist {
            best_dist = dist;
            best_index = i;
        }
    }
    Some(best_index)
}

fn squared_distance(entry: &[u8; 4], r: u8, g: u8, b: u8) -> u32 {
    let dr = entry[0] as i32 - r as i32;
    let dg = entry[1] as i32 - g as i32;
    let db = entry[2] as i32 - b as i32;
    (dr * dr + dg * dg + db * db) as u32
}

/// Snap every pixel to its nearest palette entry (squared Euclidean distance
/// in RGB). Alpha is preserved. No-op if the palette is empty.
pub fn apply_palette(pixels: &mut [u8], palette: &[[u8; 4]]) {
    if palette.is_empty() {
        return;
    }

    for chunk in pixels.chunks_exact_mut(4) {
        let Some(index) = nearest_palette_index(palette, chunk[0], chunk[1], chunk[2]) else {
            continue;
        };
        let entry = palette[index];
        chunk[0] = entry[0];
        chunk[1] = entry[1];
        chunk[2] = entry[2];
    }
}

/// Like `apply_palette` but diffuses quantization error with Floyd–Steinberg.
/// `width`/`height` describe the buffer; returns early if they don't match.
pub fn apply_palette_dithered(
    pixels: &mut [u8],
    width: usize,
    height: usize,
    palette: &[[u8; 4]],
) {
    if palette.is_empty() || width == 0 || height == 0 {
        return;
    }
    if pixels.len() != width * height * 4 {
        return;
    }

    // Error accumulates in a float buffer separate from the u8 pixel data so
    // repeated additions don't clamp/truncate prematurely; only the final
    // sample-and-quantize step clamps to 0..=255.
    let mut error = vec![[0f32; 3]; width * height];

    for y in 0..height {
        for x in 0..width {
            let idx = y * width + x;
            let base = idx * 4;
            if pixels[base + 3] == 0 {
                continue;
            }

            let old = [
                clamp_channel(pixels[base] as f32 + error[idx][0]),
                clamp_channel(pixels[base + 1] as f32 + error[idx][1]),
                clamp_channel(pixels[base + 2] as f32 + error[idx][2]),
            ];

            let Some(pi) = nearest_palette_index(palette, old[0], old[1], old[2]) else {
                continue;
            };
            let entry = palette[pi];
            pixels[base] = entry[0];
            pixels[base + 1] = entry[1];
            pixels[base + 2] = entry[2];

            let diff = [
                old[0] as f32 - entry[0] as f32,
                old[1] as f32 - entry[1] as f32,
                old[2] as f32 - entry[2] as f32,
            ];

            diffuse_error(&mut error, width, height, x, y, diff);
        }
    }
}

fn clamp_channel(v: f32) -> u8 {
    v.round().clamp(0.0, 255.0) as u8
}

fn diffuse_error(
    error: &mut [[f32; 3]],
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    diff: [f32; 3],
) {
    let mut add = |dx: i64, dy: i64, weight: f32| {
        let nx = x as i64 + dx;
        let ny = y as i64 + dy;
        if nx < 0 || ny < 0 || nx as usize >= width || ny as usize >= height {
            return;
        }
        let idx = ny as usize * width + nx as usize;
        for c in 0..3 {
            error[idx][c] += diff[c] * weight;
        }
    };

    add(1, 0, 7.0 / 16.0);
    add(-1, 1, 3.0 / 16.0);
    add(0, 1, 5.0 / 16.0);
    add(1, 1, 1.0 / 16.0);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_image(pixels: &[[u8; 4]]) -> Vec<u8> {
        pixels.iter().flat_map(|p| p.iter().copied()).collect()
    }

    #[test]
    fn palette_size_never_exceeds_max_colors() {
        let mut data = Vec::new();
        for r in 0..16u8 {
            for g in 0..16u8 {
                data.extend_from_slice(&[r * 16, g * 16, 0, 255]);
            }
        }
        let palette = median_cut(&data, 8);
        assert!(palette.len() <= 8);
    }

    #[test]
    fn two_distinct_colors_yield_palette_of_two_not_padded() {
        let data = make_image(&[
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [255, 0, 0, 255],
            [0, 255, 0, 255],
        ]);
        let palette = median_cut(&data, 16);
        assert_eq!(palette.len(), 2);
    }

    fn white_canvas_with_swatches(swatches: &[[u8; 3]], extra_white: usize) -> Vec<u8> {
        let mut data = Vec::new();
        for _ in 0..extra_white {
            data.extend_from_slice(&[255, 255, 255, 255]);
        }
        for s in swatches {
            for _ in 0..36 {
                data.extend_from_slice(&[s[0], s[1], s[2], 255]);
            }
        }
        data
    }

    // #1375: a white canvas with seven small swatches has 8 colours, so an
    // 8-colour palette must hold exactly those colours.
    #[test]
    fn image_with_at_most_max_colors_keeps_every_colour_exactly() {
        let swatches = [
            [255, 0, 0],
            [0, 255, 0],
            [0, 0, 255],
            [255, 255, 0],
            [0, 255, 255],
            [255, 0, 255],
            [0, 0, 0],
        ];
        let mut data = white_canvas_with_swatches(&swatches, 20_000);
        let palette = median_cut(&data, 8);
        assert_eq!(palette.len(), 8);
        assert!(palette.contains(&[255, 255, 255, 255]));
        for s in &swatches {
            assert!(palette.contains(&[s[0], s[1], s[2], 255]), "missing {:?}", s);
        }

        let original = data.clone();
        apply_palette(&mut data, &palette);
        assert_eq!(data, original);
    }

    // #1375: when one colour dominates, splitting at the pixel-count median
    // kept halving the run of that colour, filling the palette with copies
    // of it and averaging the rare colours into pastels.
    #[test]
    fn dominant_colour_does_not_fill_the_palette_with_duplicates() {
        let mut swatches = Vec::new();
        for i in 0..12u8 {
            swatches.push([i * 20, 255 - i * 20, (i % 3) * 120]);
        }
        let data = white_canvas_with_swatches(&swatches, 50_000);
        let palette = median_cut(&data, 8);
        assert_eq!(palette.len(), 8);
        for (i, a) in palette.iter().enumerate() {
            for b in &palette[i + 1..] {
                assert_ne!(a, b, "duplicate palette entry");
            }
        }
        let whites = palette.iter().filter(|p| p[0] > 240 && p[1] > 240 && p[2] > 240).count();
        assert_eq!(whites, 1, "palette {:?}", palette);
    }

    #[test]
    fn large_image_with_few_colours_is_exact_despite_subsampling() {
        let mut data = vec![255u8; 1200 * 1680 * 4];
        // A 3-pixel-wide red stripe the stride sampler could skip.
        for y in 0..1680 {
            for x in 600..603 {
                let base = (y * 1200 + x) * 4;
                data[base] = 255;
                data[base + 1] = 0;
                data[base + 2] = 0;
            }
        }
        let palette = median_cut(&data, 8);
        assert_eq!(palette.len(), 2);
        assert!(palette.contains(&[255, 0, 0, 255]));
    }

    #[test]
    fn apply_palette_maps_every_pixel_to_a_palette_entry() {
        let mut data = make_image(&[
            [10, 10, 10, 255],
            [250, 250, 250, 255],
            [128, 128, 128, 255],
        ]);
        let palette = vec![[0, 0, 0, 255], [255, 255, 255, 255]];
        apply_palette(&mut data, &palette);

        for chunk in data.chunks_exact(4) {
            let rgb = [chunk[0], chunk[1], chunk[2], 255];
            assert!(palette.contains(&rgb));
        }
    }

    #[test]
    fn solid_color_image_round_trips_exactly() {
        let mut data = make_image(&[
            [42, 100, 200, 255],
            [42, 100, 200, 255],
            [42, 100, 200, 255],
            [42, 100, 200, 255],
        ]);
        let palette = median_cut(&data, 4);
        assert_eq!(palette.len(), 1);
        assert_eq!(palette[0], [42, 100, 200, 255]);

        let original = data.clone();
        apply_palette(&mut data, &palette);
        assert_eq!(data, original);
    }

    #[test]
    fn apply_palette_preserves_alpha() {
        let mut data = make_image(&[[10, 10, 10, 0], [250, 250, 250, 128]]);
        let palette = vec![[0, 0, 0, 255], [255, 255, 255, 255]];
        apply_palette(&mut data, &palette);
        assert_eq!(data[3], 0);
        assert_eq!(data[7], 128);
    }

    #[test]
    fn apply_palette_dithered_preserves_alpha() {
        let mut data = make_image(&[[10, 10, 10, 0], [250, 250, 250, 128]]);
        let palette = vec![[0, 0, 0, 255], [255, 255, 255, 255]];
        apply_palette_dithered(&mut data, 2, 1, &palette);
        assert_eq!(data[3], 0);
        assert_eq!(data[7], 128);
    }

    #[test]
    fn empty_input_does_not_panic() {
        let palette = median_cut(&[], 4);
        assert!(palette.is_empty());

        let mut data: Vec<u8> = Vec::new();
        apply_palette(&mut data, &[[0, 0, 0, 255]]);
        apply_palette_dithered(&mut data, 0, 0, &[[0, 0, 0, 255]]);
    }

    #[test]
    fn max_colors_zero_or_one_does_not_panic() {
        let data = make_image(&[[1, 2, 3, 255], [4, 5, 6, 255]]);
        assert!(median_cut(&data, 0).is_empty());
        assert_eq!(median_cut(&data, 1).len(), 1);
    }

    #[test]
    fn non_multiple_of_four_buffer_does_not_panic() {
        let data = vec![1u8, 2, 3, 255, 4, 5];
        let palette = median_cut(&data, 4);
        assert!(palette.len() <= 4);

        let mut data2 = data.clone();
        apply_palette(&mut data2, &[[0, 0, 0, 255]]);
    }

    #[test]
    fn fully_transparent_image_does_not_panic() {
        let data = make_image(&[[10, 20, 30, 0], [40, 50, 60, 0]]);
        let palette = median_cut(&data, 4);
        assert!(palette.is_empty());

        let mut data2 = data.clone();
        apply_palette(&mut data2, &palette);
        apply_palette_dithered(&mut data2, 2, 1, &palette);
    }

    #[test]
    fn one_by_one_image_does_not_panic() {
        let data = make_image(&[[7, 8, 9, 255]]);
        let palette = median_cut(&data, 4);
        assert_eq!(palette.len(), 1);
        let mut data2 = data.clone();
        apply_palette_dithered(&mut data2, 1, 1, &palette);
    }

    #[test]
    fn nearest_palette_index_picks_the_true_nearest() {
        let palette = vec![
            [0, 0, 0, 255],
            [100, 100, 100, 255],
            [255, 255, 255, 255],
        ];
        // 90 is closer to 100 (dist^2 = 300) than to 0 (dist^2 = 24300) or
        // 255 (dist^2 = 24075).
        let idx = nearest_palette_index(&palette, 90, 90, 90).unwrap();
        assert_eq!(idx, 1);

        assert_eq!(nearest_palette_index(&palette, 10, 10, 10).unwrap(), 0);
        assert_eq!(nearest_palette_index(&palette, 250, 250, 250).unwrap(), 2);
        assert!(nearest_palette_index(&[], 1, 2, 3).is_none());
    }

    #[test]
    fn dithering_preserves_mean_brightness_on_a_gradient() {
        let width = 64;
        let height = 8;
        let mut data = vec![0u8; width * height * 4];
        for y in 0..height {
            for x in 0..width {
                let v = ((x * 255) / (width - 1)) as u8;
                let base = (y * width + x) * 4;
                data[base] = v;
                data[base + 1] = v;
                data[base + 2] = v;
                data[base + 3] = 255;
            }
        }

        let palette = vec![[0, 0, 0, 255], [255, 255, 255, 255]];

        let mean_of = |buf: &[u8]| -> f64 {
            let sum: u64 = buf
                .chunks_exact(4)
                .map(|c| c[0] as u64)
                .sum();
            sum as f64 / (width * height) as f64
        };

        let original_mean = mean_of(&data);

        let mut dithered = data.clone();
        apply_palette_dithered(&mut dithered, width, height, &palette);
        let dithered_mean = mean_of(&dithered);

        assert!(
            (dithered_mean - original_mean).abs() < 10.0,
            "dithered mean {} too far from original mean {}",
            dithered_mean,
            original_mean
        );
    }
}
