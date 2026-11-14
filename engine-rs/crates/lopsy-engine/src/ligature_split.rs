//! Breaking optional ligatures apart for letter-spaced text (#1185).
//!
//! CSS Text 3 turns optional ligatures (`liga`, `clig`, `dlig`, `hlig`) off
//! when letter spacing is non-zero, so "fi" spreads out like every other
//! pair. cosmic-text 0.12 always shapes with the font's default features and
//! has no way to pass feature settings, so after layout each glyph that
//! covers several characters is re-shaped on its own with those features off
//! and, when that yields more than one cluster, replaced by the resulting
//! glyphs. Only scripts with no joining behaviour are touched: re-shaping an
//! Arabic or Indic cluster out of context would pick the wrong forms, and
//! their multi-character glyphs are mostly required ligatures anyway.

use std::borrow::Cow;

use cosmic_text::{Buffer, FontSystem, LayoutGlyph};
use swash::shape::ShapeContext;
use swash::text::Script;

const OPTIONAL_LIGATURES_OFF: [(&str, u16); 4] =
    [("liga", 0), ("clig", 0), ("dlig", 0), ("hlig", 0)];

/// One glyph that replaces part of a broken-up ligature. Offsets are
/// relative to the ligature glyph: `start`/`end` are byte offsets into the
/// buffer line, `pen_x` is where this glyph's advance starts (px from the
/// ligature's x) and `x_offset`/`y_offset` are em units like
/// `LayoutGlyph`'s.
#[derive(Clone, Debug, PartialEq)]
pub struct LigaturePart {
    pub glyph_id: u16,
    pub start: usize,
    pub end: usize,
    pub pen_x: f32,
    pub advance: f32,
    pub x_offset: f32,
    pub y_offset: f32,
}

/// The glyph at `start..end` of buffer line `line_i` is drawn as `parts`.
#[derive(Clone, Debug, PartialEq)]
pub struct LigatureSplit {
    pub line_i: usize,
    pub start: usize,
    pub end: usize,
    pub parts: Vec<LigaturePart>,
}

fn is_non_joining_char(c: char) -> bool {
    matches!(
        c as u32,
        0x0000..=0x052F // Latin, IPA, Greek, Cyrillic
            | 0x1D00..=0x1FFF // phonetic extensions, Latin/Greek extended
            | 0x2000..=0x2BFF // punctuation, symbols, arrows, math
            | 0x2C60..=0x2C7F // Latin Extended-C
            | 0xA720..=0xA7FF // Latin Extended-D
            | 0xFB00..=0xFB06 // Latin presentation forms
    )
}

/// Whether the text under a single glyph is a candidate for splitting: more
/// than one character, all from scripts that shape without joining.
pub fn is_splittable_cluster(text: &str) -> bool {
    text.chars().nth(1).is_some() && text.chars().all(is_non_joining_char)
}

/// Re-shape `text` with optional ligatures off. Returns None when it still
/// comes out as a single cluster (nothing to split).
fn shape_without_ligatures(
    ctx: &mut ShapeContext,
    font: swash::FontRef<'_>,
    font_size: f32,
    text: &str,
    start: usize,
) -> Option<Vec<LigaturePart>> {
    let mut shaper = ctx
        .builder(font)
        .script(Script::Latin)
        .size(font_size)
        .features(OPTIONAL_LIGATURES_OFF)
        .build();
    shaper.add_str(text);
    let mut parts = Vec::new();
    let mut clusters = 0usize;
    let mut pen_x = 0.0f32;
    shaper.shape_with(|cluster| {
        clusters += 1;
        let cluster_start = start + cluster.source.start as usize;
        let cluster_end = start + cluster.source.end as usize;
        for glyph in cluster.glyphs {
            parts.push(LigaturePart {
                glyph_id: glyph.id,
                start: cluster_start,
                end: cluster_end,
                pen_x,
                advance: glyph.advance,
                x_offset: glyph.x / font_size,
                y_offset: glyph.y / font_size,
            });
            pen_x += glyph.advance;
        }
    });
    (clusters > 1).then_some(parts)
}

/// Find every optional ligature in the laid-out `buffer` and how to draw it
/// as separate glyphs.
pub fn find_ligature_splits(
    font_system: &mut FontSystem,
    ctx: &mut ShapeContext,
    buffer: &Buffer,
) -> Vec<LigatureSplit> {
    let mut splits = Vec::new();
    for run in buffer.layout_runs() {
        for (i, glyph) in run.glyphs.iter().enumerate() {
            if glyph.level.is_rtl() {
                continue;
            }
            let Some(text) = run.text.get(glyph.start..glyph.end) else {
                continue;
            };
            if !is_splittable_cluster(text) {
                continue;
            }
            // A cluster that also holds other glyphs (base + mark) is left
            // alone: its glyphs are positioned relative to each other.
            let shares_cluster = run
                .glyphs
                .iter()
                .enumerate()
                .any(|(j, g)| j != i && g.start == glyph.start && g.end == glyph.end);
            if shares_cluster {
                continue;
            }
            let Some(font) = font_system.get_font(glyph.font_id) else {
                continue;
            };
            if let Some(parts) =
                shape_without_ligatures(ctx, font.as_swash(), glyph.font_size, text, glyph.start)
            {
                splits.push(LigatureSplit {
                    line_i: run.line_i,
                    start: glyph.start,
                    end: glyph.end,
                    parts,
                });
            }
        }
    }
    splits
}

/// `glyphs` (one layout run of buffer line `line_i`) with each split
/// ligature replaced by its parts. Glyphs to the right of a ligature move by
/// the difference between the parts' total advance and the ligature's.
pub fn expand_run_glyphs<'a>(
    glyphs: &'a [LayoutGlyph],
    line_i: usize,
    splits: &[LigatureSplit],
) -> Cow<'a, [LayoutGlyph]> {
    let split_for = |g: &LayoutGlyph| {
        splits.iter().find(|s| {
            s.line_i == line_i && s.start == g.start && s.end == g.end && !g.level.is_rtl()
        })
    };
    let deltas: Vec<(f32, f32)> = glyphs
        .iter()
        .filter_map(|g| {
            let split = split_for(g)?;
            let total: f32 = split.parts.iter().map(|p| p.advance).sum();
            Some((g.x, total - g.w))
        })
        .collect();
    if deltas.is_empty() {
        return Cow::Borrowed(glyphs);
    }
    let shift_at = |x: f32| -> f32 {
        deltas
            .iter()
            .filter(|(lx, _)| *lx < x)
            .map(|(_, d)| d)
            .sum()
    };

    let mut out = Vec::with_capacity(glyphs.len() + deltas.len());
    for g in glyphs {
        let shift = shift_at(g.x);
        match split_for(g) {
            Some(split) => {
                for part in &split.parts {
                    let mut piece = g.clone();
                    piece.glyph_id = part.glyph_id;
                    piece.start = part.start;
                    piece.end = part.end;
                    piece.x = g.x + shift + part.pen_x;
                    piece.w = part.advance;
                    piece.x_offset = part.x_offset;
                    piece.y_offset = part.y_offset;
                    out.push(piece);
                }
            }
            None => {
                let mut moved = g.clone();
                moved.x += shift;
                out.push(moved);
            }
        }
    }
    Cow::Owned(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_multi_character_non_joining_clusters_are_splittable() {
        assert!(is_splittable_cluster("fi"));
        assert!(is_splittable_cluster("ffl"));
        assert!(is_splittable_cluster("->"));
        assert!(!is_splittable_cluster("f"));
        assert!(!is_splittable_cluster("\u{FB01}"));
        assert!(
            !is_splittable_cluster("\u{0644}\u{0627}"),
            "Arabic lam-alef is required"
        );
        assert!(
            !is_splittable_cluster("\u{0915}\u{094D}\u{0937}"),
            "Devanagari conjunct"
        );
    }
}
