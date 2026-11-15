//! Glyph forms for vertical text: the font's OpenType `vert` alternates, with
//! the UAX #50 fallbacks from `lopsy_core::vertical_orientation` when the
//! font has none (#1080).
//!
//! Text is shaped horizontally (cosmic-text has no vertical shaping and no
//! feature switches), so `vert` never runs during shaping. The vertical
//! renderer swaps each shaped glyph for its alternate here instead.

use std::collections::HashMap;

use cosmic_text::ttf_parser::gsub::{SingleSubstitution, SubstitutionSubtable};
use cosmic_text::ttf_parser::{Face, GlyphId, Tag};
use cosmic_text::{fontdb, FontSystem};
use lopsy_core::vertical_orientation::{vertical_fallback_form, wants_vertical_alternate, VerticalGlyphForm};

/// `vert` alternates already looked up, keyed by (font, horizontal glyph).
pub type VerticalAlternateCache = HashMap<(fontdb::ID, u16), Option<u16>>;

/// The glyph the font's `vert` feature substitutes for `glyph`, if any. Only
/// single substitutions are applied — the lookup type the OpenType spec
/// prescribes for `vert` — and every script's `vert` feature is consulted, as
/// the shaper never told us which script system it picked.
pub fn vert_alternate(face: &Face, glyph: u16) -> Option<u16> {
    let gsub = face.tables().gsub?;
    let vert = Tag::from_bytes(b"vert");
    let glyph = GlyphId(glyph);
    for feature in gsub.features.into_iter().filter(|f| f.tag == vert) {
        for lookup_index in feature.lookup_indices {
            let Some(lookup) = gsub.lookups.get(lookup_index) else { continue };
            for subtable in lookup.subtables.into_iter::<SubstitutionSubtable>() {
                let SubstitutionSubtable::Single(single) = subtable else { continue };
                if let Some(alternate) = apply_single(&single, glyph) {
                    return Some(alternate);
                }
            }
        }
    }
    None
}

fn apply_single(single: &SingleSubstitution, glyph: GlyphId) -> Option<u16> {
    match single {
        SingleSubstitution::Format1 { coverage, delta } => {
            coverage.get(glyph)?;
            Some((i32::from(glyph.0) + i32::from(*delta)) as u16)
        }
        SingleSubstitution::Format2 { coverage, substitutes } => {
            let index = coverage.get(glyph)?;
            substitutes.get(index).map(|g| g.0)
        }
    }
}

/// The glyph to draw for `c` (shaped as `glyph` in `font_id`) in a vertical
/// column, and how to draw it: the font's vertical alternate upright when it
/// has one, otherwise the horizontal glyph in its UAX #50 fallback form.
pub fn vertical_glyph(
    font_system: &mut FontSystem,
    cache: &mut VerticalAlternateCache,
    font_id: fontdb::ID,
    glyph: u16,
    c: char,
) -> (u16, VerticalGlyphForm) {
    if !wants_vertical_alternate(c) {
        return (glyph, VerticalGlyphForm::Upright);
    }
    let alternate = *cache.entry((font_id, glyph)).or_insert_with(|| {
        let font = font_system.get_font(font_id)?;
        vert_alternate(font.rustybuzz(), glyph)
    });
    match alternate {
        Some(alternate) => (alternate, VerticalGlyphForm::Upright),
        None => (glyph, vertical_fallback_form(c)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_FONT: &[u8] = include_bytes!("../tests/fixtures/LopsyVerticalTest.ttf");
    const INTER: &[u8] = include_bytes!("fonts/Inter-Regular.ttf");

    fn glyph_of(face: &Face, c: char) -> u16 {
        face.glyph_index(c).expect("mapped").0
    }

    #[test]
    fn finds_the_vertical_alternate_of_the_long_vowel_mark() {
        let face = Face::parse(TEST_FONT, 0).expect("parses");
        let horizontal = glyph_of(&face, 'ー');
        let vertical = vert_alternate(&face, horizontal).expect("ー has a vert alternate");
        assert_ne!(vertical, horizontal);
        assert_eq!(face.glyph_name(GlyphId(vertical)), Some("uni30FC.vert"));
    }

    #[test]
    fn glyphs_without_an_alternate_are_left_alone() {
        let face = Face::parse(TEST_FONT, 0).expect("parses");
        assert_eq!(vert_alternate(&face, glyph_of(&face, '「')), None);
        assert_eq!(vert_alternate(&face, glyph_of(&face, '。')), None);
    }

    #[test]
    fn a_font_without_a_vert_feature_has_no_alternates() {
        let face = Face::parse(INTER, 0).expect("parses");
        assert_eq!(vert_alternate(&face, glyph_of(&face, '—')), None);
        assert_eq!(vert_alternate(&face, glyph_of(&face, 'A')), None);
    }
}
