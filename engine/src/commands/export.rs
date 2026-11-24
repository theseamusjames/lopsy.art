//! 16-bit exports whose pixels are converted to the file's colour space.
//!
//! `compositor::export_png_16` and `export_tiff_16` label the composite as
//! the colour space they are given and leave its numbers alone, which is
//! right for Lopsy: a wide-gamut Lopsy document already holds Display P3
//! numbers. These take the space the composite's numbers are in as well,
//! and convert them on the CPU (`lopsy_core::space_convert`) before the
//! file is encoded, for a composite in sRGB written as Display P3 or
//! Rec. 2020. With the two spaces the same they write what
//! `compositor::export_png_16` and `export_tiff_16` write.

use lopsy_core::color::ColorSpace;

use crate::document::compositor;
use crate::engine::EngineInner;
use crate::gpu::read::Read;

/// The colour space codes the hosts pass: 0 sRGB, 1 Display P3, 2 Rec. 2020.
pub fn color_space_from_code(code: u8) -> Result<ColorSpace, String> {
    match code {
        0 => Ok(ColorSpace::Srgb),
        1 => Ok(ColorSpace::DisplayP3),
        2 => Ok(ColorSpace::Rec2020),
        _ => Err(format!("unknown colour space {code}: 0 is sRGB, 1 Display P3, 2 Rec. 2020")),
    }
}

/// The document composited at 16 bits, its numbers taken to be in
/// `pixels_in`, converted to `file_in` and encoded as a PNG tagged as
/// `file_in` (`lopsy_core::export::png_color_chunks`).
pub fn export_png_16_to(engine: &mut EngineInner, pixels_in: u8, file_in: u8) -> Read<Vec<u8>> {
    export_16_to(engine, pixels_in, file_in, lopsy_core::export::encode_png_16)
}

/// As `export_png_16_to`, encoded as a 16-bit RGBA TIFF with `file_in`'s
/// ICC profile (`lopsy_core::tiff`).
pub fn export_tiff_16_to(engine: &mut EngineInner, pixels_in: u8, file_in: u8) -> Read<Vec<u8>> {
    export_16_to(engine, pixels_in, file_in, lopsy_core::tiff::encode_tiff_16)
}

type Encode16 = fn(&[u16], u32, u32, ColorSpace) -> Result<Vec<u8>, String>;

fn export_16_to(engine: &mut EngineInner, pixels_in: u8, file_in: u8, encode: Encode16) -> Read<Vec<u8>> {
    let (from, to) = match (color_space_from_code(pixels_in), color_space_from_code(file_in)) {
        (Ok(from), Ok(to)) => (from, to),
        (Err(e), _) | (_, Err(e)) => return Read::failed(e),
    };
    let (doc_w, doc_h) = (engine.doc_width, engine.doc_height);
    compositor::composite_for_export_u16(engine).and_then(move |mut pixels| {
        lopsy_core::space_convert::convert_rgba16(&mut pixels, from, to);
        encode(&pixels, doc_w, doc_h, to)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_name_the_three_spaces() {
        assert_eq!(color_space_from_code(0), Ok(ColorSpace::Srgb));
        assert_eq!(color_space_from_code(1), Ok(ColorSpace::DisplayP3));
        assert_eq!(color_space_from_code(2), Ok(ColorSpace::Rec2020));
        assert!(color_space_from_code(3).is_err());
    }
}
