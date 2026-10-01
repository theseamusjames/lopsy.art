//! How a character is set in vertical text, after Unicode UAX #50
//! (Unicode Vertical Text Layout).
//!
//! UAX #50 gives every code point a `Vertical_Orientation`:
//! - `U` — upright, the same glyph as in horizontal text (kana, ideographs).
//! - `R` — rotated 90° clockwise when set sideways (Latin, most symbols).
//! - `Tu` — needs a vertical glyph; upright is the fallback (、。, small kana).
//! - `Tr` — needs a vertical glyph; rotation is the fallback (ー, 「」, （）).
//!
//! Lopsy sets every character upright (Latin letters stack, they are never
//! turned sideways), so `R` only matters as "may have a vertical alternate".
//! The renderer first asks the font for its OpenType `vert` alternate and
//! uses the [`vertical_fallback_form`] only when the font has none.

/// The four `Vertical_Orientation` values of UAX #50.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum VerticalOrientation {
    Upright,
    Rotated,
    TransformedOrUpright,
    TransformedOrRotated,
}

use VerticalOrientation::{
    TransformedOrRotated as TR, TransformedOrUpright as TU, Upright as U,
};

/// Every range whose orientation is not `R` (the default), sorted and
/// non-overlapping. Transcribed from UAX #50's VerticalOrientation.txt.
const RANGES: &[(u32, u32, VerticalOrientation)] = &[
    (0x00A7, 0x00A7, U),
    (0x00A9, 0x00A9, U),
    (0x00AE, 0x00AE, U),
    (0x00B1, 0x00B1, U),
    (0x00BC, 0x00BE, U),
    (0x00D7, 0x00D7, U),
    (0x00F7, 0x00F7, U),
    (0x02EA, 0x02EB, U),
    (0x1100, 0x11FF, U),
    (0x1401, 0x167F, U),
    (0x18B0, 0x18FF, U),
    (0x2016, 0x2016, U),
    (0x2020, 0x2021, U),
    (0x2030, 0x2031, U),
    (0x203B, 0x203C, U),
    (0x2042, 0x2042, U),
    (0x2047, 0x2049, U),
    (0x2051, 0x2051, U),
    (0x2065, 0x2065, U),
    (0x20DD, 0x20E0, U),
    (0x20E2, 0x20E4, U),
    (0x2100, 0x2101, U),
    (0x2103, 0x2109, U),
    (0x210F, 0x210F, U),
    (0x2113, 0x2114, U),
    (0x2116, 0x2117, U),
    (0x211E, 0x2123, U),
    (0x2125, 0x2125, U),
    (0x2127, 0x2127, U),
    (0x2129, 0x2129, U),
    (0x212E, 0x212E, U),
    (0x2135, 0x213F, U),
    (0x2145, 0x214A, U),
    (0x214C, 0x214D, U),
    (0x214F, 0x2189, U),
    (0x218C, 0x218F, U),
    (0x221E, 0x221E, U),
    (0x2234, 0x2235, U),
    (0x2300, 0x2307, U),
    (0x230C, 0x231F, U),
    (0x2324, 0x2328, U),
    (0x2329, 0x232A, TR),
    (0x232B, 0x232B, U),
    (0x237D, 0x239A, U),
    (0x23BE, 0x23CD, U),
    (0x23CF, 0x23CF, U),
    (0x23D1, 0x23DB, U),
    (0x23E2, 0x2422, U),
    (0x2424, 0x24FF, U),
    (0x25A0, 0x2619, U),
    (0x2620, 0x2767, U),
    (0x2776, 0x2793, U),
    (0x2B12, 0x2B2F, U),
    (0x2B50, 0x2B59, U),
    (0x2BB8, 0x2BD1, U),
    (0x2BD3, 0x2BEB, U),
    (0x2BF0, 0x2BFF, U),
    (0x2E50, 0x2E51, U),
    (0x2E80, 0x3000, U),
    (0x3001, 0x3002, TU),
    (0x3003, 0x3007, U),
    (0x3008, 0x3011, TR),
    (0x3012, 0x3013, U),
    (0x3014, 0x301F, TR),
    (0x3020, 0x302F, U),
    (0x3030, 0x3030, TR),
    (0x3031, 0x3040, U),
    (0x3041, 0x3041, TU),
    (0x3042, 0x3042, U),
    (0x3043, 0x3043, TU),
    (0x3044, 0x3044, U),
    (0x3045, 0x3045, TU),
    (0x3046, 0x3046, U),
    (0x3047, 0x3047, TU),
    (0x3048, 0x3048, U),
    (0x3049, 0x3049, TU),
    (0x304A, 0x3062, U),
    (0x3063, 0x3063, TU),
    (0x3064, 0x3082, U),
    (0x3083, 0x3083, TU),
    (0x3084, 0x3084, U),
    (0x3085, 0x3085, TU),
    (0x3086, 0x3086, U),
    (0x3087, 0x3087, TU),
    (0x3088, 0x308D, U),
    (0x308E, 0x308E, TU),
    (0x308F, 0x3094, U),
    (0x3095, 0x3096, TU),
    (0x3097, 0x309A, U),
    (0x309B, 0x309C, TU),
    (0x309D, 0x309F, U),
    (0x30A0, 0x30A0, TR),
    (0x30A1, 0x30A1, TU),
    (0x30A2, 0x30A2, U),
    (0x30A3, 0x30A3, TU),
    (0x30A4, 0x30A4, U),
    (0x30A5, 0x30A5, TU),
    (0x30A6, 0x30A6, U),
    (0x30A7, 0x30A7, TU),
    (0x30A8, 0x30A8, U),
    (0x30A9, 0x30A9, TU),
    (0x30AA, 0x30C2, U),
    (0x30C3, 0x30C3, TU),
    (0x30C4, 0x30E2, U),
    (0x30E3, 0x30E3, TU),
    (0x30E4, 0x30E4, U),
    (0x30E5, 0x30E5, TU),
    (0x30E6, 0x30E6, U),
    (0x30E7, 0x30E7, TU),
    (0x30E8, 0x30ED, U),
    (0x30EE, 0x30EE, TU),
    (0x30EF, 0x30F4, U),
    (0x30F5, 0x30F6, TU),
    (0x30F7, 0x30FB, U),
    (0x30FC, 0x30FC, TR),
    (0x30FD, 0x31EF, U),
    (0x31F0, 0x31FF, TU),
    (0x3200, 0x32FF, U),
    (0x3300, 0x3357, TU),
    (0x3358, 0x337A, U),
    (0x337B, 0x337F, TU),
    (0x3380, 0xA4CF, U),
    (0xA960, 0xA97F, U),
    (0xAC00, 0xD7FF, U),
    (0xE000, 0xFAFF, U),
    (0xFE10, 0xFE1F, U),
    (0xFE30, 0xFE4F, U),
    (0xFE50, 0xFE52, TU),
    (0xFE53, 0xFE57, U),
    (0xFE59, 0xFE5E, TR),
    (0xFE5F, 0xFE62, U),
    (0xFE67, 0xFE6F, U),
    (0xFF01, 0xFF01, TU),
    (0xFF02, 0xFF07, U),
    (0xFF08, 0xFF09, TR),
    (0xFF0A, 0xFF0B, U),
    (0xFF0C, 0xFF0C, TU),
    (0xFF0D, 0xFF0D, TR),
    (0xFF0E, 0xFF0E, TU),
    (0xFF0F, 0xFF19, U),
    (0xFF1A, 0xFF1E, TR),
    (0xFF1F, 0xFF1F, TU),
    (0xFF20, 0xFF3A, U),
    (0xFF3B, 0xFF3B, TR),
    (0xFF3C, 0xFF3C, U),
    (0xFF3D, 0xFF3D, TR),
    (0xFF3E, 0xFF3E, U),
    (0xFF3F, 0xFF3F, TR),
    (0xFF40, 0xFF5A, U),
    (0xFF5B, 0xFF60, TR),
    (0xFFE0, 0xFFE2, U),
    (0xFFE3, 0xFFE3, TR),
    (0xFFE4, 0xFFE7, U),
    (0xFFF0, 0xFFF8, U),
    (0xFFFC, 0xFFFD, U),
    (0x10980, 0x1099F, U),
    (0x11580, 0x115FF, U),
    (0x11A00, 0x11AAF, U),
    (0x13000, 0x1345F, U),
    (0x14400, 0x1467F, U),
    (0x16FE0, 0x18D8F, U),
    (0x1AFF0, 0x1B131, U),
    (0x1B132, 0x1B132, TU),
    (0x1B133, 0x1B14F, U),
    (0x1B150, 0x1B152, TU),
    (0x1B153, 0x1B154, U),
    (0x1B155, 0x1B155, TU),
    (0x1B156, 0x1B163, U),
    (0x1B164, 0x1B167, TU),
    (0x1B168, 0x1B2FF, U),
    (0x1D000, 0x1D1FF, U),
    (0x1D2E0, 0x1D37F, U),
    (0x1D800, 0x1DAAF, U),
    (0x1F000, 0x1F1FF, U),
    (0x1F200, 0x1F201, TU),
    (0x1F202, 0x1F64F, U),
    (0x1F680, 0x1F7FF, U),
    (0x1F900, 0x1FAFF, U),
    (0x20000, 0x2FFFD, U),
    (0x30000, 0x3FFFD, U),
    (0xF0000, 0xFFFFD, U),
    (0x100000, 0x10FFFD, U),
];

/// The UAX #50 `Vertical_Orientation` of `c`.
pub fn vertical_orientation(c: char) -> VerticalOrientation {
    let cp = c as u32;
    let i = RANGES.partition_point(|&(_, end, _)| end < cp);
    match RANGES.get(i) {
        Some(&(start, _, orientation)) if start <= cp => orientation,
        _ => VerticalOrientation::Rotated,
    }
}

/// Whether the font's `vert` alternate should be looked up for `c`. Upright
/// characters are drawn as-is, so only the others are worth the lookup.
pub fn wants_vertical_alternate(c: char) -> bool {
    vertical_orientation(c) != VerticalOrientation::Upright
}

/// How to draw a glyph in a vertical column when the font has no vertical
/// alternate for it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum VerticalGlyphForm {
    /// The horizontal glyph, unchanged.
    Upright,
    /// The horizontal glyph turned 90° clockwise about the centre of its em
    /// box (ー becomes a vertical stroke, 「 becomes ﹁).
    Sideways,
    /// The horizontal glyph moved from the lower-left quadrant of its em box
    /// to the upper-right one (、。，． as vertical text places them).
    UpperRight,
}

/// Punctuation that horizontal fonts draw in the lower-left quadrant of the
/// em box and vertical text hangs in the upper-right one.
fn is_quadrant_punctuation(c: char) -> bool {
    matches!(c, '\u{3001}' | '\u{3002}' | '\u{FF0C}' | '\u{FF0E}' | '\u{FE50}'..='\u{FE52}')
}

/// The fallback form for `c` when the font has no vertical alternate: `Tr`
/// characters turn sideways, the quadrant punctuation among `Tu` characters
/// moves to the upper right, and everything else stays upright (UAX #50's
/// own fallback for `Tu`, and Lopsy's upright setting for `U` and `R`).
pub fn vertical_fallback_form(c: char) -> VerticalGlyphForm {
    match vertical_orientation(c) {
        VerticalOrientation::TransformedOrRotated => VerticalGlyphForm::Sideways,
        VerticalOrientation::TransformedOrUpright if is_quadrant_punctuation(c) => {
            VerticalGlyphForm::UpperRight
        }
        _ => VerticalGlyphForm::Upright,
    }
}

/// Height of the ideographic em box's centre above the baseline, in em. CJK
/// fonts draw their em box from 0.12 em below the baseline to 0.88 em above
/// it, so ー sits on this line and a quarter turn about it keeps a glyph in
/// the same box.
pub const IDEOGRAPHIC_CENTRE_EM: f32 = 0.38;

/// The affine transform that draws `form` from a glyph's outline, in the
/// glyph's own y-up pixel space (origin on the baseline at the pen position),
/// as `[xx, xy, yx, yy, tx, ty]` with `x' = x·xx + y·yx + tx` and
/// `y' = x·xy + y·yy + ty`. `advance` is the glyph's horizontal advance and
/// `font_size` its em size, both in pixels. `None` for [`VerticalGlyphForm::Upright`].
pub fn vertical_form_transform(form: VerticalGlyphForm, advance: f32, font_size: f32) -> Option<[f32; 6]> {
    let cx = advance / 2.0;
    let cy = font_size * IDEOGRAPHIC_CENTRE_EM;
    match form {
        VerticalGlyphForm::Upright => None,
        // Clockwise on screen is (x, y) → (y, −x) about the origin in y-up space.
        VerticalGlyphForm::Sideways => Some([0.0, -1.0, 1.0, 0.0, cx - cy, cx + cy]),
        VerticalGlyphForm::UpperRight => Some([1.0, 0.0, 0.0, 1.0, advance / 2.0, font_size / 2.0]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_are_sorted_and_disjoint() {
        for (start, end, _) in RANGES {
            assert!(start <= end, "{start:X}..{end:X}");
        }
        for pair in RANGES.windows(2) {
            assert!(pair[0].1 < pair[1].0, "{:X} overlaps {:X}", pair[0].1, pair[1].0);
        }
    }

    #[test]
    fn classifies_the_characters_from_issue_1080() {
        assert_eq!(vertical_orientation('ー'), TR);
        assert_eq!(vertical_orientation('「'), TR);
        assert_eq!(vertical_orientation('」'), TR);
        assert_eq!(vertical_orientation('（'), TR);
        assert_eq!(vertical_orientation('〜'), TR);
        assert_eq!(vertical_orientation('。'), TU);
        assert_eq!(vertical_orientation('、'), TU);
        assert_eq!(vertical_orientation('っ'), TU);
        assert_eq!(vertical_orientation('ャ'), TU);
    }

    #[test]
    fn kana_ideographs_and_hangul_are_upright() {
        for c in ['ラ', 'メ', 'ン', 'あ', '漢', '字', '한', '〒', '＃', 'Ａ', '１', '𠀋', '©'] {
            assert_eq!(vertical_orientation(c), U, "{c}");
        }
    }

    #[test]
    fn latin_and_general_punctuation_default_to_rotated() {
        for c in ['A', 'z', '0', '-', '(', '—', '…', '→', 'ｱ', 'Ж', 'א'] {
            assert_eq!(vertical_orientation(c), VerticalOrientation::Rotated, "{c}");
        }
    }

    #[test]
    fn only_upright_characters_skip_the_alternate_lookup() {
        assert!(wants_vertical_alternate('ー'));
        assert!(wants_vertical_alternate('。'));
        assert!(wants_vertical_alternate('—'));
        assert!(!wants_vertical_alternate('ラ'));
        assert!(!wants_vertical_alternate('漢'));
    }

    #[test]
    fn fallback_forms() {
        assert_eq!(vertical_fallback_form('ー'), VerticalGlyphForm::Sideways);
        assert_eq!(vertical_fallback_form('「'), VerticalGlyphForm::Sideways);
        assert_eq!(vertical_fallback_form('〜'), VerticalGlyphForm::Sideways);
        assert_eq!(vertical_fallback_form('。'), VerticalGlyphForm::UpperRight);
        assert_eq!(vertical_fallback_form('、'), VerticalGlyphForm::UpperRight);
        assert_eq!(vertical_fallback_form('，'), VerticalGlyphForm::UpperRight);
        // Small kana are Tu too, but fall back to upright.
        assert_eq!(vertical_fallback_form('っ'), VerticalGlyphForm::Upright);
        assert_eq!(vertical_fallback_form('ラ'), VerticalGlyphForm::Upright);
        // Latin stacks upright in Lopsy's vertical text.
        assert_eq!(vertical_fallback_form('A'), VerticalGlyphForm::Upright);
        assert_eq!(vertical_fallback_form('-'), VerticalGlyphForm::Upright);
    }

    fn apply(m: [f32; 6], (x, y): (f32, f32)) -> (f32, f32) {
        (x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5])
    }

    #[test]
    fn sideways_turns_clockwise_about_the_em_box_centre() {
        let m = vertical_form_transform(VerticalGlyphForm::Sideways, 100.0, 100.0).unwrap();
        // The centre (50, 38) stays put.
        assert_eq!(apply(m, (50.0, 38.0)), (50.0, 38.0));
        // A point right of centre ends up below it; one above ends up right.
        assert_eq!(apply(m, (90.0, 38.0)), (50.0, -2.0));
        assert_eq!(apply(m, (50.0, 78.0)), (90.0, 38.0));
        // ー's horizontal bar across the box becomes a full-height stroke.
        let (a, b) = (apply(m, (0.0, 38.0)), apply(m, (100.0, 38.0)));
        assert_eq!((a.0, b.0), (50.0, 50.0));
        assert_eq!((a.1, b.1), (88.0, -12.0));
    }

    #[test]
    fn upper_right_moves_by_half_an_em_each_way() {
        let m = vertical_form_transform(VerticalGlyphForm::UpperRight, 100.0, 80.0).unwrap();
        assert_eq!(apply(m, (10.0, -5.0)), (60.0, 35.0));
        assert_eq!(vertical_form_transform(VerticalGlyphForm::Upright, 100.0, 80.0), None);
    }
}
