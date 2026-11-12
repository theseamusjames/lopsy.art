//! Parameter model for the unified Texture filter.
//!
//! The pattern itself is generated in `texture.glsl`; this module owns the
//! validation and the mapping from dialog values to shader uniforms so the
//! GPU never sees out-of-range input (NaN sizes, zero stretch, runaway
//! octave counts).

/// The texture primitive the shader generates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextureKind {
    /// Fine, smooth value noise: film / paper grain.
    Grain = 0,
    /// Ridged multi-octave noise: stone, plaster, rough paper.
    Rough = 1,
    /// Plain-weave threads: canvas, linen, burlap.
    Canvas = 2,
    /// Noise stretched hard along the angle: brushed metal, dry brush.
    Streaks = 3,
    /// Cell edges (Worley F2 - F1): leather, crackle, pebbles.
    Cells = 4,
}

impl TextureKind {
    pub fn from_index(index: u32) -> Self {
        match index {
            1 => Self::Rough,
            2 => Self::Canvas,
            3 => Self::Streaks,
            4 => Self::Cells,
            _ => Self::Grain,
        }
    }
}

/// How the zero-centred texture value is applied to the pixel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextureBlend {
    /// Peaks lighten, valleys darken.
    LightAndDark = 0,
    /// Only the peaks lighten.
    Lighten = 1,
    /// Only the valleys darken.
    Darken = 2,
    /// The texture is treated as a height map and lit, like embossed paper.
    Relief = 3,
}

impl TextureBlend {
    pub fn from_index(index: u32) -> Self {
        match index {
            1 => Self::Lighten,
            2 => Self::Darken,
            3 => Self::Relief,
            _ => Self::LightAndDark,
        }
    }
}

pub const MIN_SIZE: f32 = 1.0;
pub const MAX_SIZE: f32 = 400.0;
pub const MIN_STRETCH: f32 = 1.0;
pub const MAX_STRETCH: f32 = 50.0;
/// Octaves at Detail 0 and Detail 1. Past six, each octave is finer than a
/// pixel at the sizes people use, so it only costs time.
pub const MIN_OCTAVES: f32 = 1.0;
pub const MAX_OCTAVES: f32 = 6.0;

/// Validated texture parameters, in shader units.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TextureParams {
    pub kind: TextureKind,
    pub blend: TextureBlend,
    /// 0 - 1 strength of the effect.
    pub amount: f32,
    /// Feature size in pixels.
    pub size: f32,
    /// Elongation along `angle_rad`; 1 = isotropic.
    pub stretch: f32,
    pub angle_rad: f32,
    /// Fractional octave count, `MIN_OCTAVES..=MAX_OCTAVES`.
    pub octaves: f32,
    /// 0 - 1; pushes the texture toward hard two-tone.
    pub contrast: f32,
    pub is_colored: bool,
    /// Integer seed; the shader hashes it, so equal seeds give equal output.
    pub seed: u32,
}

fn finite_or(value: f32, fallback: f32) -> f32 {
    if value.is_finite() { value } else { fallback }
}

fn unit(value: f32) -> f32 {
    finite_or(value, 0.0).clamp(0.0, 1.0)
}

/// Maps Detail (0 - 1) to a fractional octave count.
pub fn octaves_from_detail(detail: f32) -> f32 {
    MIN_OCTAVES + unit(detail) * (MAX_OCTAVES - MIN_OCTAVES)
}

impl TextureParams {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        kind: u32,
        blend: u32,
        amount: f32,
        size: f32,
        stretch: f32,
        angle_deg: f32,
        detail: f32,
        contrast: f32,
        is_colored: bool,
        seed: f32,
    ) -> Self {
        let angle = finite_or(angle_deg, 0.0).rem_euclid(360.0);
        let seed = finite_or(seed, 0.0).round().clamp(0.0, u32::MAX as f32) as u32;
        Self {
            kind: TextureKind::from_index(kind),
            blend: TextureBlend::from_index(blend),
            amount: unit(amount),
            size: finite_or(size, MIN_SIZE).clamp(MIN_SIZE, MAX_SIZE),
            stretch: finite_or(stretch, MIN_STRETCH).clamp(MIN_STRETCH, MAX_STRETCH),
            angle_rad: angle.to_radians(),
            octaves: octaves_from_detail(detail),
            contrast: unit(contrast),
            is_colored,
            seed,
        }
    }

    /// Whether running the filter would leave every pixel unchanged.
    pub fn is_identity(&self) -> bool {
        self.amount <= 0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(amount: f32, size: f32, stretch: f32, detail: f32) -> TextureParams {
        TextureParams::new(0, 0, amount, size, stretch, 0.0, detail, 0.0, false, 7.0)
    }

    #[test]
    fn unknown_indices_fall_back_to_the_first_option() {
        assert_eq!(TextureKind::from_index(99), TextureKind::Grain);
        assert_eq!(TextureBlend::from_index(99), TextureBlend::LightAndDark);
        assert_eq!(TextureKind::from_index(4), TextureKind::Cells);
        assert_eq!(TextureBlend::from_index(3), TextureBlend::Relief);
    }

    #[test]
    fn clamps_out_of_range_values() {
        let p = params(2.0, 0.0, 0.0, 5.0);
        assert_eq!(p.amount, 1.0);
        assert_eq!(p.size, MIN_SIZE);
        assert_eq!(p.stretch, MIN_STRETCH);
        assert_eq!(p.octaves, MAX_OCTAVES);

        let p = params(-1.0, 10_000.0, 1_000.0, -1.0);
        assert_eq!(p.amount, 0.0);
        assert_eq!(p.size, MAX_SIZE);
        assert_eq!(p.stretch, MAX_STRETCH);
        assert_eq!(p.octaves, MIN_OCTAVES);
    }

    #[test]
    fn non_finite_input_never_reaches_the_shader() {
        let p = TextureParams::new(0, 0, f32::NAN, f32::NAN, f32::INFINITY, f32::NAN, f32::NAN, f32::NAN, false, f32::NAN);
        assert_eq!(p.amount, 0.0);
        assert_eq!(p.size, MIN_SIZE);
        assert_eq!(p.stretch, MIN_STRETCH);
        assert_eq!(p.angle_rad, 0.0);
        assert_eq!(p.octaves, MIN_OCTAVES);
        assert_eq!(p.seed, 0);
        assert!(p.is_identity());
    }

    #[test]
    fn detail_maps_linearly_onto_octaves() {
        assert_eq!(octaves_from_detail(0.0), 1.0);
        assert_eq!(octaves_from_detail(1.0), 6.0);
        assert!((octaves_from_detail(0.5) - 3.5).abs() < 1e-6);
    }

    #[test]
    fn angle_wraps_and_converts_to_radians() {
        let p = TextureParams::new(0, 0, 0.5, 4.0, 1.0, 450.0, 0.5, 0.0, false, 0.0);
        assert!((p.angle_rad - std::f32::consts::FRAC_PI_2).abs() < 1e-5);
        let p = TextureParams::new(0, 0, 0.5, 4.0, 1.0, -90.0, 0.5, 0.0, false, 0.0);
        assert!((p.angle_rad - 3.0 * std::f32::consts::FRAC_PI_2).abs() < 1e-5);
    }

    #[test]
    fn seed_rounds_to_an_integer() {
        let p = TextureParams::new(0, 0, 0.5, 4.0, 1.0, 0.0, 0.5, 0.0, false, 41.6);
        assert_eq!(p.seed, 42);
        let p = TextureParams::new(0, 0, 0.5, 4.0, 1.0, 0.0, 0.5, 0.0, false, -3.0);
        assert_eq!(p.seed, 0);
    }
}
