//! Static instances of variable TrueType fonts.
//!
//! cosmic-text 0.12 shapes with rustybuzz and rasterizes with swash without
//! ever applying variation coordinates, so a variable font such as
//! `Montserrat[wght].ttf` only ever renders its default instance. Instead of
//! threading coordinates through the text stack, we bake the requested weight
//! into a plain static font: every glyph outline is drawn at the target
//! location (gvar deltas applied by skrifa), re-encoded as simple glyf
//! glyphs, and paired with the varied advance widths. The result registers in
//! fontdb as an ordinary face of the same family at the requested weight, so
//! matching, shaping and rasterization all see the correct instance.

use skrifa::instance::{LocationRef, Size};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::raw::TableProvider;
use skrifa::{FontRef, GlyphId, MetadataProvider, Tag};

use crate::woff2::build_sfnt;

const WGHT: Tag = Tag::new(b"wght");

/// Tables that describe variations or device/hinting data that no longer
/// matches the re-encoded, instruction-free outlines.
const DROPPED_TABLES: [&[u8; 4]; 15] = [
    b"fvar", b"gvar", b"avar", b"HVAR", b"VVAR", b"MVAR", b"STAT", b"cvar",
    b"cvt ", b"fpgm", b"prep", b"hdmx", b"LTSH", b"VDMX", b"DSIG",
];

/// The `wght` axis range of a variable font as `(min, default, max)`, or
/// None when the font has no weight axis.
pub fn wght_axis_range(data: &[u8], index: u32) -> Option<(f32, f32, f32)> {
    let font = FontRef::from_index(data, index).ok()?;
    let axis = font.axes().get_by_tag(WGHT)?;
    Some((axis.min_value(), axis.default_value(), axis.max_value()))
}

/// A glyph outline as TrueType contours: each point is `(x, y, on_curve)`.
#[derive(Default)]
struct ContourPen {
    contours: Vec<Vec<(i16, i16, bool)>>,
    current: Vec<(i16, i16, bool)>,
}

fn to_i16(v: f32) -> i16 {
    v.round().clamp(i16::MIN as f32, i16::MAX as f32) as i16
}

impl ContourPen {
    fn push(&mut self, x: f32, y: f32, on_curve: bool) {
        self.current.push((to_i16(x), to_i16(y), on_curve));
    }

    fn finish_contour(&mut self) {
        let mut contour = std::mem::take(&mut self.current);
        // Pens close a contour by drawing back to its start point; TrueType
        // closes contours implicitly, so drop the duplicate end point.
        if contour.len() > 1 && contour.first() == contour.last() {
            contour.pop();
        }
        if !contour.is_empty() {
            self.contours.push(contour);
        }
    }
}

impl OutlinePen for ContourPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.finish_contour();
        self.push(x, y, true);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.push(x, y, true);
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.push(cx0, cy0, false);
        self.push(x, y, true);
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        // glyf outlines never produce cubics; approximate defensively with the
        // single quadratic that matches the cubic's end tangents on average.
        let (px, py) = self
            .current
            .last()
            .map(|&(px, py, _)| (px as f32, py as f32))
            .unwrap_or((cx0, cy0));
        let qx = (3.0 * (cx0 + cx1) - px - x) / 4.0;
        let qy = (3.0 * (cy0 + cy1) - py - y) / 4.0;
        self.quad_to(qx, qy, x, y);
    }

    fn close(&mut self) {
        self.finish_contour();
    }
}

struct EncodedGlyph {
    data: Vec<u8>,
    x_min: i16,
    x_max: i16,
    y_min: i16,
    y_max: i16,
    points: usize,
    contours: usize,
}

fn encode_simple_glyph(contours: &[Vec<(i16, i16, bool)>]) -> Option<EncodedGlyph> {
    let points: Vec<&(i16, i16, bool)> = contours.iter().flatten().collect();
    if points.is_empty() {
        return None;
    }
    let x_min = points.iter().map(|p| p.0).min()?;
    let x_max = points.iter().map(|p| p.0).max()?;
    let y_min = points.iter().map(|p| p.1).min()?;
    let y_max = points.iter().map(|p| p.1).max()?;

    let mut data = Vec::with_capacity(12 + contours.len() * 2 + points.len() * 5);
    data.extend_from_slice(&(contours.len() as i16).to_be_bytes());
    for v in [x_min, y_min, x_max, y_max] {
        data.extend_from_slice(&v.to_be_bytes());
    }
    let mut end = 0usize;
    for contour in contours {
        end += contour.len();
        data.extend_from_slice(&u16::try_from(end - 1).ok()?.to_be_bytes());
    }
    data.extend_from_slice(&0u16.to_be_bytes()); // no instructions
    // Flags carry only the on-curve bit, so every delta is a full i16.
    data.extend(points.iter().map(|p| u8::from(p.2)));
    for axis in [0usize, 1] {
        let mut prev = 0i16;
        for p in &points {
            let v = if axis == 0 { p.0 } else { p.1 };
            data.extend_from_slice(&v.wrapping_sub(prev).to_be_bytes());
            prev = v;
        }
    }
    if data.len() % 4 != 0 {
        data.resize(data.len() + 4 - data.len() % 4, 0);
    }
    Some(EncodedGlyph {
        data,
        x_min,
        x_max,
        y_min,
        y_max,
        points: points.len(),
        contours: contours.len(),
    })
}

fn put_u16(table: &mut [u8], offset: usize, value: u16) -> Option<()> {
    table.get_mut(offset..offset + 2)?.copy_from_slice(&value.to_be_bytes());
    Some(())
}

fn put_i16(table: &mut [u8], offset: usize, value: i16) -> Option<()> {
    put_u16(table, offset, value as u16)
}

/// Build a static TrueType font from face `index` of the variable font `data`
/// with its `wght` axis pinned to `weight` (clamped to the axis range). Other
/// axes stay at their defaults. The instance's OS/2 usWeightClass is set to
/// `weight` so font matching picks it for that weight.
///
/// Returns None for fonts without a `wght` axis or without glyf outlines
/// (CFF2), or when the font data is malformed.
pub fn instantiate_wght(data: &[u8], index: u32, weight: u16) -> Option<Vec<u8>> {
    let font = FontRef::from_index(data, index).ok()?;
    let axis = font.axes().get_by_tag(WGHT)?;
    font.glyf().ok()?;
    let value = (weight as f32).clamp(axis.min_value(), axis.max_value());
    let location = font.axes().location([(WGHT, value)]);
    let location_ref: LocationRef = (&location).into();

    let num_glyphs = font.maxp().ok()?.num_glyphs() as u32;
    let outlines = font.outline_glyphs();
    let metrics = font.glyph_metrics(Size::unscaled(), location_ref);

    let mut glyf = Vec::new();
    let mut loca = Vec::with_capacity((num_glyphs as usize + 1) * 4);
    let mut hmtx = Vec::with_capacity(num_glyphs as usize * 4);
    let (mut bbox_x_min, mut bbox_y_min, mut bbox_x_max, mut bbox_y_max) = (i16::MAX, i16::MAX, i16::MIN, i16::MIN);
    let (mut advance_max, mut min_lsb, mut min_rsb, mut max_extent) = (0u16, i16::MAX, i16::MAX, i16::MIN);
    let (mut max_points, mut max_contours) = (0usize, 0usize);

    for gid in 0..num_glyphs {
        let glyph_id = GlyphId::new(gid);
        let mut pen = ContourPen::default();
        if let Some(glyph) = outlines.get(glyph_id) {
            glyph.draw(DrawSettings::unhinted(Size::unscaled(), location_ref), &mut pen).ok()?;
            pen.finish_contour();
        }
        let advance = metrics
            .advance_width(glyph_id)
            .map(|a| a.round().clamp(0.0, u16::MAX as f32) as u16)
            .unwrap_or(0);

        loca.extend_from_slice(&(glyf.len() as u32).to_be_bytes());
        let lsb = match encode_simple_glyph(&pen.contours) {
            Some(g) => {
                glyf.extend_from_slice(&g.data);
                bbox_x_min = bbox_x_min.min(g.x_min);
                bbox_y_min = bbox_y_min.min(g.y_min);
                bbox_x_max = bbox_x_max.max(g.x_max);
                bbox_y_max = bbox_y_max.max(g.y_max);
                min_lsb = min_lsb.min(g.x_min);
                min_rsb = min_rsb.min((advance as i32 - g.x_max as i32).clamp(i16::MIN as i32, i16::MAX as i32) as i16);
                max_extent = max_extent.max(g.x_max);
                max_points = max_points.max(g.points);
                max_contours = max_contours.max(g.contours);
                g.x_min
            }
            None => 0,
        };
        advance_max = advance_max.max(advance);
        hmtx.extend_from_slice(&advance.to_be_bytes());
        hmtx.extend_from_slice(&lsb.to_be_bytes());
    }
    loca.extend_from_slice(&(glyf.len() as u32).to_be_bytes());
    if bbox_x_min > bbox_x_max {
        (bbox_x_min, bbox_y_min, bbox_x_max, bbox_y_max) = (0, 0, 0, 0);
        (min_lsb, min_rsb, max_extent) = (0, 0, 0);
    }

    let replaced: [&[u8; 4]; 3] = [b"glyf", b"loca", b"hmtx"];
    let mut tables: Vec<(u32, Vec<u8>)> = Vec::new();
    for record in font.table_directory.table_records() {
        let tag = record.tag();
        let tag_bytes = tag.into_bytes();
        if DROPPED_TABLES.contains(&&tag_bytes) || replaced.contains(&&tag_bytes) {
            continue;
        }
        let bytes = font.table_data(tag)?.as_bytes().to_vec();
        tables.push((u32::from_be_bytes(tag_bytes), bytes));
    }

    let table = |tables: &mut Vec<(u32, Vec<u8>)>, tag: &[u8; 4]| -> Option<usize> {
        let t = u32::from_be_bytes(*tag);
        tables.iter().position(|(x, _)| *x == t)
    };

    let head = table(&mut tables, b"head")?;
    let head = &mut tables[head].1;
    put_i16(head, 36, bbox_x_min)?;
    put_i16(head, 38, bbox_y_min)?;
    put_i16(head, 40, bbox_x_max)?;
    put_i16(head, 42, bbox_y_max)?;
    put_i16(head, 50, 1)?; // long loca offsets

    let hhea = table(&mut tables, b"hhea")?;
    let hhea = &mut tables[hhea].1;
    put_u16(hhea, 10, advance_max)?;
    put_i16(hhea, 12, min_lsb)?;
    put_i16(hhea, 14, min_rsb)?;
    put_i16(hhea, 16, max_extent)?;
    put_u16(hhea, 34, u16::try_from(num_glyphs).ok()?)?;

    let maxp = table(&mut tables, b"maxp")?;
    let maxp = &mut tables[maxp].1;
    if maxp.len() >= 32 {
        put_u16(maxp, 6, u16::try_from(max_points).ok()?)?;
        put_u16(maxp, 8, u16::try_from(max_contours).ok()?)?;
        put_u16(maxp, 10, 0)?; // maxCompositePoints
        put_u16(maxp, 12, 0)?; // maxCompositeContours
        put_u16(maxp, 26, 0)?; // maxSizeOfInstructions
        put_u16(maxp, 28, 0)?; // maxComponentElements
        put_u16(maxp, 30, 0)?; // maxComponentDepth
    }

    if let Some(os2) = table(&mut tables, b"OS/2") {
        put_u16(&mut tables[os2].1, 4, weight)?;
    }

    tables.push((u32::from_be_bytes(*b"glyf"), glyf));
    tables.push((u32::from_be_bytes(*b"loca"), loca));
    tables.push((u32::from_be_bytes(*b"hmtx"), hmtx));
    build_sfnt(0x0001_0000, &tables)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::woff2::decode_woff2;

    fn montserrat() -> Vec<u8> {
        decode_woff2(include_bytes!("../tests/fixtures/Montserrat-wght-latin.woff2")).expect("decodes")
    }

    fn advance_of(data: &[u8], c: char) -> f32 {
        let font = FontRef::new(data).unwrap();
        let gid = font.charmap().map(c).unwrap();
        font.glyph_metrics(Size::unscaled(), LocationRef::default())
            .advance_width(gid)
            .unwrap()
    }

    /// Filled area of `c`'s outline in font units (polygon through every
    /// on- and off-curve point — close enough to compare weights).
    fn ink_area(data: &[u8], c: char) -> f32 {
        let font = FontRef::new(data).unwrap();
        let gid = font.charmap().map(c).unwrap();
        let mut pen = ContourPen::default();
        font.outline_glyphs()
            .get(gid)
            .unwrap()
            .draw(DrawSettings::unhinted(Size::unscaled(), LocationRef::default()), &mut pen)
            .unwrap();
        pen.finish_contour();
        pen.contours
            .iter()
            .map(|contour| {
                let n = contour.len();
                (0..n)
                    .map(|i| {
                        let (x0, y0, _) = contour[i];
                        let (x1, y1, _) = contour[(i + 1) % n];
                        x0 as f32 * y1 as f32 - x1 as f32 * y0 as f32
                    })
                    .sum::<f32>()
                    / 2.0
            })
            .sum::<f32>()
            .abs()
    }

    #[test]
    fn reports_the_wght_axis_range() {
        assert_eq!(wght_axis_range(&montserrat(), 0), Some((100.0, 100.0, 900.0)));
    }

    #[test]
    fn static_fonts_have_no_wght_axis() {
        let inter: &[u8] = include_bytes!("fonts/Inter-Regular.ttf");
        assert_eq!(wght_axis_range(inter, 0), None);
        assert!(instantiate_wght(inter, 0, 700).is_none());
    }

    #[test]
    fn instance_is_a_static_font_at_the_requested_weight() {
        let bold = instantiate_wght(&montserrat(), 0, 700).expect("instance");
        let font = FontRef::new(&bold).unwrap();
        assert!(font.axes().is_empty(), "instance must not be variable");
        assert_eq!(font.os2().unwrap().us_weight_class(), 700);

        let mut db = cosmic_text::fontdb::Database::new();
        db.load_font_data(bold);
        let face = db.faces().next().expect("instance parses as a face");
        assert_eq!(face.weight, cosmic_text::fontdb::Weight(700));
    }

    #[test]
    fn default_weight_instance_matches_the_variable_font() {
        // Montserrat's default instance is Thin (100).
        let var = montserrat();
        let thin = instantiate_wght(&var, 0, 100).expect("instance");
        for c in "HAMBURGEFONTSivx&?".chars() {
            assert_eq!(advance_of(&thin, c), advance_of(&var, c), "advance of {c}");
            assert_eq!(ink_area(&thin, c), ink_area(&var, c), "outline of {c}");
        }
    }

    #[test]
    fn heavier_instances_have_heavier_outlines_and_wider_advances() {
        let var = montserrat();
        let thin = instantiate_wght(&var, 0, 100).expect("thin");
        let regular = instantiate_wght(&var, 0, 400).expect("regular");
        let black = instantiate_wght(&var, 0, 900).expect("black");
        let ink = |d: &[u8]| "HAMBURGEFONTS".chars().map(|c| ink_area(d, c)).sum::<f32>();
        let width = |d: &[u8]| "HAMBURGEFONTS".chars().map(|c| advance_of(d, c)).sum::<f32>();
        assert!(ink(&regular) > ink(&thin) * 1.5, "regular {} thin {}", ink(&regular), ink(&thin));
        assert!(ink(&black) > ink(&regular) * 1.5, "black {} regular {}", ink(&black), ink(&regular));
        assert!(width(&thin) < width(&regular) && width(&regular) < width(&black));
    }

    #[test]
    fn weight_is_clamped_to_the_axis_range() {
        let var = montserrat();
        let over = instantiate_wght(&var, 0, 1000).expect("instance");
        let max = instantiate_wght(&var, 0, 900).expect("instance");
        assert_eq!(advance_of(&over, 'H'), advance_of(&max, 'H'));
    }
}
