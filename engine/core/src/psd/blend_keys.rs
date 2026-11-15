use crate::color::BlendMode;

/// Convert a Lopsy BlendMode to the PSD 4-byte blend mode key.
pub fn blend_mode_to_psd_key(mode: BlendMode) -> [u8; 4] {
    match mode {
        BlendMode::Normal => *b"norm",
        BlendMode::Multiply => *b"mul ",
        BlendMode::Screen => *b"scrn",
        BlendMode::Overlay => *b"over",
        BlendMode::Darken => *b"dark",
        BlendMode::Lighten => *b"lite",
        BlendMode::ColorDodge => *b"div ",
        BlendMode::ColorBurn => *b"idiv",
        BlendMode::HardLight => *b"hLit",
        BlendMode::SoftLight => *b"sLit",
        BlendMode::Difference => *b"diff",
        BlendMode::Exclusion => *b"smud",
        BlendMode::Hue => *b"hue ",
        BlendMode::Saturation => *b"sat ",
        BlendMode::Color => *b"colr",
        BlendMode::Luminosity => *b"lum ",
    }
}

/// Convert a PSD 4-byte blend mode key to a Lopsy BlendMode.
/// Returns Normal for unrecognized keys.
pub fn psd_key_to_blend_mode(key: &[u8; 4]) -> BlendMode {
    match key {
        b"norm" => BlendMode::Normal,
        b"mul " => BlendMode::Multiply,
        b"scrn" => BlendMode::Screen,
        b"over" => BlendMode::Overlay,
        b"dark" => BlendMode::Darken,
        b"lite" => BlendMode::Lighten,
        b"div " => BlendMode::ColorDodge,
        b"idiv" => BlendMode::ColorBurn,
        b"hLit" => BlendMode::HardLight,
        b"sLit" => BlendMode::SoftLight,
        b"diff" => BlendMode::Difference,
        b"smud" => BlendMode::Exclusion,
        b"hue " => BlendMode::Hue,
        b"sat " => BlendMode::Saturation,
        b"colr" => BlendMode::Color,
        b"lum " => BlendMode::Luminosity,
        // PSD has additional modes Lopsy doesn't support — fall back to Normal
        _ => BlendMode::Normal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_all_modes() {
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
        for mode in modes {
            let key = blend_mode_to_psd_key(mode);
            let back = psd_key_to_blend_mode(&key);
            assert_eq!(back, mode, "roundtrip failed for {mode:?}");
        }
    }

    #[test]
    fn unknown_key_returns_normal() {
        assert_eq!(psd_key_to_blend_mode(b"xxxx"), BlendMode::Normal);
    }
}
