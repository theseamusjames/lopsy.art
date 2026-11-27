//! An 8-bit contact sheet with a small bitmap font for the numbers, for
//! the real-file tests that write pictures to look at
//! (`standard_look.rs`, `dng_gain_map.rs`).
#![allow(dead_code)]

use std::path::Path;

use lopsy_core::working_space::srgb_encode;

use super::raw_compare::Picture;

/// A 5 × 7 bitmap font, drawn for these sheets: each row's five bits, the
/// leftmost the highest.
fn glyph(c: char) -> [u8; 7] {
    match c {
        'A' => [14, 17, 17, 31, 17, 17, 17],
        'B' => [30, 17, 17, 30, 17, 17, 30],
        'C' => [14, 17, 16, 16, 16, 17, 14],
        'D' => [30, 17, 17, 17, 17, 17, 30],
        'E' => [31, 16, 16, 30, 16, 16, 31],
        'F' => [31, 16, 16, 30, 16, 16, 16],
        'G' => [14, 17, 16, 23, 17, 17, 15],
        'H' => [17, 17, 17, 31, 17, 17, 17],
        'I' => [14, 4, 4, 4, 4, 4, 14],
        'J' => [7, 2, 2, 2, 2, 18, 12],
        'K' => [17, 18, 20, 24, 20, 18, 17],
        'L' => [16, 16, 16, 16, 16, 16, 31],
        'M' => [17, 27, 21, 21, 17, 17, 17],
        'N' => [17, 17, 25, 21, 19, 17, 17],
        'O' => [14, 17, 17, 17, 17, 17, 14],
        'P' => [30, 17, 17, 30, 16, 16, 16],
        'Q' => [14, 17, 17, 17, 21, 18, 13],
        'R' => [30, 17, 17, 30, 20, 18, 17],
        'S' => [15, 16, 16, 14, 1, 1, 30],
        'T' => [31, 4, 4, 4, 4, 4, 4],
        'U' => [17, 17, 17, 17, 17, 17, 14],
        'V' => [17, 17, 17, 17, 17, 10, 4],
        'W' => [17, 17, 17, 21, 21, 21, 10],
        'X' => [17, 17, 10, 4, 10, 17, 17],
        'Y' => [17, 17, 10, 4, 4, 4, 4],
        'Z' => [31, 1, 2, 4, 8, 16, 31],
        '0' => [14, 17, 19, 21, 25, 17, 14],
        '1' => [4, 12, 4, 4, 4, 4, 14],
        '2' => [14, 17, 1, 2, 4, 8, 31],
        '3' => [31, 2, 4, 2, 1, 17, 14],
        '4' => [2, 6, 10, 18, 31, 2, 2],
        '5' => [31, 16, 30, 1, 1, 17, 14],
        '6' => [6, 8, 16, 30, 17, 17, 14],
        '7' => [31, 1, 2, 4, 8, 8, 8],
        '8' => [14, 17, 17, 14, 17, 17, 14],
        '9' => [14, 17, 17, 15, 1, 2, 12],
        '.' => [0, 0, 0, 0, 0, 12, 12],
        ',' => [0, 0, 0, 0, 12, 4, 8],
        '%' => [24, 25, 2, 4, 8, 19, 3],
        '+' => [0, 4, 4, 31, 4, 4, 0],
        '-' => [0, 0, 0, 31, 0, 0, 0],
        '(' => [2, 4, 8, 8, 8, 4, 2],
        ')' => [8, 4, 2, 2, 2, 4, 8],
        '/' => [0, 1, 2, 4, 8, 16, 0],
        ':' => [0, 12, 12, 0, 12, 12, 0],
        '=' => [0, 0, 31, 0, 31, 0, 0],
        '_' => [0, 0, 0, 0, 0, 0, 31],
        _ => [0; 7],
    }
}

/// An 8-bit RGB sheet.
pub struct Sheet {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u8>,
}

impl Sheet {
    pub fn new(w: usize, h: usize, bg: u8) -> Self {
        Sheet { w, h, px: vec![bg; w * h * 3] }
    }

    pub fn text(&mut self, x: usize, y: usize, s: &str, scale: usize, colour: [u8; 3]) {
        for (i, c) in s.to_uppercase().chars().enumerate() {
            let g = glyph(c);
            let gx = x + i * 6 * scale;
            for (row, bits) in g.iter().enumerate() {
                for col in 0..5 {
                    if bits & (16 >> col) == 0 {
                        continue;
                    }
                    for dy in 0..scale {
                        for dx in 0..scale {
                            let (px, py) = (gx + col * scale + dx, y + row * scale + dy);
                            if px < self.w && py < self.h {
                                self.px[(py * self.w + px) * 3..][..3].copy_from_slice(&colour);
                            }
                        }
                    }
                }
            }
        }
    }

    pub fn picture(&mut self, x: usize, y: usize, p: &Picture) {
        for py in 0..p.h.min(self.h - y) {
            for px in 0..p.w.min(self.w - x) {
                for c in 0..3 {
                    let v = p.rgb[(py * p.w + px) * 3 + c];
                    self.px[((y + py) * self.w + x + px) * 3 + c] = (srgb_encode(v.clamp(0.0, 1.0)) * 255.0 + 0.5) as u8;
                }
            }
        }
    }

    pub fn write_jpeg(&self, path: &Path) {
        let enc = jpeg_encoder::Encoder::new_file(path, 90).expect("create jpg");
        enc.encode(&self.px, self.w as u16, self.h as u16, jpeg_encoder::ColorType::Rgb).expect("encode jpg");
    }
}
