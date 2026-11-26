//! **Standard**: one tone curve of our own for every camera that is not
//! rendered with a maker's film look, built from a small parametric form
//! rather than typed points. A prototype: three candidates
//! ([`STANDARD_GENTLE`], [`STANDARD_MEDIUM`], [`STANDARD_PUNCHY`]) for the
//! owner to choose between; no format opens with any of them yet
//! (`raw::look::OpeningLook`'s default is today's `NEUTRAL`).
//!
//! **The form.** With `u = x / 0.18` (scene luminance in units of middle
//! grey, the convention the develop chain's scene stages use):
//!
//! ```text
//! F(x) = g · u^p · ((1 + S^−k) / (1 + (u/S)^k))^(p/k)
//! ```
//!
//! a generalised log-logistic (Hill) curve. Its slope in log-log terms
//! (display stops per scene stop) is
//!
//! ```text
//! d log F / d log x = p / (1 + (u/S)^k)
//! ```
//!
//! so it is `p` in the shadows, `p / (1 + S^−k)` at grey, and falls toward
//! 0 above `S` stops-from-grey: a straight-line portion of slope `p` that
//! bends over into a shoulder, the shape of a photographic characteristic
//! curve. `F(0.18) = g` exactly, `F(0) = 0`, and `F` rises everywhere.
//!
//! **Above scene 1.0** the table ends; the tone step continues it with its
//! own shoulder (`tone::shoulder`: the same value and slope, flattening
//! toward a ceiling three units up). That part is not ours to shape here,
//! so the white point is stated for the curve as the engine renders it:
//! table below 1, shoulder above.
//!
//! **The parameters**, the ones a photographer would name:
//! - `grey` (`g`): the display luminance (linear) that scene grey lands on.
//! - `contrast` (`p`): the slope of the straight-line portion, in display
//!   stops per scene stop. 1 keeps the shadows' ratios; more deepens them.
//! - `white_stops` (`W`): how many stops above grey the curve reaches
//!   display white, i.e. where an SDR rendering starts to clip. At least
//!   `log2(1 / 0.18)` (2.47), so the table itself never exceeds 1.
//! - `k` is fixed at [`SHOULDER_SHARPNESS`] for every candidate.
//!
//! `S`, where the shoulder bends, is not a parameter: it is solved (by
//! bisection, [`StandardCurve::shoulder_at`]) so that the engine's curve
//! reaches 1 at `0.18 · 2^W`. A larger `S` bends later and reaches white
//! sooner, so there is exactly one.
//!
//! **Where the numbers come from.** Nothing here is fitted to any maker's
//! or converter's rendering. The form is the log-logistic family, standard
//! mathematics (the Hill and Naka–Rushton response functions). The
//! candidates' values are chosen from photographic conventions:
//! - contrast around 1.2 for the medium candidate: the end-to-end system
//!   gamma of about 1.2 that the reference SDR chain (a BT.709 camera
//!   curve shown on a BT.1886 gamma-2.4 display) gives for dim viewing, the
//!   Bartleson–Breneman surround effect; 1.1 and 1.3 either side;
//! - white about three stops above grey for the medium candidate: the
//!   ISO 12232 saturation-based speed places sensor saturation at 7.8 times
//!   the grey exposure, 2.96 stops; 3.5 and 2.7 either side for a long and
//!   a short shoulder;
//! - grey a little above 0.18 (0.20 to 0.22, sRGB 124 to 130): ISO 12232's
//!   standard output sensitivity renders grey at sRGB 118 (0.18); the lift
//!   is the "midtone lift" the proposal asks for, so that pulling the
//!   highlights down into a shoulder does not leave the picture dimmer.

use super::base_curves::LUT_SIZE;
use crate::tone::SHOULDER_HEADROOM;

/// Scene luminance of middle grey.
pub const GREY_IN: f64 = 0.18;

/// The shoulder's `k`: how quickly the slope falls from `p` to 0 above
/// `S`. At 2 it falls by half over the first stop above `S`.
pub const SHOULDER_SHARPNESS: f64 = 2.0;

/// One Standard curve, by its photographer's parameters.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StandardCurve {
    pub name: &'static str,
    /// Display luminance (linear) of scene grey.
    pub grey: f64,
    /// The straight-line slope, display stops per scene stop.
    pub contrast: f64,
    /// Stops above grey at which display white is reached.
    pub white_stops: f64,
}

/// A: low contrast, a long shoulder (white 3.5 stops above grey).
pub const STANDARD_GENTLE: StandardCurve = StandardCurve { name: "Standard A (gentle)", grey: 0.20, contrast: 1.10, white_stops: 3.5 };
/// B: the reference system gamma, white three stops above grey.
pub const STANDARD_MEDIUM: StandardCurve = StandardCurve { name: "Standard B (medium)", grey: 0.21, contrast: 1.20, white_stops: 3.0 };
/// C: more contrast, a short shoulder (white 2.7 stops above grey).
pub const STANDARD_PUNCHY: StandardCurve = StandardCurve { name: "Standard C (punchy)", grey: 0.22, contrast: 1.30, white_stops: 2.7 };

/// The three candidates, A, B, C.
pub const CANDIDATES: [StandardCurve; 3] = [STANDARD_GENTLE, STANDARD_MEDIUM, STANDARD_PUNCHY];

/// The smallest white point the table can hold: scene 1.0, in stops above
/// grey.
pub fn min_white_stops() -> f64 {
    (1.0 / GREY_IN).log2()
}

impl StandardCurve {
    /// `F(x)` for the shoulder at `s` (in units of grey).
    pub fn eval_with(&self, x: f64, s: f64) -> f64 {
        if x <= 0.0 {
            return 0.0;
        }
        let (p, k) = (self.contrast, SHOULDER_SHARPNESS);
        let u = x / GREY_IN;
        let ln = self.grey.ln() + p * u.ln() + (p / k) * ((1.0 + s.powf(-k)).ln() - (1.0 + (u / s).powf(k)).ln());
        ln.exp()
    }

    /// Where the engine's curve (the table of `F` with shoulder `s`, and
    /// the tone step's shoulder above 1) reaches 1, as scene luminance.
    /// The table's last value and last-segment slope are taken as
    /// `tone::curve_top` takes them from the table.
    fn white_with(&self, s: f64) -> f64 {
        let n = (LUT_SIZE - 1) as f64;
        let top = self.eval_with(1.0, s);
        if top >= 1.0 {
            return 1.0;
        }
        let slope = ((top - self.eval_with(1.0 - 1.0 / n, s)) * n).max(0.0);
        let room = 1.0 - top;
        // top + slope·d / (1 + slope·d / H) = 1.
        let denom = slope * (1.0 - room / f64::from(SHOULDER_HEADROOM));
        if denom <= 0.0 {
            return f64::INFINITY;
        }
        1.0 + room / denom
    }

    /// `S`, solved so that the engine's curve reaches white at
    /// `0.18 · 2^white_stops`. Bisection on `ln S` over 1/1000 to 1000
    /// grey (60 halvings, far below any visible difference).
    pub fn shoulder_at(&self) -> f64 {
        let target = GREY_IN * self.white_stops.exp2();
        let (mut lo, mut hi) = (1e-3f64.ln(), 1e3f64.ln());
        for _ in 0..60 {
            let mid = 0.5 * (lo + hi);
            // A larger S reaches white sooner.
            if self.white_with(mid.exp()) > target {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        (0.5 * (lo + hi)).exp()
    }

    /// The log-log slope at grey: `p / (1 + S^−k)`.
    pub fn contrast_at_grey(&self) -> f64 {
        self.contrast / (1.0 + self.shoulder_at().powf(-SHOULDER_SHARPNESS))
    }

    /// The curve as the tone step takes it: [`LUT_SIZE`] values of `F` at
    /// evenly spaced scene luminance over 0..1.
    pub fn lut(&self) -> Vec<f32> {
        assert!(self.white_stops >= min_white_stops() - 1e-9, "{}: white below scene 1.0", self.name);
        let s = self.shoulder_at();
        (0..LUT_SIZE).map(|i| self.eval_with(i as f64 / (LUT_SIZE - 1) as f64, s) as f32).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tone::curve_at;

    fn stops(x: f32) -> f64 {
        (f64::from(x) / GREY_IN).log2()
    }

    #[test]
    fn every_candidate_starts_at_black_rises_and_lands_grey_where_it_says() {
        for c in CANDIDATES {
            let lut = c.lut();
            assert_eq!(lut[0], 0.0, "{}", c.name);
            assert!(lut.windows(2).all(|w| w[1] > w[0]), "{}: not rising", c.name);
            let g = curve_at(&lut, GREY_IN as f32);
            assert!((f64::from(g) - c.grey).abs() < 2e-4, "{}: grey {g}", c.name);
            assert!(lut.iter().all(|&v| v <= 1.0), "{}: the table goes above white", c.name);
        }
    }

    #[test]
    fn the_engine_reaches_white_at_the_stated_point_and_not_before() {
        for c in CANDIDATES {
            let lut = c.lut();
            let white = (GREY_IN * c.white_stops.exp2()) as f32;
            let at = curve_at(&lut, white);
            assert!((at - 1.0).abs() < 1e-3, "{}: {at} at its white", c.name);
            // A twentieth of a stop below white is still below it, a
            // twentieth above is over.
            assert!(curve_at(&lut, white * 0.05f32.exp2().recip()) < 1.0, "{}", c.name);
            assert!(curve_at(&lut, white * 0.05f32.exp2()) > 1.0, "{}", c.name);
            // And beyond, the tone step's shoulder keeps rising (HDR room).
            let mut last = at;
            for i in 1..40 {
                let y = curve_at(&lut, white * (0.1 * i as f32).exp2());
                assert!(y > last, "{}: not rising {i}", c.name);
                last = y;
            }
        }
    }

    #[test]
    fn the_slopes_are_where_the_form_puts_them() {
        for c in CANDIDATES {
            let lut = c.lut();
            let n = (LUT_SIZE - 1) as f32;
            // Log-log slope from the table, at entries away from the first
            // few (where the table's linear steps dominate).
            let ll = |i: usize| {
                let (x0, x1) = (i as f32 / n, (i + 1) as f32 / n);
                (f64::from(lut[i + 1]).ln() - f64::from(lut[i]).ln()) / (f64::from(x1).ln() - f64::from(x0).ln())
            };
            for i in (20..LUT_SIZE - 1).step_by(7) {
                let s = ll(i);
                assert!(s > 0.0 && s <= c.contrast + 1e-2, "{}: log-log slope {s} at {}", c.name, stops(i as f32 / n));
            }
            // At grey, p / (1 + S^−k), and above 1 for every candidate:
            // each adds contrast where a straight line adds none.
            let gi = (GREY_IN as f32 * n) as usize;
            let want = c.contrast_at_grey();
            assert!((ll(gi) - want).abs() < 0.01 && want > 1.0, "{}: {} against {want}", c.name, ll(gi));
            // The log-log slope only falls across the table: one shoulder,
            // no second bump. Over 16 entries, so f32 steps do not count.
            let wide = |i: usize| (f64::from(lut[i + 16]).ln() - f64::from(lut[i]).ln()) / (((i + 16) as f64).ln() - (i as f64).ln());
            for i in (32..LUT_SIZE - 17 - 16).step_by(16) {
                assert!(wide(i + 16) <= wide(i) + 1e-3, "{}: slope rises at {}", c.name, stops(i as f32 / n));
            }
        }
    }

    #[test]
    fn the_candidates_are_ordered_from_gentle_to_punchy() {
        let [a, b, c] = CANDIDATES;
        assert!(a.contrast_at_grey() < b.contrast_at_grey() && b.contrast_at_grey() < c.contrast_at_grey());
        assert!(a.white_stops > b.white_stops && b.white_stops > c.white_stops);
        // Every white is at or above scene 1.0, so the table never clips.
        assert!(CANDIDATES.iter().all(|k| k.white_stops >= min_white_stops()));
    }
}
