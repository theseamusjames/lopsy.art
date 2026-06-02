//! Fujifilm white-balance presets.
//!
//! The numeric multipliers were extracted from darktable's
//! `data/wb_presets.json` measurement database
//! (<https://github.com/darktable-org/darktable>). darktable's *code* is
//! GPL-licensed and is not used here. The per-channel values below are
//! factual measurements from real camera firmware presets — one camera
//! body and one illuminant per row — and are used as data only.
//!
//! Each preset is a `[R, G, B]` multiplier triple normalized so `G = 1.0`,
//! applied per-channel to demosaiced raw values before the camera→sRGB
//! color matrix.

#[derive(Copy, Clone, Debug)]
pub struct WbPreset {
    pub camera: &'static str,
    pub illuminant: &'static str,
    /// `[R, G, B]` with green normalized to 1.0.
    pub multipliers: [f32; 3],
}

pub const FUJI_WB_PRESETS: &[WbPreset] = &[
    WbPreset { camera: "FinePix E900", illuminant: "Cool White Fluorescent", multipliers: [1.5543, 1.0, 1.519] },
    WbPreset { camera: "FinePix E900", illuminant: "Daylight", multipliers: [1.5719, 1.0, 1.1281] },
    WbPreset { camera: "FinePix E900", illuminant: "Daylight Fluorescent", multipliers: [1.9076, 1.0, 1.0163] },
    WbPreset { camera: "FinePix E900", illuminant: "Incandescent", multipliers: [1.0376, 1.0, 1.8429] },
    WbPreset { camera: "FinePix E900", illuminant: "Shade", multipliers: [1.6687, 1.0, 1.0063] },
    WbPreset { camera: "FinePix E900", illuminant: "Warm White Fluorescent", multipliers: [1.6549, 1.0, 1.2418] },
    WbPreset { camera: "FinePix F700", illuminant: "Cool White Fluorescent", multipliers: [1.6848, 1.0, 2.1522] },
    WbPreset { camera: "FinePix F700", illuminant: "Daylight", multipliers: [1.725, 1.0, 1.5] },
    WbPreset { camera: "FinePix F700", illuminant: "Daylight Fluorescent", multipliers: [2.0326, 1.0, 1.337] },
    WbPreset { camera: "FinePix F700", illuminant: "Incandescent", multipliers: [1.1681, 1.0, 2.4779] },
    WbPreset { camera: "FinePix F700", illuminant: "Shade", multipliers: [1.95, 1.0, 1.325] },
    WbPreset { camera: "FinePix F700", illuminant: "Warm White Fluorescent", multipliers: [1.7065, 1.0, 1.663] },
    WbPreset { camera: "FinePix HS20EXR", illuminant: "Cool White Fluorescent", multipliers: [1.5625, 1.0, 2.5714] },
    WbPreset { camera: "FinePix HS20EXR", illuminant: "Daylight", multipliers: [1.4107, 1.0, 1.9702] },
    WbPreset { camera: "FinePix HS20EXR", illuminant: "Daylight Fluorescent", multipliers: [1.7292, 1.0, 1.747] },
    WbPreset { camera: "FinePix HS20EXR", illuminant: "Incandescent", multipliers: [0.9405, 1.0, 2.7678] },
    WbPreset { camera: "FinePix HS20EXR", illuminant: "Shade", multipliers: [1.5804, 1.0, 1.744] },
    WbPreset { camera: "FinePix HS20EXR", illuminant: "Warm White Fluorescent", multipliers: [1.4821, 1.0, 2.0476] },
    WbPreset { camera: "FinePix HS50EXR", illuminant: "Cloudy", multipliers: [1.7054, 1.0, 1.6637] },
    WbPreset { camera: "FinePix HS50EXR", illuminant: "Day White Fluorescent", multipliers: [1.619, 1.0, 1.9464] },
    WbPreset { camera: "FinePix HS50EXR", illuminant: "Daylight", multipliers: [1.5893, 1.0, 1.8929] },
    WbPreset { camera: "FinePix HS50EXR", illuminant: "Daylight Fluorescent", multipliers: [1.875, 1.0, 1.6488] },
    WbPreset { camera: "FinePix HS50EXR", illuminant: "Incandescent", multipliers: [1.0417, 1.0, 2.6012] },
    WbPreset { camera: "FinePix HS50EXR", illuminant: "White Fluorescent", multipliers: [1.6518, 1.0, 2.4643] },
    WbPreset { camera: "FinePix S100FS", illuminant: "Cool White Fluorescent", multipliers: [1.6637, 1.0, 2.3095] },
    WbPreset { camera: "FinePix S100FS", illuminant: "Daylight", multipliers: [1.7024, 1.0, 1.8452] },
    WbPreset { camera: "FinePix S100FS", illuminant: "Daylight Fluorescent", multipliers: [1.8958, 1.0, 1.4613] },
    WbPreset { camera: "FinePix S100FS", illuminant: "Incandescent", multipliers: [1.1071, 1.0, 2.8155] },
    WbPreset { camera: "FinePix S100FS", illuminant: "Shade", multipliers: [1.8304, 1.0, 1.6012] },
    WbPreset { camera: "FinePix S100FS", illuminant: "Warm White Fluorescent", multipliers: [1.5744, 1.0, 1.8185] },
    WbPreset { camera: "FinePix S20Pro", illuminant: "Cloudy", multipliers: [1.8875, 1.0, 1.2625] },
    WbPreset { camera: "FinePix S20Pro", illuminant: "Cool White Fluorescent", multipliers: [1.6702, 1.0, 2.0638] },
    WbPreset { camera: "FinePix S20Pro", illuminant: "Daylight", multipliers: [1.7125, 1.0, 1.5] },
    WbPreset { camera: "FinePix S20Pro", illuminant: "Daylight Fluorescent", multipliers: [2.0978, 1.0, 1.3043] },
    WbPreset { camera: "FinePix S20Pro", illuminant: "Incandescent", multipliers: [1.0696, 1.0, 2.487] },
    WbPreset { camera: "FinePix S20Pro", illuminant: "Warm White Fluorescent", multipliers: [1.7826, 1.0, 1.6196] },
    WbPreset { camera: "FinePix S2Pro", illuminant: "Cloudy", multipliers: [1.6667, 1.0, 1.1667] },
    WbPreset { camera: "FinePix S2Pro", illuminant: "Cool White Fluorescent", multipliers: [1.6496, 1.0, 2.094] },
    WbPreset { camera: "FinePix S2Pro", illuminant: "Daylight", multipliers: [1.5098, 1.0, 1.402] },
    WbPreset { camera: "FinePix S2Pro", illuminant: "Daylight Fluorescent", multipliers: [1.9487, 1.0, 1.2308] },
    WbPreset { camera: "FinePix S2Pro", illuminant: "Flash", multipliers: [0.9861, 1.0, 2.5069] },
    WbPreset { camera: "FinePix S2Pro", illuminant: "Warm White Fluorescent", multipliers: [1.6752, 1.0, 1.5727] },
    WbPreset { camera: "FinePix S5000", illuminant: "Cloudy", multipliers: [2.0366, 1.0, 1.3825] },
    WbPreset { camera: "FinePix S5000", illuminant: "Daylight", multipliers: [1.8604, 1.0, 1.5159] },
    WbPreset { camera: "FinePix S5000", illuminant: "Flash", multipliers: [2.2022, 1.0, 1.4233] },
    WbPreset { camera: "FinePix S5000", illuminant: "Fluorescent", multipliers: [1.7723, 1.0, 2.3499] },
    WbPreset { camera: "FinePix S5000", illuminant: "Incandescent", multipliers: [1.2121, 1.0, 2.6724] },
    WbPreset { camera: "FinePix S5000", illuminant: "Shade", multipliers: [2.3572, 1.0, 1.212] },
    WbPreset { camera: "FinePix S5200", illuminant: "Cool White Fluorescent", multipliers: [1.5951, 1.0, 1.8397] },
    WbPreset { camera: "FinePix S5200", illuminant: "Daylight", multipliers: [1.5875, 1.0, 1.3813] },
    WbPreset { camera: "FinePix S5200", illuminant: "Daylight Fluorescent", multipliers: [1.9484, 1.0, 1.1875] },
    WbPreset { camera: "FinePix S5200", illuminant: "Incandescent", multipliers: [1.0774, 1.0, 2.1704] },
    WbPreset { camera: "FinePix S5200", illuminant: "Shade", multipliers: [1.9469, 1.0, 1.175] },
    WbPreset { camera: "FinePix S5200", illuminant: "Warm White Fluorescent", multipliers: [1.6821, 1.0, 1.4375] },
    WbPreset { camera: "FinePix S5500", illuminant: "Cool White Fluorescent", multipliers: [1.663, 1.0, 2.163] },
    WbPreset { camera: "FinePix S5500", illuminant: "Daylight", multipliers: [1.7125, 1.0, 1.55] },
    WbPreset { camera: "FinePix S5500", illuminant: "Daylight Fluorescent", multipliers: [1.9783, 1.0, 1.3804] },
    WbPreset { camera: "FinePix S5500", illuminant: "Incandescent", multipliers: [1.115, 1.0, 2.5664] },
    WbPreset { camera: "FinePix S5500", illuminant: "Shade", multipliers: [1.9125, 1.0, 1.375] },
    WbPreset { camera: "FinePix S5500", illuminant: "Warm White Fluorescent", multipliers: [1.6739, 1.0, 1.6739] },
    WbPreset { camera: "FinePix S5600", illuminant: "Cool White Fluorescent", multipliers: [1.5951, 1.0, 1.8397] },
    WbPreset { camera: "FinePix S5600", illuminant: "Daylight", multipliers: [1.5875, 1.0, 1.3813] },
    WbPreset { camera: "FinePix S5600", illuminant: "Daylight Fluorescent", multipliers: [1.9484, 1.0, 1.1875] },
    WbPreset { camera: "FinePix S5600", illuminant: "Incandescent", multipliers: [1.0774, 1.0, 2.1704] },
    WbPreset { camera: "FinePix S5600", illuminant: "Shade", multipliers: [1.9469, 1.0, 1.175] },
    WbPreset { camera: "FinePix S5600", illuminant: "Warm White Fluorescent", multipliers: [1.6821, 1.0, 1.4375] },
    WbPreset { camera: "FinePix S6000fd", illuminant: "Cool White Fluorescent", multipliers: [1.5982, 1.0, 2.0387] },
    WbPreset { camera: "FinePix S6000fd", illuminant: "Daylight", multipliers: [1.5119, 1.0, 1.4315] },
    WbPreset { camera: "FinePix S6000fd", illuminant: "Daylight Fluorescent", multipliers: [1.8661, 1.0, 1.3095] },
    WbPreset { camera: "FinePix S6000fd", illuminant: "Incandescent", multipliers: [0.9762, 1.0, 2.4077] },
    WbPreset { camera: "FinePix S6000fd", illuminant: "Shade", multipliers: [1.6994, 1.0, 1.2321] },
    WbPreset { camera: "FinePix S6000fd", illuminant: "Warm White Fluorescent", multipliers: [1.5685, 1.0, 1.628] },
    WbPreset { camera: "FinePix S6500fd", illuminant: "Cool White Fluorescent", multipliers: [1.4821, 1.0, 2.0893] },
    WbPreset { camera: "FinePix S6500fd", illuminant: "Daylight", multipliers: [1.3988, 1.0, 1.4702] },
    WbPreset { camera: "FinePix S6500fd", illuminant: "Daylight Fluorescent", multipliers: [1.7351, 1.0, 1.3482] },
    WbPreset { camera: "FinePix S6500fd", illuminant: "Incandescent", multipliers: [0.8899, 1.0, 2.4643] },
    WbPreset { camera: "FinePix S6500fd", illuminant: "Shade", multipliers: [1.5804, 1.0, 1.2708] },
    WbPreset { camera: "FinePix S6500fd", illuminant: "Warm White Fluorescent", multipliers: [1.4554, 1.0, 1.6726] },
    WbPreset { camera: "FinePix S7000", illuminant: "Cool White Fluorescent", multipliers: [1.837, 1.0, 2.1304] },
    WbPreset { camera: "FinePix S7000", illuminant: "Daylight", multipliers: [1.9, 1.0, 1.525] },
    WbPreset { camera: "FinePix S7000", illuminant: "Daylight Fluorescent", multipliers: [2.3152, 1.0, 1.3478] },
    WbPreset { camera: "FinePix S7000", illuminant: "Incandescent", multipliers: [1.2212, 1.0, 2.5487] },
    WbPreset { camera: "FinePix S7000", illuminant: "Shade", multipliers: [2.1375, 1.0, 1.35] },
    WbPreset { camera: "FinePix S7000", illuminant: "Warm White Fluorescent", multipliers: [1.9022, 1.0, 1.663] },
    WbPreset { camera: "FinePix S9100", illuminant: "Cloudy", multipliers: [1.5875, 1.0, 1.1281] },
    WbPreset { camera: "FinePix S9100", illuminant: "Cool White Fluorescent", multipliers: [1.4375, 1.0, 1.7201] },
    WbPreset { camera: "FinePix S9100", illuminant: "Daylight", multipliers: [1.5063, 1.0, 1.3188] },
    WbPreset { camera: "FinePix S9100", illuminant: "Daylight Fluorescent", multipliers: [1.7772, 1.0, 1.1386] },
    WbPreset { camera: "FinePix S9100", illuminant: "Incandescent", multipliers: [0.9757, 1.0, 2.0619] },
    WbPreset { camera: "FinePix S9100", illuminant: "Warm White Fluorescent", multipliers: [1.5217, 1.0, 1.3804] },
    WbPreset { camera: "FinePix S9500", illuminant: "Cloudy", multipliers: [1.7, 1.0, 1.0469] },
    WbPreset { camera: "FinePix S9500", illuminant: "Cool White Fluorescent", multipliers: [1.5462, 1.0, 1.6223] },
    WbPreset { camera: "FinePix S9500", illuminant: "Daylight", multipliers: [1.6187, 1.0, 1.2312] },
    WbPreset { camera: "FinePix S9500", illuminant: "Daylight Fluorescent", multipliers: [1.9022, 1.0, 1.0571] },
    WbPreset { camera: "FinePix S9500", illuminant: "Incandescent", multipliers: [1.0642, 1.0, 1.9602] },
    WbPreset { camera: "FinePix S9500", illuminant: "Warm White Fluorescent", multipliers: [1.6332, 1.0, 1.2935] },
    WbPreset { camera: "FinePix S9600", illuminant: "Cool White Fluorescent", multipliers: [1.4674, 1.0, 1.6929] },
    WbPreset { camera: "FinePix S9600", illuminant: "Daylight", multipliers: [1.5344, 1.0, 1.3] },
    WbPreset { camera: "FinePix S9600", illuminant: "Daylight Fluorescent", multipliers: [1.8098, 1.0, 1.1223] },
    WbPreset { camera: "FinePix S9600", illuminant: "Incandescent", multipliers: [0.9956, 1.0, 2.031] },
    WbPreset { camera: "FinePix S9600", illuminant: "Shade", multipliers: [1.6156, 1.0, 1.1125] },
    WbPreset { camera: "FinePix S9600", illuminant: "Warm White Fluorescent", multipliers: [1.5516, 1.0, 1.3614] },
    WbPreset { camera: "FinePix X100", illuminant: "2700K", multipliers: [0.7252, 1.0, 2.788] },
    WbPreset { camera: "FinePix X100", illuminant: "3000K", multipliers: [0.8808, 1.0, 2.3941] },
    WbPreset { camera: "FinePix X100", illuminant: "3300K", multipliers: [1.0066, 1.0, 2.106] },
    WbPreset { camera: "FinePix X100", illuminant: "5000K", multipliers: [1.4536, 1.0, 1.3742] },
    WbPreset { camera: "FinePix X100", illuminant: "Cool White Fluorescent", multipliers: [1.5662, 1.0, 2.0265] },
    WbPreset { camera: "FinePix X100", illuminant: "Daylight", multipliers: [1.4503, 1.0, 1.5033] },
    WbPreset { camera: "FinePix X100", illuminant: "Daylight Fluorescent", multipliers: [1.8841, 1.0, 1.3179] },
    WbPreset { camera: "FinePix X100", illuminant: "Incandescent", multipliers: [0.9735, 1.0, 2.4305] },
    WbPreset { camera: "FinePix X100", illuminant: "Shade", multipliers: [1.5861, 1.0, 1.2947] },
    WbPreset { camera: "FinePix X100", illuminant: "Underwater", multipliers: [1.4603, 1.0, 1.5662] },
    WbPreset { camera: "FinePix X100", illuminant: "Warm White Fluorescent", multipliers: [1.6291, 1.0, 1.5927] },
    WbPreset { camera: "GFX 100", illuminant: "Cloudy", multipliers: [1.8411, 1.0, 1.5] },
    WbPreset { camera: "GFX 100", illuminant: "Day White Fluorescent", multipliers: [1.8444, 1.0, 1.8212] },
    WbPreset { camera: "GFX 100", illuminant: "Daylight", multipliers: [1.6987, 1.0, 1.7583] },
    WbPreset { camera: "GFX 100", illuminant: "Daylight Fluorescent", multipliers: [2.1821, 1.0, 1.4901] },
    WbPreset { camera: "GFX 100", illuminant: "Incandescent", multipliers: [1.1126, 1.0, 2.7053] },
    WbPreset { camera: "GFX 100", illuminant: "Underwater", multipliers: [1.6954, 1.0, 1.7682] },
    WbPreset { camera: "GFX 100", illuminant: "White Fluorescent", multipliers: [1.7616, 1.0, 2.394] },
    WbPreset { camera: "GFX100 II", illuminant: "Cloudy", multipliers: [1.9139, 1.0, 1.6656] },
    WbPreset { camera: "GFX100 II", illuminant: "Day White Fluorescent", multipliers: [1.8808, 1.0, 1.9801] },
    WbPreset { camera: "GFX100 II", illuminant: "Daylight", multipliers: [1.7384, 1.0, 1.9404] },
    WbPreset { camera: "GFX100 II", illuminant: "Daylight Fluorescent", multipliers: [2.2384, 1.0, 1.649] },
    WbPreset { camera: "GFX100 II", illuminant: "Incandescent", multipliers: [1.1523, 1.0, 2.9437] },
    WbPreset { camera: "GFX100 II", illuminant: "Underwater", multipliers: [1.7351, 1.0, 1.9536] },
    WbPreset { camera: "GFX100 II", illuminant: "White Fluorescent", multipliers: [1.7649, 1.0, 2.5762] },
    WbPreset { camera: "GFX100S", illuminant: "Cloudy", multipliers: [1.851, 1.0, 1.5927] },
    WbPreset { camera: "GFX100S", illuminant: "Day White Fluorescent", multipliers: [1.8576, 1.0, 1.9205] },
    WbPreset { camera: "GFX100S", illuminant: "Daylight", multipliers: [1.6921, 1.0, 1.8709] },
    WbPreset { camera: "GFX100S", illuminant: "Daylight Fluorescent", multipliers: [2.1921, 1.0, 1.5828] },
    WbPreset { camera: "GFX100S", illuminant: "Incandescent", multipliers: [1.1258, 1.0, 2.9305] },
    WbPreset { camera: "GFX100S", illuminant: "Underwater", multipliers: [1.6887, 1.0, 1.8808] },
    WbPreset { camera: "GFX100S", illuminant: "White Fluorescent", multipliers: [1.7748, 1.0, 2.4967] },
    WbPreset { camera: "X100S", illuminant: "10000K", multipliers: [2.3609, 1.0, 1.0795] },
    WbPreset { camera: "X100S", illuminant: "2500K", multipliers: [0.9305, 1.0, 3.3477] },
    WbPreset { camera: "X100S", illuminant: "2700K", multipliers: [0.9967, 1.0, 2.9404] },
    WbPreset { camera: "X100S", illuminant: "3000K", multipliers: [1.1192, 1.0, 2.5099] },
    WbPreset { camera: "X100S", illuminant: "3300K", multipliers: [1.2417, 1.0, 2.2185] },
    WbPreset { camera: "X100S", illuminant: "5000K", multipliers: [1.7748, 1.0, 1.5298] },
    WbPreset { camera: "X100S", illuminant: "5600K", multipliers: [1.9007, 1.0, 1.4238] },
    WbPreset { camera: "X100S", illuminant: "6300K", multipliers: [2.0199, 1.0, 1.3344] },
    WbPreset { camera: "X100S", illuminant: "6700K", multipliers: [2.0762, 1.0, 1.2914] },
    WbPreset { camera: "X100S", illuminant: "Cool White Fluorescent", multipliers: [1.8742, 1.0, 1.9139] },
    WbPreset { camera: "X100S", illuminant: "Daylight", multipliers: [1.8742, 1.0, 1.4901] },
    WbPreset { camera: "X100S", illuminant: "Daylight Fluorescent", multipliers: [2.3444, 1.0, 1.2649] },
    WbPreset { camera: "X100S", illuminant: "Incandescent", multipliers: [1.1987, 1.0, 2.3411] },
    WbPreset { camera: "X100S", illuminant: "Shade", multipliers: [2.0497, 1.0, 1.2715] },
    WbPreset { camera: "X100S", illuminant: "Underwater", multipliers: [1.8742, 1.0, 1.4901] },
    WbPreset { camera: "X100S", illuminant: "Warm White Fluorescent", multipliers: [2.0, 1.0, 1.5099] },
    WbPreset { camera: "X100T", illuminant: "Cloudy", multipliers: [2.1093, 1.0, 1.3245] },
    WbPreset { camera: "X100T", illuminant: "Day White Fluorescent", multipliers: [2.1026, 1.0, 1.5894] },
    WbPreset { camera: "X100T", illuminant: "Daylight", multipliers: [1.9305, 1.0, 1.5397] },
    WbPreset { camera: "X100T", illuminant: "Daylight Fluorescent", multipliers: [2.457, 1.0, 1.3344] },
    WbPreset { camera: "X100T", illuminant: "Incandescent", multipliers: [1.2384, 1.0, 2.3079] },
    WbPreset { camera: "X100T", illuminant: "Underwater", multipliers: [1.9272, 1.0, 1.5497] },
    WbPreset { camera: "X100T", illuminant: "White Fluorescent", multipliers: [2.0132, 1.0, 1.9702] },
    WbPreset { camera: "X100F", illuminant: "Cloudy", multipliers: [2.1424, 1.0, 1.5927] },
    WbPreset { camera: "X100F", illuminant: "Day White Fluorescent", multipliers: [2.0828, 1.0, 1.9834] },
    WbPreset { camera: "X100F", illuminant: "Daylight", multipliers: [1.9503, 1.0, 1.8543] },
    WbPreset { camera: "X100F", illuminant: "Daylight Fluorescent", multipliers: [2.4868, 1.0, 1.6291] },
    WbPreset { camera: "X100F", illuminant: "Incandescent", multipliers: [1.2715, 1.0, 2.8311] },
    WbPreset { camera: "X100F", illuminant: "Underwater", multipliers: [1.9503, 1.0, 1.8543] },
    WbPreset { camera: "X100F", illuminant: "White Fluorescent", multipliers: [1.957, 1.0, 2.5596] },
    WbPreset { camera: "X100V", illuminant: "Cloudy", multipliers: [1.947, 1.0, 1.5166] },
    WbPreset { camera: "X100V", illuminant: "Day White Fluorescent", multipliers: [1.9801, 1.0, 1.9073] },
    WbPreset { camera: "X100V", illuminant: "Daylight", multipliers: [1.7848, 1.0, 1.7682] },
    WbPreset { camera: "X100V", illuminant: "Daylight Fluorescent", multipliers: [2.3278, 1.0, 1.5364] },
    WbPreset { camera: "X100V", illuminant: "Incandescent", multipliers: [1.1921, 1.0, 2.702] },
    WbPreset { camera: "X100V", illuminant: "Underwater", multipliers: [1.7781, 1.0, 1.7517] },
    WbPreset { camera: "X100V", illuminant: "White Fluorescent", multipliers: [1.8874, 1.0, 2.4205] },
    WbPreset { camera: "X20", illuminant: "Cloudy", multipliers: [1.8278, 1.0, 1.6225] },
    WbPreset { camera: "X20", illuminant: "Day White Fluorescent", multipliers: [1.755, 1.0, 1.8642] },
    WbPreset { camera: "X20", illuminant: "Daylight", multipliers: [1.6887, 1.0, 1.851] },
    WbPreset { camera: "X20", illuminant: "Daylight Fluorescent", multipliers: [2.053, 1.0, 1.6258] },
    WbPreset { camera: "X20", illuminant: "Incandescent", multipliers: [1.0662, 1.0, 2.606] },
    WbPreset { camera: "X20", illuminant: "Underwater", multipliers: [1.6887, 1.0, 1.851] },
    WbPreset { camera: "X20", illuminant: "White Fluorescent", multipliers: [1.755, 1.0, 2.3411] },
    WbPreset { camera: "X70", illuminant: "Cloudy", multipliers: [2.2119, 1.0, 1.3113] },
    WbPreset { camera: "X70", illuminant: "Day White Fluorescent", multipliers: [2.1887, 1.0, 1.5662] },
    WbPreset { camera: "X70", illuminant: "Daylight", multipliers: [2.0099, 1.0, 1.5132] },
    WbPreset { camera: "X70", illuminant: "Daylight Fluorescent", multipliers: [2.6192, 1.0, 1.3113] },
    WbPreset { camera: "X70", illuminant: "Incandescent", multipliers: [1.3146, 1.0, 2.2517] },
    WbPreset { camera: "X70", illuminant: "Underwater", multipliers: [2.0066, 1.0, 1.5331] },
    WbPreset { camera: "X70", illuminant: "White Fluorescent", multipliers: [2.0563, 1.0, 2.0132] },
    WbPreset { camera: "X-M1", illuminant: "Cloudy", multipliers: [2.1391, 1.0, 1.5993] },
    WbPreset { camera: "X-M1", illuminant: "Day White Fluorescent", multipliers: [2.0662, 1.0, 1.8709] },
    WbPreset { camera: "X-M1", illuminant: "Daylight", multipliers: [1.9437, 1.0, 1.8245] },
    WbPreset { camera: "X-M1", illuminant: "Daylight Fluorescent", multipliers: [2.4404, 1.0, 1.5927] },
    WbPreset { camera: "X-M1", illuminant: "Incandescent", multipliers: [1.2252, 1.0, 2.9768] },
    WbPreset { camera: "X-M1", illuminant: "White Fluorescent", multipliers: [1.9371, 1.0, 2.3609] },
    WbPreset { camera: "X-A2", illuminant: "Cloudy", multipliers: [2.0331, 1.0, 1.4967] },
    WbPreset { camera: "X-A2", illuminant: "Day White Fluorescent", multipliers: [1.9868, 1.0, 1.8046] },
    WbPreset { camera: "X-A2", illuminant: "Daylight", multipliers: [1.8245, 1.0, 1.7583] },
    WbPreset { camera: "X-A2", illuminant: "Daylight Fluorescent", multipliers: [2.3278, 1.0, 1.5] },
    WbPreset { camera: "X-A2", illuminant: "Incandescent", multipliers: [1.1623, 1.0, 2.8642] },
    WbPreset { camera: "X-A2", illuminant: "White Fluorescent", multipliers: [1.9007, 1.0, 2.2848] },
    WbPreset { camera: "X-E1", illuminant: "5000K", multipliers: [1.8146, 1.0, 1.7318] },
    WbPreset { camera: "X-E1", illuminant: "Cool White Fluorescent", multipliers: [1.8477, 1.0, 2.3179] },
    WbPreset { camera: "X-E1", illuminant: "Daylight", multipliers: [1.8212, 1.0, 1.8046] },
    WbPreset { camera: "X-E1", illuminant: "Daylight Fluorescent", multipliers: [2.3212, 1.0, 1.5662] },
    WbPreset { camera: "X-E1", illuminant: "Incandescent", multipliers: [1.1656, 1.0, 2.9205] },
    WbPreset { camera: "X-E1", illuminant: "Shade", multipliers: [2.0397, 1.0, 1.5728] },
    WbPreset { camera: "X-E1", illuminant: "Underwater", multipliers: [1.8212, 1.0, 1.8046] },
    WbPreset { camera: "X-E1", illuminant: "Warm White Fluorescent", multipliers: [1.9669, 1.0, 1.8377] },
    WbPreset { camera: "X-E2", illuminant: "Cool White Fluorescent", multipliers: [1.904, 1.0, 1.9702] },
    WbPreset { camera: "X-E2", illuminant: "Daylight", multipliers: [1.8576, 1.0, 1.5497] },
    WbPreset { camera: "X-E2", illuminant: "Daylight Fluorescent", multipliers: [2.3874, 1.0, 1.3377] },
    WbPreset { camera: "X-E2", illuminant: "Incandescent", multipliers: [1.1987, 1.0, 2.3642] },
    WbPreset { camera: "X-E2", illuminant: "Shade", multipliers: [2.0563, 1.0, 1.3411] },
    WbPreset { camera: "X-E2", illuminant: "Underwater", multipliers: [1.8576, 1.0, 1.5497] },
    WbPreset { camera: "X-E2", illuminant: "Warm White Fluorescent", multipliers: [2.0298, 1.0, 1.5762] },
    WbPreset { camera: "X-E3", illuminant: "Cloudy", multipliers: [2.1589, 1.0, 1.5265] },
    WbPreset { camera: "X-E3", illuminant: "Day White Fluorescent", multipliers: [2.0861, 1.0, 1.8709] },
    WbPreset { camera: "X-E3", illuminant: "Daylight", multipliers: [1.9503, 1.0, 1.7947] },
    WbPreset { camera: "X-E3", illuminant: "Daylight Fluorescent", multipliers: [2.4702, 1.0, 1.4934] },
    WbPreset { camera: "X-E3", illuminant: "Incandescent", multipliers: [1.2649, 1.0, 2.7914] },
    WbPreset { camera: "X-E3", illuminant: "Underwater", multipliers: [1.9503, 1.0, 1.8311] },
    WbPreset { camera: "X-E3", illuminant: "White Fluorescent", multipliers: [1.9834, 1.0, 2.4901] },
    WbPreset { camera: "X-E4", illuminant: "Cloudy", multipliers: [2.0927, 1.0, 1.5762] },
    WbPreset { camera: "X-E4", illuminant: "Day White Fluorescent", multipliers: [2.0894, 1.0, 1.9603] },
    WbPreset { camera: "X-E4", illuminant: "Daylight", multipliers: [1.9172, 1.0, 1.8477] },
    WbPreset { camera: "X-E4", illuminant: "Daylight Fluorescent", multipliers: [2.4702, 1.0, 1.5728] },
    WbPreset { camera: "X-E4", illuminant: "Incandescent", multipliers: [1.3013, 1.0, 2.8179] },
    WbPreset { camera: "X-E4", illuminant: "Underwater", multipliers: [1.9172, 1.0, 1.8477] },
    WbPreset { camera: "X-E4", illuminant: "White Fluorescent", multipliers: [1.9834, 1.0, 2.4967] },
    WbPreset { camera: "X-H1", illuminant: "Cloudy", multipliers: [2.1391, 1.0, 1.6457] },
    WbPreset { camera: "X-H1", illuminant: "Day White Fluorescent", multipliers: [2.0397, 1.0, 2.0232] },
    WbPreset { camera: "X-H1", illuminant: "Daylight", multipliers: [1.9272, 1.0, 1.9172] },
    WbPreset { camera: "X-H1", illuminant: "Daylight Fluorescent", multipliers: [2.4305, 1.0, 1.6457] },
    WbPreset { camera: "X-H1", illuminant: "Incandescent", multipliers: [1.2947, 1.0, 2.8742] },
    WbPreset { camera: "X-H1", illuminant: "Underwater", multipliers: [1.9139, 1.0, 1.9371] },
    WbPreset { camera: "X-H1", illuminant: "White Fluorescent", multipliers: [1.9238, 1.0, 2.5894] },
    WbPreset { camera: "X-H2", illuminant: "Cloudy", multipliers: [2.0166, 1.0, 1.6093] },
    WbPreset { camera: "X-H2", illuminant: "Day White Fluorescent", multipliers: [1.9934, 1.0, 2.0066] },
    WbPreset { camera: "X-H2", illuminant: "Daylight", multipliers: [1.8444, 1.0, 1.8642] },
    WbPreset { camera: "X-H2", illuminant: "Daylight Fluorescent", multipliers: [2.3377, 1.0, 1.606] },
    WbPreset { camera: "X-H2", illuminant: "Incandescent", multipliers: [1.2517, 1.0, 2.8377] },
    WbPreset { camera: "X-H2", illuminant: "Underwater", multipliers: [1.8411, 1.0, 1.8775] },
    WbPreset { camera: "X-H2", illuminant: "White Fluorescent", multipliers: [1.894, 1.0, 2.5066] },
    WbPreset { camera: "X-H2S", illuminant: "Cloudy", multipliers: [1.9768, 1.0, 1.6026] },
    WbPreset { camera: "X-H2S", illuminant: "Day White Fluorescent", multipliers: [1.9901, 1.0, 2.0033] },
    WbPreset { camera: "X-H2S", illuminant: "Daylight", multipliers: [1.8146, 1.0, 1.8576] },
    WbPreset { camera: "X-H2S", illuminant: "Daylight Fluorescent", multipliers: [2.3377, 1.0, 1.6291] },
    WbPreset { camera: "X-H2S", illuminant: "Incandescent", multipliers: [1.2318, 1.0, 2.8146] },
    WbPreset { camera: "X-H2S", illuminant: "Underwater", multipliers: [1.8113, 1.0, 1.8675] },
    WbPreset { camera: "X-H2S", illuminant: "White Fluorescent", multipliers: [1.8974, 1.0, 2.5397] },
    WbPreset { camera: "X-S10", illuminant: "Cloudy", multipliers: [2.0232, 1.0, 1.6258] },
    WbPreset { camera: "X-S10", illuminant: "Day White Fluorescent", multipliers: [2.0265, 1.0, 2.0497] },
    WbPreset { camera: "X-S10", illuminant: "Daylight", multipliers: [1.8576, 1.0, 1.894] },
    WbPreset { camera: "X-S10", illuminant: "Daylight Fluorescent", multipliers: [2.3874, 1.0, 1.6556] },
    WbPreset { camera: "X-S10", illuminant: "Incandescent", multipliers: [1.2483, 1.0, 2.8676] },
    WbPreset { camera: "X-S10", illuminant: "Underwater", multipliers: [1.851, 1.0, 1.9007] },
    WbPreset { camera: "X-S10", illuminant: "White Fluorescent", multipliers: [1.9437, 1.0, 2.5795] },
    WbPreset { camera: "X-T1", illuminant: "5000K", multipliers: [1.8477, 1.0, 1.5464] },
    WbPreset { camera: "X-T1", illuminant: "Cool White Fluorescent", multipliers: [1.947, 1.0, 2.0662] },
    WbPreset { camera: "X-T1", illuminant: "Daylight", multipliers: [1.894, 1.0, 1.5695] },
    WbPreset { camera: "X-T1", illuminant: "Daylight Fluorescent", multipliers: [2.394, 1.0, 1.3775] },
    WbPreset { camera: "X-T1", illuminant: "Incandescent", multipliers: [1.2682, 1.0, 2.2848] },
    WbPreset { camera: "X-T1", illuminant: "Shade", multipliers: [2.0927, 1.0, 1.3477] },
    WbPreset { camera: "X-T1", illuminant: "Underwater", multipliers: [1.894, 1.0, 1.5695] },
    WbPreset { camera: "X-T1", illuminant: "Warm White Fluorescent", multipliers: [2.0232, 1.0, 1.6225] },
    WbPreset { camera: "X-T2", illuminant: "Day White Fluorescent", multipliers: [1.9768, 1.0, 2.053] },
    WbPreset { camera: "X-T2", illuminant: "Daylight", multipliers: [1.8775, 1.0, 1.9404] },
    WbPreset { camera: "X-T2", illuminant: "Daylight Fluorescent", multipliers: [2.3609, 1.0, 1.6689] },
    WbPreset { camera: "X-T2", illuminant: "Incandescent", multipliers: [1.2483, 1.0, 2.9073] },
    WbPreset { camera: "X-T2", illuminant: "Shade", multipliers: [2.0861, 1.0, 1.6722] },
    WbPreset { camera: "X-T2", illuminant: "Underwater", multipliers: [1.8775, 1.0, 1.9404] },
    WbPreset { camera: "X-T2", illuminant: "White Fluorescent", multipliers: [1.8676, 1.0, 2.6391] },
    WbPreset { camera: "X-T3", illuminant: "Cloudy", multipliers: [1.9106, 1.0, 1.606] },
    WbPreset { camera: "X-T3", illuminant: "Day White Fluorescent", multipliers: [1.9106, 1.0, 2.0166] },
    WbPreset { camera: "X-T3", illuminant: "Daylight", multipliers: [1.755, 1.0, 1.8642] },
    WbPreset { camera: "X-T3", illuminant: "Daylight Fluorescent", multipliers: [2.2517, 1.0, 1.6358] },
    WbPreset { camera: "X-T3", illuminant: "Incandescent", multipliers: [1.1821, 1.0, 2.8013] },
    WbPreset { camera: "X-T3", illuminant: "Underwater", multipliers: [1.7517, 1.0, 1.8775] },
    WbPreset { camera: "X-T3", illuminant: "White Fluorescent", multipliers: [1.8311, 1.0, 2.5265] },
    WbPreset { camera: "X-T4", illuminant: "Cloudy", multipliers: [2.0033, 1.0, 1.5762] },
    WbPreset { camera: "X-T4", illuminant: "Day White Fluorescent", multipliers: [2.0066, 1.0, 1.9967] },
    WbPreset { camera: "X-T4", illuminant: "Daylight", multipliers: [1.8377, 1.0, 1.8278] },
    WbPreset { camera: "X-T4", illuminant: "Daylight Fluorescent", multipliers: [2.3609, 1.0, 1.606] },
    WbPreset { camera: "X-T4", illuminant: "Incandescent", multipliers: [1.2384, 1.0, 2.8046] },
    WbPreset { camera: "X-T4", illuminant: "Underwater", multipliers: [1.8377, 1.0, 1.8278] },
    WbPreset { camera: "X-T4", illuminant: "White Fluorescent", multipliers: [1.9205, 1.0, 2.5199] },
    WbPreset { camera: "X-T5", illuminant: "Cloudy", multipliers: [2.0596, 1.0, 1.5662] },
    WbPreset { camera: "X-T5", illuminant: "Day White Fluorescent", multipliers: [2.0364, 1.0, 1.9437] },
    WbPreset { camera: "X-T5", illuminant: "Daylight", multipliers: [1.8841, 1.0, 1.8113] },
    WbPreset { camera: "X-T5", illuminant: "Daylight Fluorescent", multipliers: [2.3907, 1.0, 1.5629] },
    WbPreset { camera: "X-T5", illuminant: "Incandescent", multipliers: [1.2748, 1.0, 2.7384] },
    WbPreset { camera: "X-T5", illuminant: "Underwater", multipliers: [1.8841, 1.0, 1.8113] },
    WbPreset { camera: "X-T5", illuminant: "White Fluorescent", multipliers: [1.9338, 1.0, 2.4238] },
    WbPreset { camera: "X-T10", illuminant: "Cool White Fluorescent", multipliers: [1.8907, 1.0, 2.0464] },
    WbPreset { camera: "X-T10", illuminant: "Daylight", multipliers: [1.8841, 1.0, 1.5265] },
    WbPreset { camera: "X-T10", illuminant: "Daylight Fluorescent", multipliers: [2.4238, 1.0, 1.3344] },
    WbPreset { camera: "X-T10", illuminant: "Incandescent", multipliers: [1.2119, 1.0, 2.3212] },
    WbPreset { camera: "X-T10", illuminant: "Shade", multipliers: [2.0728, 1.0, 1.3245] },
    WbPreset { camera: "X-T10", illuminant: "Underwater", multipliers: [1.9901, 1.0, 1.4404] },
    WbPreset { camera: "X-T10", illuminant: "Warm White Fluorescent", multipliers: [2.0265, 1.0, 1.5993] },
    WbPreset { camera: "X-T20", illuminant: "Day White Fluorescent", multipliers: [1.9834, 1.0, 1.9669] },
    WbPreset { camera: "X-T20", illuminant: "Daylight", multipliers: [1.8808, 1.0, 1.8742] },
    WbPreset { camera: "X-T20", illuminant: "Daylight Fluorescent", multipliers: [2.3676, 1.0, 1.5762] },
    WbPreset { camera: "X-T20", illuminant: "Incandescent", multipliers: [1.2152, 1.0, 2.8576] },
    WbPreset { camera: "X-T20", illuminant: "Shade", multipliers: [2.0894, 1.0, 1.6026] },
    WbPreset { camera: "X-T20", illuminant: "Underwater", multipliers: [1.8808, 1.0, 1.8742] },
    WbPreset { camera: "X-T20", illuminant: "White Fluorescent", multipliers: [1.9073, 1.0, 2.5795] },
    WbPreset { camera: "X-T30", illuminant: "Day White Fluorescent", multipliers: [1.9901, 1.0, 1.8874] },
    WbPreset { camera: "X-T30", illuminant: "Daylight", multipliers: [1.8278, 1.0, 1.7417] },
    WbPreset { camera: "X-T30", illuminant: "Daylight Fluorescent", multipliers: [2.3411, 1.0, 1.5232] },
    WbPreset { camera: "X-T30", illuminant: "Incandescent", multipliers: [1.2318, 1.0, 2.6391] },
    WbPreset { camera: "X-T30", illuminant: "Shade", multipliers: [1.9868, 1.0, 1.4934] },
    WbPreset { camera: "X-T30", illuminant: "Underwater", multipliers: [1.8278, 1.0, 1.7417] },
    WbPreset { camera: "X-T30", illuminant: "White Fluorescent", multipliers: [1.9073, 1.0, 2.3742] },
    WbPreset { camera: "X-T200", illuminant: "Cloudy", multipliers: [1.8945, 1.0, 1.6328] },
    WbPreset { camera: "X-T200", illuminant: "Day White Fluorescent", multipliers: [1.8945, 1.0, 1.9961] },
    WbPreset { camera: "X-T200", illuminant: "Daylight", multipliers: [1.6914, 1.0, 1.9531] },
    WbPreset { camera: "X-T200", illuminant: "Daylight Fluorescent", multipliers: [2.2109, 1.0, 1.707] },
    WbPreset { camera: "X-T200", illuminant: "Incandescent", multipliers: [1.0781, 1.0, 3.0156] },
    WbPreset { camera: "X-T200", illuminant: "Underwater", multipliers: [1.7891, 1.0, 1.8438] },
    WbPreset { camera: "X-T200", illuminant: "White Fluorescent", multipliers: [1.8164, 1.0, 2.5898] },
    WbPreset { camera: "X-Pro1", illuminant: "5000K", multipliers: [1.8576, 1.0, 1.702] },
    WbPreset { camera: "X-Pro1", illuminant: "Cool White Fluorescent", multipliers: [1.9669, 1.0, 2.255] },
    WbPreset { camera: "X-Pro1", illuminant: "Daylight", multipliers: [1.8609, 1.0, 1.7086] },
    WbPreset { camera: "X-Pro1", illuminant: "Daylight Fluorescent", multipliers: [2.3907, 1.0, 1.5] },
    WbPreset { camera: "X-Pro1", illuminant: "Incandescent", multipliers: [1.2252, 1.0, 2.7086] },
    WbPreset { camera: "X-Pro1", illuminant: "Shade", multipliers: [2.106, 1.0, 1.4603] },
    WbPreset { camera: "X-Pro1", illuminant: "Underwater", multipliers: [1.8609, 1.0, 1.7086] },
    WbPreset { camera: "X-Pro1", illuminant: "Warm White Fluorescent", multipliers: [2.0596, 1.0, 1.7947] },
    WbPreset { camera: "X-Pro2", illuminant: "Cloudy", multipliers: [2.1457, 1.0, 1.5828] },
    WbPreset { camera: "X-Pro2", illuminant: "Day White Fluorescent", multipliers: [2.0695, 1.0, 1.9503] },
    WbPreset { camera: "X-Pro2", illuminant: "Daylight", multipliers: [1.947, 1.0, 1.8311] },
    WbPreset { camera: "X-Pro2", illuminant: "Daylight Fluorescent", multipliers: [2.4636, 1.0, 1.6026] },
    WbPreset { camera: "X-Pro2", illuminant: "Incandescent", multipliers: [1.2649, 1.0, 2.755] },
    WbPreset { camera: "X-Pro2", illuminant: "Underwater", multipliers: [1.9437, 1.0, 1.8278] },
    WbPreset { camera: "X-Pro2", illuminant: "White Fluorescent", multipliers: [1.9735, 1.0, 2.5132] },
    WbPreset { camera: "X-Pro3", illuminant: "Cloudy", multipliers: [2.0132, 1.0, 1.5464] },
    WbPreset { camera: "X-Pro3", illuminant: "Day White Fluorescent", multipliers: [2.0132, 1.0, 1.9702] },
    WbPreset { camera: "X-Pro3", illuminant: "Daylight", multipliers: [1.8676, 1.0, 1.8079] },
    WbPreset { camera: "X-Pro3", illuminant: "Daylight Fluorescent", multipliers: [2.3642, 1.0, 1.5762] },
    WbPreset { camera: "X-Pro3", illuminant: "Incandescent", multipliers: [1.2517, 1.0, 2.7715] },
    WbPreset { camera: "X-Pro3", illuminant: "Underwater", multipliers: [1.8676, 1.0, 1.8079] },
    WbPreset { camera: "X-Pro3", illuminant: "White Fluorescent", multipliers: [1.9305, 1.0, 2.4868] },
];

// ── Lookup ──────────────────────────────────────────────────────

/// Normalize a camera or illuminant name for loose matching:
/// uppercase, drop ASCII whitespace, hyphens and underscores. So
/// "X-T5", "x-t5", and "X T 5" all collapse to "XT5".
fn normalize(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if c.is_ascii_whitespace() || c == '-' || c == '_' {
            continue;
        }
        for u in c.to_uppercase() {
            out.push(u);
        }
    }
    out
}

/// Look up a WB preset by (camera_model, illuminant). Matching is
/// case-insensitive and ignores spaces/hyphens on both fields.
pub fn lookup_wb(camera_model: &str, illuminant: &str) -> Option<[f32; 3]> {
    let cam = normalize(camera_model);
    let illum = normalize(illuminant);
    FUJI_WB_PRESETS
        .iter()
        .find(|p| normalize(p.camera) == cam && normalize(p.illuminant) == illum)
        .map(|p| p.multipliers)
}

/// Default daylight WB for the given camera, with fallbacks through
/// related sensor families when the exact model is not in the table.
///
/// Order: exact match → sensor-family sibling (e.g. X100VI → X-T5/X-H2
/// share the X-Trans V sensor) → generic per-generation average →
/// generic Fujifilm X-Trans average.
pub fn default_daylight_wb(camera_model: &str) -> [f32; 3] {
    if let Some(wb) = lookup_wb(camera_model, "Daylight") {
        return wb;
    }
    for sibling in sensor_family_siblings(camera_model) {
        if let Some(wb) = lookup_wb(sibling, "Daylight") {
            return wb;
        }
    }
    match sensor_generation(camera_model) {
        SensorGen::XTransV => [1.85, 1.0, 1.84],
        SensorGen::XTransIV => [1.87, 1.0, 1.83],
        SensorGen::XTransIII => [1.91, 1.0, 1.79],
        SensorGen::XTransII => [1.89, 1.0, 1.55],
        SensorGen::XTransI => [1.87, 1.0, 1.78],
        SensorGen::Gfx => [1.71, 1.0, 1.86],
        SensorGen::Bayer => [1.76, 1.0, 1.86],
        SensorGen::Unknown => [1.88, 1.0, 1.82],
    }
}

#[derive(Copy, Clone, Debug)]
enum SensorGen {
    XTransI,
    XTransII,
    XTransIII,
    XTransIV,
    XTransV,
    Gfx,
    Bayer,
    Unknown,
}

fn sensor_generation(model: &str) -> SensorGen {
    let m = normalize(model);
    if m.contains("GFX") {
        return SensorGen::Gfx;
    }
    // X-Trans V (40 MP, 2022+) and X-H2S (BSI 26MP, 2022, same era)
    if m.contains("XT5") || m.contains("XH2") || m.contains("X100VI") {
        return SensorGen::XTransV;
    }
    // X-Trans IV (26 MP, 2018–2022)
    if m.contains("XT3") || m.contains("XT4") || m.contains("XT30")
        || m.contains("XS10") || m.contains("XS20") || m.contains("XPRO3")
        || m.contains("XE4") || m.contains("X100V")
    {
        return SensorGen::XTransIV;
    }
    // X-Trans III (24 MP, 2016–2018)
    if m.contains("XT2") || m.contains("XT20") || m.contains("XPRO2")
        || m.contains("XE3") || m.contains("XH1") || m.contains("X100F")
    {
        return SensorGen::XTransIII;
    }
    // X-Trans II (16 MP, 2013–2015)
    if m.contains("XT1") || m.contains("XT10") || m.contains("XE2")
        || m.contains("X100S") || m.contains("X100T") || m.contains("X70")
        || m.contains("X20") || m.contains("XQ")
    {
        return SensorGen::XTransII;
    }
    // X-Trans I (16 MP, 2012–2013)
    if m.contains("XPRO1") || m.contains("XE1") || m.contains("XM1")
        || m.contains("FINEPIXX100")
    {
        return SensorGen::XTransI;
    }
    // Bayer Fujifilm X bodies (X-A, X-T100/200)
    if m.contains("XA") || m.contains("XT100") || m.contains("XT200") {
        return SensorGen::Bayer;
    }
    SensorGen::Unknown
}

fn sensor_family_siblings(model: &str) -> &'static [&'static str] {
    match sensor_generation(model) {
        SensorGen::XTransV => &["X-T5", "X-H2", "X-H2S"],
        SensorGen::XTransIV => &["X-T4", "X-T3", "X-Pro3", "X100V", "X-E4", "X-S10"],
        SensorGen::XTransIII => &["X-T2", "X-Pro2", "X100F", "X-E3", "X-H1"],
        SensorGen::XTransII => &["X-T1", "X-T10", "X-E2", "X100S", "X100T"],
        SensorGen::XTransI => &["X-Pro1", "X-E1", "X-M1"],
        SensorGen::Gfx => &["GFX 100", "GFX100S", "GFX100 II"],
        SensorGen::Bayer => &["X-A2", "X-T200"],
        SensorGen::Unknown => &["X-T5", "X-T4", "X-T3"],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_exact_match() {
        let wb = lookup_wb("X-T5", "Daylight").expect("X-T5 Daylight present");
        assert!((wb[0] - 1.8841).abs() < 1e-3);
        assert_eq!(wb[1], 1.0);
        assert!((wb[2] - 1.8113).abs() < 1e-3);
    }

    #[test]
    fn lookup_is_loose_on_camera_name() {
        let a = lookup_wb("X-T5", "Daylight").unwrap();
        for variant in ["x-t5", "X T 5", "xt5", "X_T_5", "  X-T5  "] {
            assert_eq!(a, lookup_wb(variant, "Daylight").unwrap(), "variant {variant}");
        }
    }

    #[test]
    fn lookup_is_loose_on_illuminant() {
        let a = lookup_wb("X-T5", "Daylight").unwrap();
        assert_eq!(a, lookup_wb("X-T5", "daylight").unwrap());
        assert_eq!(a, lookup_wb("X-T5", "DAYLIGHT").unwrap());
    }

    #[test]
    fn green_channel_is_normalized() {
        for p in FUJI_WB_PRESETS {
            assert!(
                (p.multipliers[1] - 1.0).abs() < 1e-4,
                "{} {} G not normalized: {:?}",
                p.camera,
                p.illuminant,
                p.multipliers
            );
        }
    }

    #[test]
    fn x100vi_falls_back_to_xtrans_v_sibling() {
        // X100VI is not in darktable's database but shares the X-Trans V
        // sensor with the X-T5/X-H2. Should resolve close to ~[1.88, 1.0, 1.81].
        let wb = default_daylight_wb("X100VI");
        assert!(wb[0] > 1.6 && wb[0] < 2.1, "X100VI R out of range: {}", wb[0]);
        assert_eq!(wb[1], 1.0);
        assert!(wb[2] > 1.6 && wb[2] < 2.0, "X100VI B out of range: {}", wb[2]);
    }

    #[test]
    fn unknown_model_falls_back_to_xtrans_v_sibling() {
        // Unknown models fall back through Unknown's sibling list (X-T5,
        // X-T4, X-T3) before reaching the per-generation default, so we
        // expect to hit the X-T5 daylight values.
        let wb = default_daylight_wb("Definitely Not A Camera");
        assert_eq!(wb, lookup_wb("X-T5", "Daylight").unwrap());
    }

    #[test]
    fn known_models_resolve_without_fallback() {
        for model in ["X-T5", "X-T4", "X-T3", "X-Pro2", "X100V", "GFX100S"] {
            let exact = lookup_wb(model, "Daylight").unwrap();
            assert_eq!(default_daylight_wb(model), exact, "{model}");
        }
    }
}
