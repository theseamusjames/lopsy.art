//! The generator of the Sony colour table (`src/arw/colour_table.rs`), and
//! the test that keeps the committed table equal to what the vendored
//! spectral data gives (`data/rawtoaces/`, see its README).
//!
//! `cargo test -p lopsy-core --test sony_colour_table` checks the table;
//! with `LOPSY_PRINT_SONY_TABLE=1` (and `-- --nocapture`) it also prints
//! the table as Rust source, to replace `colour_table.rs` with when the
//! data or the method changes. The method is documented in
//! `src/arw/colour.rs`; in short, for each body and each of two illuminants
//! (CIE standard illuminant A, and a Planckian radiator at 6504 K standing
//! for D65), the camera's and the observer's responses to the 190 training
//! reflectances are integrated over 380..780 nm in 5 nm steps, and the
//! camera → XYZ matrix that maps the white-balanced camera responses to the
//! XYZ responses with the least squared error, white mapping exactly to
//! white, is fitted and inverted into a DNG-style ColorMatrix.

use std::collections::BTreeMap;

use lopsy_core::arw::colour_table::SONY_COLOUR;
use lopsy_core::colorimetry::{mat_inverse, mat_mul, mat_vec, Mat3};
use serde_json::Value;

const DATA: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/data/rawtoaces/data");

/// The sampling every spectrum is read at: 380..=780 nm, 5 nm apart.
fn wavelengths() -> Vec<u32> {
    (380..=780).step_by(5).collect()
}

/// A spectral file's `spectral_data.data.main`: wavelength → values.
fn read_spectra(path: &str) -> BTreeMap<u32, Vec<f64>> {
    let text = std::fs::read_to_string(format!("{DATA}/{path}")).unwrap_or_else(|e| panic!("{path}: {e}"));
    let v: Value = serde_json::from_str(&text).unwrap();
    let main = v["spectral_data"]["data"]["main"].as_object().unwrap_or_else(|| panic!("{path}: no main data"));
    main.iter()
        .map(|(k, vals)| (k.parse::<u32>().unwrap(), vals.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect()))
        .collect()
}

/// `count` columns sampled at `wavelengths()`.
fn sampled(table: &BTreeMap<u32, Vec<f64>>, count: usize) -> Vec<Vec<f64>> {
    wavelengths()
        .iter()
        .map(|w| {
            let row = table.get(w).unwrap_or_else(|| panic!("no data at {w} nm"));
            assert_eq!(row.len(), count, "{w} nm");
            row.clone()
        })
        .collect()
}

/// CIE standard illuminant A by its definition (CIE 15): a Planckian
/// radiator at 2848 K with c2 = 1.435e-2 m·K, relative to 100 at 560 nm.
fn illuminant_a(nm: f64) -> f64 {
    let c: f64 = 1.435e7 / 2848.0; // c2 / T in nm
    100.0 * (560.0 / nm).powi(5) * ((c / 560.0).exp() - 1.0) / ((c / nm).exp() - 1.0)
}

/// A Planckian radiator at `kelvin` (c2 = 1.4388e-2 m·K), relative to 1 at
/// 560 nm.
fn planck(kelvin: f64) -> impl Fn(f64) -> f64 {
    move |nm: f64| {
        let c: f64 = 1.4388e7 / kelvin;
        (560.0 / nm).powi(5) * ((c / 560.0).exp() - 1.0) / ((c / nm).exp() - 1.0)
    }
}

/// The colour temperature standing in for D65: a Planckian radiator at
/// D65's correlated colour temperature, because the dataset holds no
/// daylight spectrum.
const DAYLIGHT_KELVIN: f64 = 6504.0;

struct Spectra {
    cmf: Vec<[f64; 3]>,
    training: Vec<Vec<f64>>, // per wavelength, 190 reflectances
}

fn load_common() -> Spectra {
    let cmf = sampled(&read_spectra("cmf/cmf_1931.json"), 3).into_iter().map(|r| [r[0], r[1], r[2]]).collect();
    let training = sampled(&read_spectra("training/training_spectral.json"), 190);
    Spectra { cmf, training }
}

fn camera(model: &str) -> Vec<[f64; 3]> {
    sampled(&read_spectra(&format!("camera/Sony_{model}_380_780_5.json")), 3).into_iter().map(|r| [r[0], r[1], r[2]]).collect()
}

/// The fitted calibration under one illuminant, and how well it predicts.
struct Fit {
    /// XYZ (white Y = 1) → camera RGB (white green = 1), row-major.
    color_matrix: [f64; 9],
    /// The camera's response to the illuminant (green 1).
    neutral: [f64; 3],
    /// The illuminant's chromaticity.
    white_xy: [f64; 2],
    /// CIELAB ΔE*ab (1976) of the 190 patches through the fitted
    /// camera → XYZ: mean and largest.
    delta_e: (f64, f64),
}

fn lab(xyz: [f64; 3], white: [f64; 3]) -> [f64; 3] {
    let f = |t: f64| if t > (6.0f64 / 29.0).powi(3) { t.cbrt() } else { t / (3.0 * (6.0f64 / 29.0).powi(2)) + 4.0 / 29.0 };
    let (fx, fy, fz) = (f(xyz[0] / white[0]), f(xyz[1] / white[1]), f(xyz[2] / white[2]));
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

fn fit(sens: &[[f64; 3]], s: &Spectra, light: &dyn Fn(f64) -> f64) -> Fit {
    let ls: Vec<f64> = wavelengths().iter().map(|&w| light(f64::from(w))).collect();
    let n = s.training[0].len();
    let respond = |refl: &dyn Fn(usize) -> f64| -> ([f64; 3], [f64; 3]) {
        let (mut cam, mut xyz) = ([0.0; 3], [0.0; 3]);
        for (j, l) in ls.iter().enumerate() {
            let e = refl(j) * l;
            for c in 0..3 {
                cam[c] += e * sens[j][c];
                xyz[c] += e * s.cmf[j][c];
            }
        }
        (cam, xyz)
    };
    let (w_cam, w_xyz) = respond(&|_| 1.0);
    // White-balanced camera responses (white = 1, 1, 1) and XYZ relative to
    // the white's Y.
    let patches: Vec<([f64; 3], [f64; 3])> = (0..n)
        .map(|i| {
            let (c, x) = respond(&|j| s.training[j][i]);
            (std::array::from_fn(|k| c[k] / w_cam[k]), x.map(|v| v / w_xyz[1]))
        })
        .collect();
    let white = w_xyz.map(|v| v / w_xyz[1]);
    // Least squares for K (camera → XYZ), row by row, minimising the sum of
    // squared XYZ errors over the patches, subject to K · (1, 1, 1) = white.
    let mut a: Mat3 = [[0.0; 3]; 3];
    for (b, _) in &patches {
        for p in 0..3 {
            for q in 0..3 {
                a[p][q] += b[p] * b[q];
            }
        }
    }
    let a_inv = mat_inverse(&a);
    let a_inv_one = mat_vec(&a_inv, &[1.0, 1.0, 1.0]);
    let one_a_inv_one: f64 = a_inv_one.iter().sum();
    let mut k: Mat3 = [[0.0; 3]; 3];
    for (row, kr) in k.iter_mut().enumerate() {
        let mut v = [0.0; 3];
        for (b, y) in &patches {
            for p in 0..3 {
                v[p] += b[p] * y[row];
            }
        }
        let u = mat_vec(&a_inv, &v);
        let lambda = (white[row] - u.iter().sum::<f64>()) / one_a_inv_one;
        *kr = std::array::from_fn(|p| u[p] + lambda * a_inv_one[p]);
    }
    let delta: Vec<f64> = patches
        .iter()
        .map(|(b, y)| {
            let (l1, l2) = (lab(mat_vec(&k, b), white), lab(*y, white));
            ((l1[0] - l2[0]).powi(2) + (l1[1] - l2[1]).powi(2) + (l1[2] - l2[2]).powi(2)).sqrt()
        })
        .collect();
    // XYZ → white-balanced camera is K⁻¹; then un-balance, green = 1.
    let neutral = w_cam.map(|v| v / w_cam[1]);
    let cm = mat_mul(&[[neutral[0], 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, neutral[2]]], &mat_inverse(&k));
    let sum = white.iter().sum::<f64>();
    Fit {
        color_matrix: std::array::from_fn(|i| cm[i / 3][i % 3]),
        neutral,
        white_xy: [white[0] / sum, white[1] / sum],
        delta_e: (delta.iter().sum::<f64>() / delta.len() as f64, delta.iter().cloned().fold(0.0, f64::max)),
    }
}

const MODELS: [&str; 11] = [
    "DSC-RX100M4", "ILCE-6400", "ILCE-7CM2", "ILCE-7M3", "ILCE-7M4", "ILCE-7RM2", "ILCE-7RM3", "ILCE-7RM4", "ILCE-7SM2", "ILCE-7SM3", "ILCE-9",
];

fn fmt9(m: &[f64; 9]) -> String {
    m.iter().map(|v| format!("{v:.7}")).collect::<Vec<_>>().join(", ")
}

#[test]
fn committed_table_matches_the_spectral_data() {
    let s = load_common();
    let daylight = planck(DAYLIGHT_KELVIN);
    let mut source = String::new();
    source += "// Generated by `tests/sony_colour_table.rs` (LOPSY_PRINT_SONY_TABLE=1) from\n";
    source += "// the measured spectral data in `data/rawtoaces/`. Do not edit by hand:\n";
    source += "// the test fails when this and the data disagree.\n\n";
    source += "use super::colour::SonyColour;\n\n";
    source += "/// Every Sony body with measured spectral sensitivities, by its exact\n/// `Model` string.\n";
    source += "pub const SONY_COLOUR: &[SonyColour] = &[\n";
    let mut computed = Vec::new();
    for model in MODELS {
        let sens = camera(model);
        let a = fit(&sens, &s, &illuminant_a);
        let d = fit(&sens, &s, &daylight);
        println!(
            "{model}: A neutral {:.4?} white xy {:.4?} ΔE mean {:.2} max {:.2}; daylight neutral {:.4?} white xy {:.4?} ΔE mean {:.2} max {:.2}",
            a.neutral, a.white_xy, a.delta_e.0, a.delta_e.1, d.neutral, d.white_xy, d.delta_e.0, d.delta_e.1
        );
        source += &format!(
            "    SonyColour {{\n        model: \"{model}\",\n        color_matrix_a: [{}],\n        color_matrix_daylight: [{}],\n    }},\n",
            fmt9(&a.color_matrix),
            fmt9(&d.color_matrix)
        );
        computed.push((model, a.color_matrix, d.color_matrix));
    }
    source += "];\n";
    if std::env::var_os("LOPSY_PRINT_SONY_TABLE").is_some() {
        println!("{source}");
    }
    let committed: Vec<&str> = SONY_COLOUR.iter().map(|c| c.model).collect();
    assert_eq!(committed, MODELS, "the committed table has another set of bodies");
    for ((model, a, d), c) in computed.iter().zip(SONY_COLOUR) {
        for (got, want) in a.iter().zip(&c.color_matrix_a).chain(d.iter().zip(&c.color_matrix_daylight)) {
            assert!((got - want).abs() < 1e-6, "{model}: the committed table has {want}, the data gives {got}");
        }
    }
}

/// How much the fitted matrix depends on the illuminant's spectral shape:
/// the daylight fit at 6504 K against fits at 5500 K and 7500 K, as a
/// bound on what standing a Planckian radiator in for D65 can move.
#[test]
fn the_daylight_fit_is_not_sensitive_to_the_light() {
    let s = load_common();
    for model in MODELS {
        let sens = camera(model);
        let base = fit(&sens, &s, &planck(DAYLIGHT_KELVIN));
        // Compare what a decode applies: white-balanced camera RGB → XYZ,
        // adapted (Bradford) from the fit's white to D50, white Y = 1.
        let balanced = |f: &Fit| -> Mat3 {
            let cm: Mat3 = std::array::from_fn(|r| std::array::from_fn(|c| f.color_matrix[r * 3 + c]));
            let k = mat_mul(&mat_inverse(&cm), &[[f.neutral[0], 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, f.neutral[2]]]);
            let white = lopsy_core::colorimetry::xy_to_xyz(f.white_xy[0], f.white_xy[1]);
            let adapted = mat_mul(&lopsy_core::colorimetry::bradford_adaptation(&white, &lopsy_core::colorimetry::PCS_D50), &k);
            let y: f64 = adapted[1].iter().sum();
            adapted.map(|r| r.map(|v| v / y))
        };
        let b0 = balanced(&base);
        let mut worst = 0.0f64;
        for kelvin in [5500.0, 7500.0] {
            let b1 = balanced(&fit(&sens, &s, &planck(kelvin)));
            for r in 0..3 {
                for c in 0..3 {
                    worst = worst.max((b0[r][c] - b1[r][c]).abs());
                }
            }
        }
        println!("{model}: the largest change of a white-balanced camera → XYZ element from 5500 K to 7500 K: {worst:.4}");
        assert!(worst < 0.1, "{model}: {worst}");
    }
}

/// The calibrations are plausible: under A the camera sees white redder
/// and less blue than under daylight, and each body's white-balanced
/// camera → linear sRGB matrix (the DNG method, `dng::camera_color`) has
/// rows summing to one with a diagonal of a usual size for a camera.
#[test]
fn the_matrices_are_plausible() {
    let s = load_common();
    for model in MODELS {
        let sens = camera(model);
        let (a, d) = (fit(&sens, &s, &illuminant_a), fit(&sens, &s, &planck(DAYLIGHT_KELVIN)));
        assert!(a.neutral[0] > d.neutral[0] && a.neutral[2] < d.neutral[2], "{model}: A {:?} daylight {:?}", a.neutral, d.neutral);
        let cal = lopsy_core::arw::colour::calibration_for(model, [1.0; 3]).expect("a calibration");
        for kelvin in [2856.0, 6504.0] {
            let wb = cal.white_balance_for_temperature(kelvin, 0.0, [1.0; 3]).unwrap();
            let m = wb.cam_to_rgb;
            println!("{model} at {kelvin} K: camera → linear sRGB [{:.3} {:.3} {:.3}; {:.3} {:.3} {:.3}; {:.3} {:.3} {:.3}]", m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
            for r in 0..3 {
                let sum: f32 = m[r * 3..r * 3 + 3].iter().sum();
                assert!((sum - 1.0).abs() < 1e-4, "{model}: row {r} sums to {sum}");
                assert!((1.0..3.5).contains(&m[r * 4]), "{model}: diagonal {}", m[r * 4]);
            }
        }
    }
}

/// How much chroma the fitted camera → XYZ reproduces for the training
/// colours, against their true values (CIELAB C*ab under the fit's own
/// white), under the daylight fit: Σ C*ab fitted / Σ C*ab true, over all
/// 190 patches and over the most saturated quarter, with the mean ΔE*ab
/// and the largest error of a near-neutral patch (true C*ab < 5). Prints;
/// fails only if the fit loses more than a tenth of the chroma.
#[test]
fn the_fit_keeps_the_training_colours_chroma() {
    let s = load_common();
    let light = planck(DAYLIGHT_KELVIN);
    let ls: Vec<f64> = wavelengths().iter().map(|&w| light(f64::from(w))).collect();
    for model in MODELS {
        let sens = camera(model);
        let f = fit(&sens, &s, &light);
        let n = s.training[0].len();
        let respond = |i: Option<usize>| -> ([f64; 3], [f64; 3]) {
            let (mut cam, mut xyz) = ([0.0; 3], [0.0; 3]);
            for (j, l) in ls.iter().enumerate() {
                let e = i.map_or(1.0, |i| s.training[j][i]) * l;
                for c in 0..3 {
                    cam[c] += e * sens[j][c];
                    xyz[c] += e * s.cmf[j][c];
                }
            }
            (cam, xyz)
        };
        let (w_cam, w_xyz) = respond(None);
        let white = w_xyz.map(|v| v / w_xyz[1]);
        let cm: Mat3 = std::array::from_fn(|r| std::array::from_fn(|c| f.color_matrix[r * 3 + c]));
        let k = mat_mul(&mat_inverse(&cm), &[[f.neutral[0], 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, f.neutral[2]]]);
        let mut rows: Vec<(f64, f64, f64)> = (0..n)
            .map(|i| {
                let (c, x) = respond(Some(i));
                let b: [f64; 3] = std::array::from_fn(|q| c[q] / w_cam[q]);
                let (got, want) = (lab(mat_vec(&k, &b), white), lab(x.map(|v| v / w_xyz[1]), white));
                let ch = |l: [f64; 3]| l[1].hypot(l[2]);
                let de = ((got[0] - want[0]).powi(2) + (got[1] - want[1]).powi(2) + (got[2] - want[2]).powi(2)).sqrt();
                (ch(want), ch(got), de)
            })
            .collect();
        let ratio = |r: &[(f64, f64, f64)]| r.iter().map(|v| v.1).sum::<f64>() / r.iter().map(|v| v.0).sum::<f64>();
        let all = ratio(&rows);
        rows.sort_by(|a, b| b.0.total_cmp(&a.0));
        let top = ratio(&rows[..n / 4]);
        let neutral_err = rows.iter().filter(|v| v.0 < 5.0).map(|v| v.2).fold(0.0, f64::max);
        let mean_de = rows.iter().map(|v| v.2).sum::<f64>() / n as f64;
        println!("{model}: chroma fitted/true {all:.3} (saturated quarter {top:.3}), mean ΔE*ab {mean_de:.2}, worst near-neutral ΔE*ab {neutral_err:.2}");
        assert!(all > 0.9, "{model}: the fit keeps only {all} of the chroma");
    }
}
