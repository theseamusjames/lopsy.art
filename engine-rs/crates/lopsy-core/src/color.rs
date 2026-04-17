use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Color8 {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ColorSpace {
    Srgb,
    DisplayP3,
    Rec2020,
    LinearSrgb,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum BlendMode {
    Normal = 0,
    Multiply = 1,
    Screen = 2,
    Overlay = 3,
    Darken = 4,
    Lighten = 5,
    ColorDodge = 6,
    ColorBurn = 7,
    HardLight = 8,
    SoftLight = 9,
    Difference = 10,
    Exclusion = 11,
    Hue = 12,
    Saturation = 13,
    Color = 14,
    Luminosity = 15,
}

impl BlendMode {
    /// Every blend mode, in PSD-index order. The enum's `#[repr(u8)]`
    /// discriminants match the index into this slice by construction.
    pub const ALL: &'static [BlendMode] = &[
        Self::Normal,
        Self::Multiply,
        Self::Screen,
        Self::Overlay,
        Self::Darken,
        Self::Lighten,
        Self::ColorDodge,
        Self::ColorBurn,
        Self::HardLight,
        Self::SoftLight,
        Self::Difference,
        Self::Exclusion,
        Self::Hue,
        Self::Saturation,
        Self::Color,
        Self::Luminosity,
    ];

    pub fn from_u8(v: u8) -> Option<Self> {
        Self::ALL.get(v as usize).copied()
    }

    /// Lowercase kebab-case identifier used by the TS `BlendMode` union
    /// and by PSD blend-key tables. Matches `src/types/color.ts`.
    pub const fn kebab_name(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Multiply => "multiply",
            Self::Screen => "screen",
            Self::Overlay => "overlay",
            Self::Darken => "darken",
            Self::Lighten => "lighten",
            Self::ColorDodge => "color-dodge",
            Self::ColorBurn => "color-burn",
            Self::HardLight => "hard-light",
            Self::SoftLight => "soft-light",
            Self::Difference => "difference",
            Self::Exclusion => "exclusion",
            Self::Hue => "hue",
            Self::Saturation => "saturation",
            Self::Color => "color",
            Self::Luminosity => "luminosity",
        }
    }

    /// PascalCase name used by the serde representation that engine-sync
    /// sends over the WASM bridge. Matches the enum variant names.
    pub const fn pascal_name(self) -> &'static str {
        match self {
            Self::Normal => "Normal",
            Self::Multiply => "Multiply",
            Self::Screen => "Screen",
            Self::Overlay => "Overlay",
            Self::Darken => "Darken",
            Self::Lighten => "Lighten",
            Self::ColorDodge => "ColorDodge",
            Self::ColorBurn => "ColorBurn",
            Self::HardLight => "HardLight",
            Self::SoftLight => "SoftLight",
            Self::Difference => "Difference",
            Self::Exclusion => "Exclusion",
            Self::Hue => "Hue",
            Self::Saturation => "Saturation",
            Self::Color => "Color",
            Self::Luminosity => "Luminosity",
        }
    }

    /// Human-readable display name used in the blend-mode dropdown.
    pub const fn display_name(self) -> &'static str {
        match self {
            Self::Normal => "Normal",
            Self::Multiply => "Multiply",
            Self::Screen => "Screen",
            Self::Overlay => "Overlay",
            Self::Darken => "Darken",
            Self::Lighten => "Lighten",
            Self::ColorDodge => "Color Dodge",
            Self::ColorBurn => "Color Burn",
            Self::HardLight => "Hard Light",
            Self::SoftLight => "Soft Light",
            Self::Difference => "Difference",
            Self::Exclusion => "Exclusion",
            Self::Hue => "Hue",
            Self::Saturation => "Saturation",
            Self::Color => "Color",
            Self::Luminosity => "Luminosity",
        }
    }

    /// PSD blend-key string as used in the file format spec. Lives
    /// alongside the other name formats so one change lands everywhere.
    pub const fn psd_key(self) -> &'static [u8; 4] {
        match self {
            Self::Normal => b"norm",
            Self::Multiply => b"mul ",
            Self::Screen => b"scrn",
            Self::Overlay => b"over",
            Self::Darken => b"dark",
            Self::Lighten => b"lite",
            Self::ColorDodge => b"div ",
            Self::ColorBurn => b"idiv",
            Self::HardLight => b"hLit",
            Self::SoftLight => b"sLit",
            Self::Difference => b"diff",
            Self::Exclusion => b"smud",
            Self::Hue => b"hue ",
            Self::Saturation => b"sat ",
            Self::Color => b"colr",
            Self::Luminosity => b"lum ",
        }
    }

    /// The PSD-index of this mode (matches its `#[repr(u8)]` discriminant).
    pub const fn psd_index(self) -> u8 {
        self as u8
    }
}

#[cfg(test)]
mod blend_mode_tables_tests {
    use super::BlendMode;

    /// Drift detector: the kebab names used by TS (src/types/blend-mode-tables.ts)
    /// must exactly match the Rust enum's names in PSD-index order. If this
    /// test fails, the TS union/tables need to be updated — the Rust enum
    /// is the source of truth.
    #[test]
    fn kebab_names_match_ts_source_of_truth() {
        let expected: &[&str] = &[
            "normal", "multiply", "screen", "overlay",
            "darken", "lighten", "color-dodge", "color-burn",
            "hard-light", "soft-light", "difference", "exclusion",
            "hue", "saturation", "color", "luminosity",
        ];
        let actual: Vec<&'static str> =
            BlendMode::ALL.iter().map(|m| m.kebab_name()).collect();
        assert_eq!(actual, expected);
    }

    #[test]
    fn psd_index_matches_repr_discriminant() {
        for (i, mode) in BlendMode::ALL.iter().enumerate() {
            assert_eq!(mode.psd_index() as usize, i, "{:?} at slot {}", mode, i);
            assert_eq!(BlendMode::from_u8(mode.psd_index()), Some(*mode));
        }
    }

    #[test]
    fn from_u8_rejects_out_of_range() {
        assert_eq!(BlendMode::from_u8(16), None);
        assert_eq!(BlendMode::from_u8(255), None);
    }

    #[test]
    fn psd_keys_are_four_bytes_each() {
        for mode in BlendMode::ALL {
            assert_eq!(mode.psd_key().len(), 4, "{:?}", mode);
        }
    }

    #[test]
    fn pascal_names_are_valid_rust_identifiers() {
        for mode in BlendMode::ALL {
            let name = mode.pascal_name();
            assert!(name.chars().next().unwrap().is_ascii_uppercase());
            assert!(name.chars().all(|c| c.is_ascii_alphanumeric()));
        }
    }
}

/// sRGB EOTF: convert 8-bit sRGB to linear float
pub fn srgb_to_linear(v: u8) -> f32 {
    let s = v as f32 / 255.0;
    if s <= 0.04045 {
        s / 12.92
    } else {
        ((s + 0.055) / 1.055).powf(2.4)
    }
}

/// sRGB OETF: convert linear float to 8-bit sRGB
pub fn linear_to_srgb(v: f32) -> u8 {
    let c = v.clamp(0.0, 1.0);
    let s = if c <= 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    };
    (s * 255.0 + 0.5) as u8
}

impl Color8 {
    pub fn new(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self { r, g, b, a }
    }

    pub fn to_linear(self) -> Color {
        Color {
            r: srgb_to_linear(self.r),
            g: srgb_to_linear(self.g),
            b: srgb_to_linear(self.b),
            a: self.a as f32 / 255.0,
        }
    }
}

impl Color {
    pub fn new(r: f32, g: f32, b: f32, a: f32) -> Self {
        Self { r, g, b, a }
    }

    pub fn transparent() -> Self {
        Self { r: 0.0, g: 0.0, b: 0.0, a: 0.0 }
    }

    pub fn to_srgb8(self) -> Color8 {
        Color8 {
            r: linear_to_srgb(self.r),
            g: linear_to_srgb(self.g),
            b: linear_to_srgb(self.b),
            a: (self.a.clamp(0.0, 1.0) * 255.0 + 0.5) as u8,
        }
    }

    pub fn clamp01(self) -> Self {
        Self {
            r: self.r.clamp(0.0, 1.0),
            g: self.g.clamp(0.0, 1.0),
            b: self.b.clamp(0.0, 1.0),
            a: self.a.clamp(0.0, 1.0),
        }
    }
}

/// RGB to HSL conversion (all values 0..1)
pub fn rgb_to_hsl(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;

    if (max - min).abs() < 1e-7 {
        return (0.0, 0.0, l);
    }

    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };

    let h = if (max - r).abs() < 1e-7 {
        let mut h = (g - b) / d;
        if g < b {
            h += 6.0;
        }
        h
    } else if (max - g).abs() < 1e-7 {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };

    (h / 6.0, s, l)
}

fn hue_to_rgb(p: f32, q: f32, mut t: f32) -> f32 {
    if t < 0.0 { t += 1.0; }
    if t > 1.0 { t -= 1.0; }
    if t < 1.0 / 6.0 {
        return p + (q - p) * 6.0 * t;
    }
    if t < 1.0 / 2.0 {
        return q;
    }
    if t < 2.0 / 3.0 {
        return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
    }
    p
}

/// HSL to RGB conversion (all values 0..1)
pub fn hsl_to_rgb(h: f32, s: f32, l: f32) -> (f32, f32, f32) {
    if s.abs() < 1e-7 {
        return (l, l, l);
    }

    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;

    (
        hue_to_rgb(p, q, h + 1.0 / 3.0),
        hue_to_rgb(p, q, h),
        hue_to_rgb(p, q, h - 1.0 / 3.0),
    )
}

/// Luminance (Rec. 709)
pub fn luminance(r: f32, g: f32, b: f32) -> f32 {
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

/// Set luminance of an RGB color while preserving hue and saturation
pub fn set_luminance(r: f32, g: f32, b: f32, target_l: f32) -> (f32, f32, f32) {
    let d = target_l - luminance(r, g, b);
    let (r, g, b) = (r + d, g + d, b + d);
    clip_color(r, g, b)
}

/// Clip color to valid range while preserving luminance
fn clip_color(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let l = luminance(r, g, b);
    let n = r.min(g).min(b);
    let x = r.max(g).max(b);

    let (mut r, mut g, mut b) = (r, g, b);
    if n < 0.0 {
        let d = l - n;
        if d.abs() > 1e-7 {
            r = l + (r - l) * l / d;
            g = l + (g - l) * l / d;
            b = l + (b - l) * l / d;
        }
    }
    if x > 1.0 {
        let d = x - l;
        if d.abs() > 1e-7 {
            r = l + (r - l) * (1.0 - l) / d;
            g = l + (g - l) * (1.0 - l) / d;
            b = l + (b - l) * (1.0 - l) / d;
        }
    }
    (r, g, b)
}

/// Saturation of an RGB color (max - min)
pub fn saturation(r: f32, g: f32, b: f32) -> f32 {
    r.max(g).max(b) - r.min(g).min(b)
}

/// Set saturation while preserving ordering of channels
pub fn set_saturation(r: f32, g: f32, b: f32, target_s: f32) -> (f32, f32, f32) {
    // Sort channels and track which is which
    let mut channels = [(r, 0u8), (g, 1u8), (b, 2u8)];
    channels.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

    let (min_val, _) = channels[0];
    let (mid_val, _) = channels[1];
    let (max_val, _) = channels[2];

    let mut result = [0.0f32; 3];
    if (max_val - min_val).abs() > 1e-7 {
        result[channels[1].1 as usize] = ((mid_val - min_val) * target_s) / (max_val - min_val);
        result[channels[2].1 as usize] = target_s;
    }
    result[channels[0].1 as usize] = 0.0;

    (result[0], result[1], result[2])
}

// Display P3 to linear sRGB matrix (3x3)
// P3 uses the same transfer function as sRGB but different primaries
#[rustfmt::skip]
pub const P3_TO_SRGB_MATRIX: [f32; 9] = [
     1.2249, -0.2247,  0.0,
    -0.0420,  1.0419,  0.0,
    -0.0197, -0.0786,  1.0984,
];

#[rustfmt::skip]
pub const SRGB_TO_P3_MATRIX: [f32; 9] = [
     0.8225,  0.1774,  0.0,
     0.0332,  0.9669,  0.0,
     0.0171,  0.0724,  0.9108,
];

/// Apply a 3x3 matrix to RGB values
pub fn apply_matrix3(m: &[f32; 9], r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    (
        m[0] * r + m[1] * g + m[2] * b,
        m[3] * r + m[4] * g + m[5] * b,
        m[6] * r + m[7] * g + m[8] * b,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_srgb_roundtrip() {
        for v in 0..=255u8 {
            let linear = srgb_to_linear(v);
            let back = linear_to_srgb(linear);
            assert!((v as i16 - back as i16).unsigned_abs() <= 1,
                "roundtrip failed for {v}: got {back}");
        }
    }

    #[test]
    fn test_srgb_known_values() {
        assert!((srgb_to_linear(0) - 0.0).abs() < 1e-6);
        assert!((srgb_to_linear(255) - 1.0).abs() < 1e-6);
        // mid-gray ~0.2140
        assert!((srgb_to_linear(128) - 0.2158).abs() < 0.01);
    }

    #[test]
    fn test_color8_to_linear() {
        let c = Color8::new(255, 0, 128, 200);
        let lin = c.to_linear();
        assert!((lin.r - 1.0).abs() < 1e-5);
        assert!((lin.g - 0.0).abs() < 1e-5);
        assert!((lin.a - 200.0 / 255.0).abs() < 1e-3);
    }

    #[test]
    fn test_hsl_roundtrip() {
        let cases = [
            (1.0, 0.0, 0.0),   // red
            (0.0, 1.0, 0.0),   // green
            (0.0, 0.0, 1.0),   // blue
            (0.5, 0.5, 0.5),   // gray
            (1.0, 1.0, 0.0),   // yellow
        ];
        for (r, g, b) in cases {
            let (h, s, l) = rgb_to_hsl(r, g, b);
            let (r2, g2, b2) = hsl_to_rgb(h, s, l);
            assert!((r - r2).abs() < 1e-4, "R mismatch for ({r},{g},{b})");
            assert!((g - g2).abs() < 1e-4, "G mismatch for ({r},{g},{b})");
            assert!((b - b2).abs() < 1e-4, "B mismatch for ({r},{g},{b})");
        }
    }

    #[test]
    fn test_luminance() {
        assert!((luminance(1.0, 1.0, 1.0) - 1.0).abs() < 1e-5);
        assert!((luminance(0.0, 0.0, 0.0) - 0.0).abs() < 1e-5);
    }

    #[test]
    fn test_blend_mode_from_u8() {
        assert_eq!(BlendMode::from_u8(0), Some(BlendMode::Normal));
        assert_eq!(BlendMode::from_u8(15), Some(BlendMode::Luminosity));
        assert_eq!(BlendMode::from_u8(16), None);
    }
}
