use crate::color::{
    Color, BlendMode, luminance, set_luminance, saturation, set_saturation,
    rgb_to_hsl, hsl_to_rgb,
};

/// Apply a blend mode to individual non-alpha channels (for separable modes)
fn blend_channel(src: f32, dst: f32, mode: BlendMode) -> f32 {
    match mode {
        BlendMode::Normal => src,
        BlendMode::Multiply => src * dst,
        BlendMode::Screen => src + dst - src * dst,
        BlendMode::Overlay => {
            if dst < 0.5 {
                2.0 * src * dst
            } else {
                1.0 - 2.0 * (1.0 - src) * (1.0 - dst)
            }
        }
        BlendMode::Darken => src.min(dst),
        BlendMode::Lighten => src.max(dst),
        BlendMode::ColorDodge => {
            if dst < 1e-7 {
                0.0
            } else if src >= 1.0 - 1e-7 {
                1.0
            } else {
                (dst / (1.0 - src)).min(1.0)
            }
        }
        BlendMode::ColorBurn => {
            if (dst - 1.0).abs() < 1e-7 {
                1.0
            } else if src < 1e-7 {
                0.0
            } else {
                1.0 - ((1.0 - dst) / src).min(1.0)
            }
        }
        BlendMode::HardLight => {
            if src < 0.5 {
                2.0 * src * dst
            } else {
                1.0 - 2.0 * (1.0 - src) * (1.0 - dst)
            }
        }
        BlendMode::SoftLight => {
            // W3C compositing spec formula
            if src <= 0.5 {
                dst - (1.0 - 2.0 * src) * dst * (1.0 - dst)
            } else {
                let d = if dst <= 0.25 {
                    ((16.0 * dst - 12.0) * dst + 4.0) * dst
                } else {
                    dst.sqrt()
                };
                dst + (2.0 * src - 1.0) * (d - dst)
            }
        }
        BlendMode::Difference => (src - dst).abs(),
        BlendMode::Exclusion => src + dst - 2.0 * src * dst,
        // Non-separable modes handled in blend_colors directly
        BlendMode::Hue | BlendMode::Saturation | BlendMode::Color | BlendMode::Luminosity => src,
    }
}

/// Blend two colors using the specified blend mode with Porter-Duff source-over compositing
pub fn blend_colors(src: Color, dst: Color, mode: BlendMode) -> Color {
    if src.a < 1e-7 {
        return dst;
    }
    if dst.a < 1e-7 {
        return src;
    }

    // Compute blended RGB (un-premultiplied)
    let (br, bg, bb) = match mode {
        BlendMode::Hue => {
            let (sh, _, _) = rgb_to_hsl(src.r, src.g, src.b);
            let (_, ds, _) = rgb_to_hsl(dst.r, dst.g, dst.b);
            let dl = luminance(dst.r, dst.g, dst.b);
            let (r, g, b) = hsl_to_rgb(sh, ds, 0.5);
            set_luminance(r, g, b, dl)
        }
        BlendMode::Saturation => {
            let ss = saturation(src.r, src.g, src.b);
            let dl = luminance(dst.r, dst.g, dst.b);
            let (r, g, b) = set_saturation(dst.r, dst.g, dst.b, ss);
            set_luminance(r, g, b, dl)
        }
        BlendMode::Color => {
            let dl = luminance(dst.r, dst.g, dst.b);
            set_luminance(src.r, src.g, src.b, dl)
        }
        BlendMode::Luminosity => {
            let sl = luminance(src.r, src.g, src.b);
            set_luminance(dst.r, dst.g, dst.b, sl)
        }
        _ => (
            blend_channel(src.r, dst.r, mode),
            blend_channel(src.g, dst.g, mode),
            blend_channel(src.b, dst.b, mode),
        ),
    };

    // Porter-Duff source-over compositing
    let sa = src.a;
    let da = dst.a;
    let out_a = sa + da * (1.0 - sa);

    if out_a < 1e-7 {
        return Color::transparent();
    }

    // Composite: blended color in overlap region, src color in src-only, dst in dst-only
    let out_r = (sa * da * br + sa * (1.0 - da) * src.r + da * (1.0 - sa) * dst.r) / out_a;
    let out_g = (sa * da * bg + sa * (1.0 - da) * src.g + da * (1.0 - sa) * dst.g) / out_a;
    let out_b = (sa * da * bb + sa * (1.0 - da) * src.b + da * (1.0 - sa) * dst.b) / out_a;

    Color {
        r: out_r.clamp(0.0, 1.0),
        g: out_g.clamp(0.0, 1.0),
        b: out_b.clamp(0.0, 1.0),
        a: out_a.clamp(0.0, 1.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(r: f32, g: f32, b: f32, a: f32) -> Color {
        Color::new(r, g, b, a)
    }

    #[test]
    fn test_normal_opaque() {
        let result = blend_colors(c(1.0, 0.0, 0.0, 1.0), c(0.0, 1.0, 0.0, 1.0), BlendMode::Normal);
        assert!((result.r - 1.0).abs() < 1e-5);
        assert!((result.g - 0.0).abs() < 1e-5);
        assert!((result.a - 1.0).abs() < 1e-5);
    }

    #[test]
    fn test_normal_transparent_src() {
        let dst = c(0.0, 1.0, 0.0, 1.0);
        let result = blend_colors(c(1.0, 0.0, 0.0, 0.0), dst, BlendMode::Normal);
        assert!((result.g - 1.0).abs() < 1e-5);
    }

    #[test]
    fn test_normal_half_alpha() {
        let result = blend_colors(c(1.0, 0.0, 0.0, 0.5), c(0.0, 0.0, 1.0, 1.0), BlendMode::Normal);
        assert!((result.r - 0.5).abs() < 1e-4);
        assert!((result.b - 0.5).abs() < 1e-4);
        assert!((result.a - 1.0).abs() < 1e-5);
    }

    #[test]
    fn test_multiply() {
        let result = blend_colors(c(0.5, 0.5, 0.5, 1.0), c(0.8, 0.4, 0.2, 1.0), BlendMode::Multiply);
        assert!((result.r - 0.4).abs() < 1e-4);
        assert!((result.g - 0.2).abs() < 1e-4);
        assert!((result.b - 0.1).abs() < 1e-4);
    }

    #[test]
    fn test_screen() {
        let result = blend_colors(c(0.5, 0.5, 0.5, 1.0), c(0.5, 0.5, 0.5, 1.0), BlendMode::Screen);
        assert!((result.r - 0.75).abs() < 1e-4);
    }

    #[test]
    fn test_overlay() {
        // dst < 0.5: 2*src*dst = 2*0.5*0.3 = 0.3
        let result = blend_colors(c(0.5, 0.5, 0.5, 1.0), c(0.3, 0.3, 0.3, 1.0), BlendMode::Overlay);
        assert!((result.r - 0.3).abs() < 1e-4);
    }

    #[test]
    fn test_darken_lighten() {
        let s = c(0.3, 0.7, 0.5, 1.0);
        let d = c(0.5, 0.5, 0.5, 1.0);
        let dark = blend_colors(s, d, BlendMode::Darken);
        assert!((dark.r - 0.3).abs() < 1e-4);
        assert!((dark.g - 0.5).abs() < 1e-4);

        let light = blend_colors(s, d, BlendMode::Lighten);
        assert!((light.r - 0.5).abs() < 1e-4);
        assert!((light.g - 0.7).abs() < 1e-4);
    }

    #[test]
    fn test_difference() {
        let result = blend_colors(c(0.8, 0.2, 0.5, 1.0), c(0.3, 0.7, 0.5, 1.0), BlendMode::Difference);
        assert!((result.r - 0.5).abs() < 1e-4);
        assert!((result.g - 0.5).abs() < 1e-4);
        assert!((result.b - 0.0).abs() < 1e-4);
    }

    #[test]
    fn test_exclusion() {
        let result = blend_colors(c(0.5, 0.5, 0.5, 1.0), c(0.5, 0.5, 0.5, 1.0), BlendMode::Exclusion);
        // 0.5 + 0.5 - 2*0.5*0.5 = 0.5
        assert!((result.r - 0.5).abs() < 1e-4);
    }

    #[test]
    fn test_color_dodge() {
        let result = blend_colors(c(0.5, 0.0, 1.0, 1.0), c(0.4, 0.5, 0.3, 1.0), BlendMode::ColorDodge);
        assert!((result.r - 0.8).abs() < 1e-4);
        // src.g=0.0, dst.g=0.5 => dst/(1-src) = 0.5/1.0 = 0.5
        assert!((result.g - 0.5).abs() < 1e-4);
        // src.b=1.0 => result = 1.0
        assert!((result.b - 1.0).abs() < 1e-4);
    }

    #[test]
    fn test_color_burn() {
        let result = blend_colors(c(0.5, 1.0, 0.0, 1.0), c(0.4, 0.5, 0.5, 1.0), BlendMode::ColorBurn);
        // src=0.5, dst=0.4: 1 - (1-0.4)/0.5 = 1 - 1.2 => clamped to 0
        assert!((result.r - 0.0).abs() < 1e-4);
        // src=1.0, dst=0.5: 1 - (1-0.5)/1.0 = 0.5
        assert!((result.g - 0.5).abs() < 1e-4);
        // src=0.0, dst=0.5: src < epsilon => 0
        assert!((result.b - 0.0).abs() < 1e-4);
    }

    #[test]
    fn test_hard_light() {
        let result = blend_colors(c(0.3, 0.7, 0.5, 1.0), c(0.5, 0.5, 0.5, 1.0), BlendMode::HardLight);
        // src=0.3 < 0.5: 2*0.3*0.5 = 0.3
        assert!((result.r - 0.3).abs() < 1e-4);
        // src=0.7 >= 0.5: 1 - 2*(1-0.7)*(1-0.5) = 1 - 2*0.3*0.5 = 0.7
        assert!((result.g - 0.7).abs() < 1e-4);
    }

    #[test]
    fn test_soft_light() {
        let result = blend_colors(c(0.5, 0.5, 0.5, 1.0), c(0.5, 0.5, 0.5, 1.0), BlendMode::SoftLight);
        // Should be close to 0.5 (identity-ish)
        assert!((result.r - 0.5).abs() < 0.05);
    }

    #[test]
    fn test_hsl_blend_modes_dont_crash() {
        let s = c(0.8, 0.2, 0.4, 1.0);
        let d = c(0.3, 0.6, 0.9, 1.0);
        for mode in [BlendMode::Hue, BlendMode::Saturation, BlendMode::Color, BlendMode::Luminosity] {
            let r = blend_colors(s, d, mode);
            assert!(r.r >= 0.0 && r.r <= 1.0, "{mode:?} produced invalid r: {}", r.r);
            assert!(r.g >= 0.0 && r.g <= 1.0, "{mode:?} produced invalid g: {}", r.g);
            assert!(r.b >= 0.0 && r.b <= 1.0, "{mode:?} produced invalid b: {}", r.b);
        }
    }

    #[test]
    fn test_luminosity_preserves_dst_color() {
        let src = c(0.9, 0.9, 0.9, 1.0); // bright
        let dst = c(1.0, 0.0, 0.0, 1.0); // pure red
        let result = blend_colors(src, dst, BlendMode::Luminosity);
        // Should produce a brighter red
        assert!(result.r > result.g);
        assert!(result.r > result.b);
    }
}
