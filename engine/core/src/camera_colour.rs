//! Camera colour matrices for bodies whose files carry no usable matrix
//! of their own.
//!
//! Each takes the camera's linear RGB at a neutral white balance to linear
//! sRGB (D65), and its rows sum to 1, so a neutral stays neutral. One
//! matrix per body: it does not follow the white balance.
//!
//! The matrices were derived internally from publicly available sources.

/// Camera RGB at a neutral balance → linear sRGB, row-major.
pub type CamToSrgb = [f32; 9];

/// Sony bodies, by the exact `Model` string of IFD0.
const SONY: &[(&str, CamToSrgb)] = &[
    ("DSC-RX100M3", [1.8715, -0.7612, -0.1103, -0.2116, 1.6512, -0.4396, 0.0685, -0.6226, 1.5541]),
    ("ILCE-6000", [2.1762, -1.0860, -0.0902, -0.2350, 1.8128, -0.5778, 0.0778, -0.5826, 1.5048]),
    ("ILCE-6700", [2.0034, -0.9793, -0.0241, -0.1613, 1.7084, -0.5471, 0.0216, -0.4801, 1.4585]),
];

/// Fujifilm's 40-megapixel X-Trans sensor (X-Trans CMOS 5 HR).
const FUJIFILM_X_TRANS_5_HR: CamToSrgb = [1.7780, -0.7114, -0.0666, -0.1820, 1.7047, -0.5227, 0.0305, -0.4973, 1.4668];
/// Fujifilm's 26-megapixel X-Trans sensor (X-Trans CMOS 4).
const FUJIFILM_X_TRANS_4: CamToSrgb = [1.7639, -0.6466, -0.1173, -0.1798, 1.7223, -0.5425, 0.0580, -0.5447, 1.4867];

/// Fujifilm's first 102-megapixel medium-format sensor (GFX 100, GFX100S).
const FUJIFILM_GFX_102: CamToSrgb = [1.7679, -0.6563, -0.1116, -0.1532, 1.6569, -0.5037, 0.0778, -0.5779, 1.5001];
/// Fujifilm's second 102-megapixel medium-format sensor (GFX100 II,
/// GFX100S II, GFX100RF).
const FUJIFILM_GFX_102_II: CamToSrgb = [1.7930, -0.7094, -0.0836, -0.1817, 1.7115, -0.5298, 0.0269, -0.4844, 1.4575];
/// Fujifilm's 51-megapixel medium-format sensor (GFX 50S, GFX 50R,
/// GFX50S II).
const FUJIFILM_GFX_51: CamToSrgb = [1.7974, -0.6071, -0.1903, -0.1916, 1.7680, -0.5764, 0.0875, -0.6408, 1.5533];

/// The matrix of a Sony body, or `None` for one with none here.
pub fn sony(model: &str) -> Option<CamToSrgb> {
    SONY.iter().find(|(m, _)| *m == model).map(|(_, matrix)| *matrix)
}

/// The matrix of a Fujifilm body, by its sensor: the bodies that share a
/// sensor share its colour filters. `None` for a sensor with none here
/// (the X-H2S's stacked sensor, X-Trans 3 and earlier, and the X-A and
/// other Bayer X bodies).
pub fn fujifilm(model: &str) -> Option<CamToSrgb> {
    let m = model.to_uppercase();
    let has = |names: &[&str]| names.iter().any(|n| m.contains(n));
    // GFX names are written with and without a space ("GFX 100",
    // "GFX100RF"), and one is the start of another: matched whole, spaces out.
    let gfx: String = m.chars().filter(|c| !c.is_whitespace()).collect();
    if let Some(matrix) = match gfx.as_str() {
        "GFX100" | "GFX100S" => Some(FUJIFILM_GFX_102),
        "GFX100II" | "GFX100SII" | "GFX100RF" => Some(FUJIFILM_GFX_102_II),
        "GFX50S" | "GFX50R" | "GFX50SII" => Some(FUJIFILM_GFX_51),
        _ => None,
    } {
        return Some(matrix);
    }
    if m.contains("X-H2S") {
        None
    } else if has(&["X100VI", "X-T5", "X-H2", "X-E5"]) {
        // "X-T5" is also the start of X-T50.
        Some(FUJIFILM_X_TRANS_5_HR)
    } else if has(&["X-T3", "X-T4", "X-PRO3", "X100V", "X-S10", "X-S20", "X-E4", "X-M5"]) {
        // "X-T3" is also the start of X-T30, X-T30 II and X-T30 III.
        Some(FUJIFILM_X_TRANS_4)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_matrix_keeps_a_neutral_neutral() {
        let all = SONY.iter().map(|(_, m)| *m).chain([FUJIFILM_X_TRANS_5_HR, FUJIFILM_X_TRANS_4, FUJIFILM_GFX_102, FUJIFILM_GFX_102_II, FUJIFILM_GFX_51]);
        for m in all {
            for row in m.chunks_exact(3) {
                assert!((row.iter().sum::<f32>() - 1.0).abs() < 1e-5, "{m:?}");
            }
        }
    }

    #[test]
    fn a_body_takes_its_own_sensors_matrix() {
        assert_eq!(fujifilm("X100VI"), Some(FUJIFILM_X_TRANS_5_HR));
        assert_eq!(fujifilm("X-T50"), Some(FUJIFILM_X_TRANS_5_HR));
        assert_eq!(fujifilm("X-E5"), Some(FUJIFILM_X_TRANS_5_HR));
        assert_eq!(fujifilm("X-H2"), Some(FUJIFILM_X_TRANS_5_HR));
        assert_eq!(fujifilm("X100V"), Some(FUJIFILM_X_TRANS_4));
        assert_eq!(fujifilm("X-T30 II"), Some(FUJIFILM_X_TRANS_4));
        assert_eq!(fujifilm("X-S20"), Some(FUJIFILM_X_TRANS_4));
        assert_eq!(fujifilm("GFX 100"), Some(FUJIFILM_GFX_102));
        assert_eq!(fujifilm("GFX100S"), Some(FUJIFILM_GFX_102));
        assert_eq!(fujifilm("GFX100RF"), Some(FUJIFILM_GFX_102_II));
        assert_eq!(fujifilm("GFX100S II"), Some(FUJIFILM_GFX_102_II));
        assert_eq!(fujifilm("GFX50S II"), Some(FUJIFILM_GFX_51));
        assert_eq!(fujifilm("GFX 50R"), Some(FUJIFILM_GFX_51));
        for other in ["X-H2S", "X-T2", "X-T20", "X100F", "X-PRO2", "GFX 80", "X-A5", "unknown"] {
            assert_eq!(fujifilm(other), None, "{other}");
        }
        assert!(sony("ILCE-6000").is_some());
        // Exact names only: a body with measured data, and a near name.
        assert_eq!(sony("ILCE-7M3"), None);
        assert_eq!(sony("ILCE-6000 "), None);
    }
}
