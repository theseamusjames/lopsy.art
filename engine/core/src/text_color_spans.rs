//! Per-range text colours.
//!
//! The JS layer model stores colour spans as UTF-16 offsets (JS string
//! indices); layout works in UTF-8 byte offsets. `ColorSpans` converts once
//! when the props are parsed and answers "what colour is the glyph that starts
//! at byte N" during rasterization.

/// A colour run over the UTF-8 byte range `[start, end)`, RGBA in 0..1.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ByteColorSpan {
    pub start: usize,
    pub end: usize,
    pub color: [f32; 4],
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ColorSpans {
    spans: Vec<ByteColorSpan>,
}

/// Byte offset of UTF-16 index `utf16` in `text`. An index inside a surrogate
/// pair rounds up to the end of that character; past the end clamps to the
/// text length.
pub fn utf16_to_byte_offset(text: &str, utf16: usize) -> usize {
    let mut units = 0usize;
    for (byte, ch) in text.char_indices() {
        if units >= utf16 {
            return byte;
        }
        units += ch.len_utf16();
    }
    text.len()
}

impl ColorSpans {
    /// Build from `(utf16_start, utf16_end, rgba)` triples over `text`.
    /// Empty and inverted ranges are dropped; later spans win where they
    /// overlap earlier ones.
    pub fn from_utf16(text: &str, spans: &[(usize, usize, [f32; 4])]) -> Self {
        let mut out: Vec<ByteColorSpan> = Vec::with_capacity(spans.len());
        for &(s, e, color) in spans {
            if e <= s {
                continue;
            }
            let start = utf16_to_byte_offset(text, s);
            let end = utf16_to_byte_offset(text, e);
            if end > start {
                out.push(ByteColorSpan { start, end, color });
            }
        }
        Self { spans: out }
    }

    pub fn is_empty(&self) -> bool {
        self.spans.is_empty()
    }

    /// Colour of the glyph whose cluster starts at `byte`, or `base` when no
    /// span covers it.
    pub fn color_at(&self, byte: usize, base: [f32; 4]) -> [f32; 4] {
        self.spans
            .iter()
            .rev()
            .find(|s| byte >= s.start && byte < s.end)
            .map(|s| s.color)
            .unwrap_or(base)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: [f32; 4] = [1.0, 0.0, 0.0, 1.0];
    const BLUE: [f32; 4] = [0.0, 0.0, 1.0, 1.0];
    const BLACK: [f32; 4] = [0.0, 0.0, 0.0, 1.0];

    #[test]
    fn utf16_offsets_map_to_bytes_for_ascii() {
        assert_eq!(utf16_to_byte_offset("Hello", 0), 0);
        assert_eq!(utf16_to_byte_offset("Hello", 3), 3);
        assert_eq!(utf16_to_byte_offset("Hello", 99), 5);
    }

    #[test]
    fn utf16_offsets_account_for_multibyte_and_astral_chars() {
        // é is 1 UTF-16 unit / 2 bytes; 😀 is 2 units / 4 bytes.
        let text = "é😀a";
        assert_eq!(utf16_to_byte_offset(text, 1), 2);
        assert_eq!(utf16_to_byte_offset(text, 3), 6);
        // Inside the surrogate pair rounds to the end of the emoji.
        assert_eq!(utf16_to_byte_offset(text, 2), 6);
    }

    #[test]
    fn color_at_uses_base_outside_spans() {
        let spans = ColorSpans::from_utf16("Hello", &[(1, 3, RED)]);
        assert_eq!(spans.color_at(0, BLACK), BLACK);
        assert_eq!(spans.color_at(1, BLACK), RED);
        assert_eq!(spans.color_at(2, BLACK), RED);
        assert_eq!(spans.color_at(3, BLACK), BLACK);
    }

    #[test]
    fn later_spans_win_overlaps() {
        let spans = ColorSpans::from_utf16("Hello", &[(0, 4, RED), (2, 3, BLUE)]);
        assert_eq!(spans.color_at(1, BLACK), RED);
        assert_eq!(spans.color_at(2, BLACK), BLUE);
        assert_eq!(spans.color_at(3, BLACK), RED);
    }

    #[test]
    fn empty_and_inverted_spans_are_dropped() {
        let spans = ColorSpans::from_utf16("Hello", &[(2, 2, RED), (4, 1, BLUE)]);
        assert!(spans.is_empty());
    }

    #[test]
    fn spans_convert_to_byte_ranges() {
        let spans = ColorSpans::from_utf16("é😀a", &[(1, 3, RED)]);
        assert_eq!(spans.color_at(0, BLACK), BLACK);
        assert_eq!(spans.color_at(2, BLACK), RED);
        assert_eq!(spans.color_at(6, BLACK), BLACK);
    }
}
