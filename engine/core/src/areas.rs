//! Areas (spec 5.4, stage 13 of 6.10), first part: up to `MAX_AREAS`
//! linear and radial gradient masks, each with its own local adjustments
//! applied as deltas on top of the global ones. This is the CPU reference
//! of `engine/src/gpu/shaders/develop/areas.wgsl`; change them together.
//!
//! **Where it runs.** After the image adjustments and the colour mixer,
//! before sharpening (the full order is in `engine/src/develop/mod.rs`),
//! which is spec stage 13 placed after the global colour and
//! curves stages rather than repeating them per area. Areas apply in order,
//! each to the result of the one before.
//!
//! **With the working space** the adjustments below are not used: the same
//! layout's Exposure, Temperature, Tint, Contrast, Highlights and Shadows act
//! on scene data in the tone pass (`crate::scene_tone`) and its Saturation
//! in the look pass (`crate::look`), blended through the mask below. This
//! pass then draws only the mask overlay. The masks and the layer's mix
//! stay as described here.
//!
//! **Layout.** `setImageAreas` takes `STRIDE` (16) floats per area:
//!
//! | # | field | units |
//! |---|---|---|
//! | 0 | kind | 0 = linear, 1 = radial |
//! | 1 | invert | 0 or 1 |
//! | 2 | amount | 0..1, multiplies the mask |
//! | 3, 4 | linear: p0 (full effect) x, y · radial: centre x, y | document pixels |
//! | 5, 6 | linear: p1 (no effect) x, y · radial: radius x, y | document pixels |
//! | 7 | radial rotation (linear: ignored) | radians |
//! | 8 | radial feather (linear: ignored) | 0..1 |
//! | 9 | exposure | EV, −4..4 |
//! | 10 | contrast | −100..100 |
//! | 11 | highlights | −100..100 |
//! | 12 | shadows | −100..100 |
//! | 13 | temperature | −100..100 |
//! | 14 | tint | −100..100 |
//! | 15 | saturation | −100..100 |
//!
//! Document pixel coordinates have their origin at the top-left corner of
//! the document and pixel (x, y) has its centre at (x + 0.5, y + 0.5).
//! Values are clamped to their ranges; a length that is not a multiple of
//! the stride, more than `MAX_AREAS` areas, a kind other than 0 or 1 or a
//! non-finite value is an error.
//!
//! **Masks.** Linear: `t` is the position along p0 → p1 (0 at p0, 1 at
//! p1) and the mask is `1 − smoothstep(0, 1, t)`; p0 = p1 gives no
//! effect. Radial: the point is rotated by −rotation about the centre and
//! scaled by the radii to `r` (1 on the ellipse); the mask is
//! `1 − smoothstep(1 − feather, 1, r)` (feather floored at 0.001). Then
//! `invert` flips it and `amount` scales it.
//!
//! **Adjustments**, each scaled by the mask `m`, in this order:
//! - exposure: linear light × `2^(m · ev)`;
//! - temperature / tint: linear red × `2^(0.3 · m · T)` and blue ×
//!   `2^(−0.3 · m · T)`; green × `2^(−0.25 · m · tint)` (+ tint is magenta);
//! - contrast: encoded values `(v − 0.5) · (1 + m · c/100) + 0.5`;
//! - highlights / shadows: the same shift added to all channels,
//!   `0.25 · m · h/100 · smoothstep(0.5, 1, Y)` and
//!   `0.25 · m · s/100 · (1 − smoothstep(0, 0.5, Y))`, Y the Rec. 709 luma;
//! - saturation: `Y + (1 + m · s/100)(v − Y)`;
//! - negatives are clamped to 0.
//!
//! Large-details local contrast is not offered per area. The σ = 50 px blur
//! the local-contrast stage makes is of the image before the tone and
//! colour adjustments, so reusing it here would put their differences into
//! the detail; a blur of its own per frame is left for later.
//!
//! **An area's layer.** The adjustments above are built into the areas
//! pass. Anything further an area is given works as a layer does: after
//! the areas pass, in the areas' order, the whole image is run through the
//! document's develop stages again with that area's settings (noise
//! reduction, local contrast and haze, whites, blacks, vibrance, curves and
//! colour grading, colour by hue, sharpening, vignette and grain: the same
//! passes, so the maths is theirs), and the result is laid over the image
//! with the area's mask as its opacity: `out = img + m · (adjusted − img)`,
//! on encoded values, alpha untouched (`area_layer_reference`,
//! `develop/area_layer.wgsl`). The mask is the one above, amount and invert
//! included. An area with nothing further set draws no layer.

/// Most areas one pass applies.
pub const MAX_AREAS: usize = 8;
/// Floats per area.
pub const STRIDE: usize = 16;

/// One parsed area. `geom` is (p0, p1) for linear, (centre, radii) for radial.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub radial: bool,
    pub invert: bool,
    pub amount: f32,
    pub geom: [f32; 4],
    pub rotation: f32,
    pub feather: f32,
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub temperature: f32,
    pub tint: f32,
    pub saturation: f32,
}

/// Parse and clamp `setImageAreas`' floats. Returns the clamped floats too,
/// in the same layout, for the shader.
pub fn parse_areas(values: &[f32]) -> Result<(Vec<Area>, Vec<f32>), String> {
    if values.len() % STRIDE != 0 {
        return Err(format!("Area values must be a multiple of {STRIDE} floats, got {}", values.len()));
    }
    let count = values.len() / STRIDE;
    if count > MAX_AREAS {
        return Err(format!("At most {MAX_AREAS} areas, got {count}"));
    }
    if !values.iter().all(|v| v.is_finite()) {
        return Err("Area values must be finite".to_string());
    }
    let mut areas = Vec::with_capacity(count);
    let mut clamped = Vec::with_capacity(values.len());
    for v in values.chunks_exact(STRIDE) {
        let radial = match v[0] {
            k if k == 0.0 => false,
            k if k == 1.0 => true,
            k => return Err(format!("Area kind must be 0 (linear) or 1 (radial), got {k}")),
        };
        let slider = |x: f32| x.clamp(-100.0, 100.0);
        let a = Area {
            radial,
            invert: v[1] >= 0.5,
            amount: v[2].clamp(0.0, 1.0),
            geom: [v[3], v[4], v[5], v[6]],
            rotation: v[7],
            feather: v[8].clamp(0.0, 1.0),
            exposure: v[9].clamp(-4.0, 4.0),
            contrast: slider(v[10]),
            highlights: slider(v[11]),
            shadows: slider(v[12]),
            temperature: slider(v[13]),
            tint: slider(v[14]),
            saturation: slider(v[15]),
        };
        clamped.extend_from_slice(&[
            if a.radial { 1.0 } else { 0.0 },
            if a.invert { 1.0 } else { 0.0 },
            a.amount,
            a.geom[0], a.geom[1], a.geom[2], a.geom[3],
            a.rotation, a.feather, a.exposure, a.contrast, a.highlights, a.shadows,
            a.temperature, a.tint, a.saturation,
        ]);
        areas.push(a);
    }
    Ok((areas, clamped))
}

fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The area's mask at document point (`x`, `y`), after invert and amount.
pub fn mask(a: &Area, x: f32, y: f32) -> f32 {
    let m = if a.radial {
        let (qx, qy) = (x - a.geom[0], y - a.geom[1]);
        let (s, c) = a.rotation.sin_cos();
        let u = (qx * c + qy * s) / a.geom[2].abs().max(1e-3);
        let v = (-qx * s + qy * c) / a.geom[3].abs().max(1e-3);
        let r = (u * u + v * v).sqrt();
        1.0 - smoothstep(1.0 - a.feather.max(1e-3), 1.0, r)
    } else {
        let (dx, dy) = (a.geom[2] - a.geom[0], a.geom[3] - a.geom[1]);
        let len2 = dx * dx + dy * dy;
        if len2 < 1e-6 {
            0.0
        } else {
            let t = ((x - a.geom[0]) * dx + (y - a.geom[1]) * dy) / len2;
            1.0 - smoothstep(0.0, 1.0, t)
        }
    };
    let m = if a.invert { 1.0 - m } else { m };
    m * a.amount
}

fn to_linear(c: f32) -> f32 {
    if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
}

fn to_encoded(v: f32) -> f32 {
    let c = v.max(0.0);
    if c <= 0.003_130_8 { c * 12.92 } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 }
}

fn luma(c: [f32; 3]) -> f32 {
    0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/// One area's adjustments at mask `m` on an encoded pixel.
pub fn adjust(rgb: [f32; 3], a: &Area, m: f32) -> [f32; 3] {
    if m <= 0.0 {
        return rgb;
    }
    let gain = (m * a.exposure).exp2();
    let t = a.temperature / 100.0;
    let wb = [(0.3 * m * t).exp2(), (-0.25 * m * a.tint / 100.0).exp2(), (-0.3 * m * t).exp2()];
    let mut e = [0.0f32; 3];
    for c in 0..3 {
        e[c] = to_encoded(to_linear(rgb[c]) * gain * wb[c]);
    }
    let k = 1.0 + m * a.contrast / 100.0;
    for v in e.iter_mut() {
        *v = (*v - 0.5) * k + 0.5;
    }
    let y = luma(e);
    let shift = 0.25 * m * (a.highlights / 100.0 * smoothstep(0.5, 1.0, y) + a.shadows / 100.0 * (1.0 - smoothstep(0.0, 0.5, y)));
    for v in e.iter_mut() {
        *v += shift;
    }
    let y = luma(e);
    let s = 1.0 + m * a.saturation / 100.0;
    e.map(|v| (y + s * (v - y)).max(0.0))
}

/// Every area over straight-alpha RGBA f32 (`w`×`h`, encoded), alpha untouched.
pub fn areas_reference(rgba: &[f32], w: usize, h: usize, areas: &[Area]) -> Vec<f32> {
    let mut out = rgba.to_vec();
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) * 4;
            let mut c = [out[i], out[i + 1], out[i + 2]];
            for a in areas {
                c = adjust(c, a, mask(a, x as f32 + 0.5, y as f32 + 0.5));
            }
            out[i..i + 3].copy_from_slice(&c);
        }
    }
    out
}

/// An area's layer: `adjusted` (the image with the area's further
/// adjustments applied to all of it) over `rgba` with the area's mask as
/// its opacity. Both are straight-alpha RGBA f32, `w`×`h`; alpha is `rgba`'s.
pub fn area_layer_reference(rgba: &[f32], adjusted: &[f32], w: usize, h: usize, area: &Area) -> Vec<f32> {
    let mut out = rgba.to_vec();
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) * 4;
            let m = mask(area, x as f32 + 0.5, y as f32 + 0.5);
            for c in 0..3 {
                out[i + c] += m * (adjusted[i + c] - out[i + c]);
            }
        }
    }
    out
}

/// Overlay colour and opacity at full mask.
pub const OVERLAY_RGB: [f32; 3] = [1.0, 0.1, 0.1];
pub const OVERLAY_OPACITY: f32 = 0.5;

/// The red mask overlay of `area` over RGBA f32, alpha untouched.
pub fn overlay_reference(rgba: &[f32], w: usize, h: usize, area: &Area) -> Vec<f32> {
    let mut out = rgba.to_vec();
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) * 4;
            let k = OVERLAY_OPACITY * mask(area, x as f32 + 0.5, y as f32 + 0.5);
            for c in 0..3 {
                out[i + c] += k * (OVERLAY_RGB[c] - out[i + c]);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area(values: [f32; STRIDE]) -> Area {
        parse_areas(&values).unwrap().0[0]
    }

    fn linear(p0: (f32, f32), p1: (f32, f32)) -> [f32; STRIDE] {
        let mut v = [0.0; STRIDE];
        v[2] = 1.0;
        v[3] = p0.0;
        v[4] = p0.1;
        v[5] = p1.0;
        v[6] = p1.1;
        v
    }

    fn radial(c: (f32, f32), r: (f32, f32), rot: f32, feather: f32) -> [f32; STRIDE] {
        let mut v = linear(c, r);
        v[0] = 1.0;
        v[7] = rot;
        v[8] = feather;
        v
    }

    #[test]
    fn parsing_checks_length_count_kind_and_finiteness() {
        assert!(parse_areas(&[]).unwrap().0.is_empty());
        assert!(parse_areas(&[0.0; 15]).is_err());
        assert!(parse_areas(&[0.0; STRIDE * 9]).is_err());
        let mut bad = linear((0.0, 0.0), (1.0, 0.0));
        bad[0] = 2.0;
        assert!(parse_areas(&bad).is_err());
        bad[0] = 0.0;
        bad[9] = f32::NAN;
        assert!(parse_areas(&bad).is_err());
        let mut v = linear((0.0, 0.0), (1.0, 0.0));
        v[9] = 9.0;
        v[15] = -300.0;
        let (a, clamped) = parse_areas(&v).unwrap();
        assert_eq!((a[0].exposure, a[0].saturation), (4.0, -100.0));
        assert_eq!(clamped.len(), STRIDE);
        assert_eq!(clamped[9], 4.0);
    }

    #[test]
    fn linear_masks_fall_from_p0_to_p1() {
        let a = area(linear((10.0, 0.0), (30.0, 0.0)));
        assert_eq!(mask(&a, 5.0, 7.0), 1.0);
        assert!((mask(&a, 20.0, 99.0) - 0.5).abs() < 1e-6);
        assert_eq!(mask(&a, 35.0, 0.0), 0.0);
        let mut inv = linear((10.0, 0.0), (30.0, 0.0));
        inv[1] = 1.0;
        inv[2] = 0.5;
        assert_eq!(mask(&area(inv), 5.0, 0.0), 0.0);
        assert!((mask(&area(inv), 40.0, 0.0) - 0.5).abs() < 1e-6);
        assert_eq!(mask(&area(linear((3.0, 3.0), (3.0, 3.0))), 3.0, 3.0), 0.0);
    }

    #[test]
    fn radial_masks_follow_radii_rotation_and_feather() {
        let a = area(radial((50.0, 50.0), (20.0, 10.0), 0.0, 0.5));
        assert_eq!(mask(&a, 50.0, 50.0), 1.0);
        assert_eq!(mask(&a, 59.0, 50.0), 1.0, "inside 1 − feather");
        assert_eq!(mask(&a, 71.0, 50.0), 0.0);
        assert_eq!(mask(&a, 50.0, 61.0), 0.0, "the y radius is 10");
        let turned = area(radial((50.0, 50.0), (20.0, 10.0), std::f32::consts::FRAC_PI_2, 0.5));
        assert_eq!(mask(&turned, 50.0, 59.0), 1.0, "rotated a quarter turn, x radius points down");
        let hard = area(radial((0.0, 0.0), (10.0, 10.0), 0.0, 0.0));
        assert_eq!(mask(&hard, 9.9, 0.0), 1.0);
        assert_eq!(mask(&hard, 10.1, 0.0), 0.0);
    }

    #[test]
    fn adjustments_move_the_right_way_and_do_nothing_at_zero_mask() {
        let mut v = linear((0.0, 0.0), (10.0, 0.0));
        let px = [0.4f32, 0.35, 0.3];
        v[9] = 1.0;
        let a = area(v);
        assert_eq!(adjust(px, &a, 0.0), px);
        let brighter = adjust(px, &a, 1.0);
        assert!(brighter.iter().zip(&px).all(|(b, p)| b > p));
        let mut warm = linear((0.0, 0.0), (10.0, 0.0));
        warm[13] = 100.0;
        let w = adjust([0.5, 0.5, 0.5], &area(warm), 1.0);
        assert!(w[0] > 0.5 && w[2] < 0.5 && (w[1] - 0.5).abs() < 1e-6);
        let mut grey = linear((0.0, 0.0), (10.0, 0.0));
        grey[15] = -100.0;
        let g = adjust(px, &area(grey), 1.0);
        assert!((g[0] - g[1]).abs() < 1e-6 && (g[1] - g[2]).abs() < 1e-6);
        let mut hl = linear((0.0, 0.0), (10.0, 0.0));
        hl[11] = -100.0;
        assert!(adjust([0.9, 0.9, 0.9], &area(hl), 1.0)[0] < 0.9);
        assert!(adjust([0.2, 0.2, 0.2], &area(hl), 1.0).iter().all(|v| (v - 0.2).abs() < 1e-5), "shadows untouched");
    }

    #[test]
    fn areas_apply_in_order_and_overlay_reds_the_mask() {
        let mut v = linear((0.0, 0.0), (3.0, 0.0)).to_vec();
        v[9] = 1.0;
        v.extend_from_slice(&radial((2.0, 0.5), (1.0, 1.0), 0.0, 0.2));
        let (areas, _) = parse_areas(&v).unwrap();
        let img: Vec<f32> = (0..4).flat_map(|_| [0.3f32, 0.3, 0.3, 1.0]).collect();
        let out = areas_reference(&img, 4, 1, &areas);
        assert!(out[0] > out[12], "the left end gets the most exposure");
        let ov = overlay_reference(&img, 4, 1, &areas[0]);
        assert!(ov[0] > ov[1] && ov[3] == 1.0);
        assert_eq!(ov[12..16], img[12..16]);
    }

    #[test]
    fn an_areas_layer_shows_through_its_mask_and_nowhere_else() {
        // Full effect at x = 0, none from x = 3 on.
        let (areas, _) = parse_areas(&linear((0.0, 0.0), (3.0, 0.0))).unwrap();
        let img: Vec<f32> = (0..4).flat_map(|_| [0.2f32, 0.4, 0.6, 0.5]).collect();
        let adjusted: Vec<f32> = (0..4).flat_map(|_| [0.8f32, 0.4, 0.1, 1.0]).collect();
        let out = area_layer_reference(&img, &adjusted, 4, 1, &areas[0]);
        // Most of the layer at the left, less each pixel, none past the mask; alpha is the image's.
        assert!(out[0] > 0.7 && out[0] > out[4] && out[4] > out[8]);
        assert_eq!(out[12..16], img[12..16]);
        assert!(out.chunks(4).all(|p| p[3] == 0.5));
        // Half the amount is half the layer.
        let mut half = linear((0.0, 0.0), (3.0, 0.0));
        half[2] = 0.5;
        let (halved, _) = parse_areas(&half).unwrap();
        let out_half = area_layer_reference(&img, &adjusted, 4, 1, &halved[0]);
        assert!((out_half[0] - img[0] - 0.5 * (out[0] - img[0])).abs() < 1e-6);
    }
}
