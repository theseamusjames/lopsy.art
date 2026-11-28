//! NEF files must decode as recorded: each one's baked decode and prepared
//! linear plane (with its parameters and develop defaults) are hashed and
//! compared with recorded hashes (see `EXPECTED`). A sample is known by
//! its body, layout and depth, not its file name, so the folder's names
//! do not matter.
//!
//! Needs `LOPSY_NEF_SAMPLES` (CC0 files from raw.pixls.us); without it the
//! test notes that and passes. Slow in a debug build: run with
//! `--release`. `LOPSY_NEF_HASH_PRINT=1` prints the hashes of every file
//! in the folder that decodes.

use std::path::PathBuf;

use lopsy_core::nef;

struct Fnv(u64);

impl Fnv {
    fn new() -> Self {
        Fnv(0xcbf2_9ce4_8422_2325)
    }
    fn eat(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 ^= u64::from(b);
            self.0 = self.0.wrapping_mul(0x0100_0000_01b3);
        }
    }
    fn floats(&mut self, v: &[f32]) {
        for x in v {
            self.eat(&x.to_bits().to_le_bytes());
        }
    }
}

fn key(info: &nef::NefInfo) -> String {
    format!("{} {:?} {}-bit", info.camera_model, info.layout, info.bits)
}

fn baked_hash(data: &[u8]) -> u64 {
    let img = nef::read_nef(data).unwrap();
    let mut h = Fnv::new();
    h.eat(&img.image.width.to_le_bytes());
    h.eat(&img.image.height.to_le_bytes());
    h.floats(&img.image.pixels);
    h.eat(format!("{:?} {} {}", img.colour, img.camera_model, img.exposure_ev).as_bytes());
    h.0
}

fn linear_hash(data: &[u8]) -> u64 {
    let prep = nef::linear::prepare_nef(data).unwrap();
    let mut h = Fnv::new();
    h.floats(&prep.plane);
    let d = nef::linear::develop_defaults(&prep.params);
    h.floats(&d.cam_to_rgb);
    h.floats(&d.wb_ratio);
    h.floats(&prep.params.as_shot_gain);
    h.eat(&prep.params.width.to_le_bytes());
    h.eat(&prep.params.height.to_le_bytes());
    h.eat(format!("{:?}", prep.params.cfa).as_bytes());
    h.0
}

/// (body, layout and depth; baked decode; linear plane and defaults),
/// recorded when the NEF decoder was written; the D850's again when it
/// took a matrix of the engine's own.
const EXPECTED: [(&str, u64, u64); 8] = [
    ("NIKON D200 Packed { bits: 12, row_bytes: 5856, msb_first: true } 12-bit", 0xbcd76d0162bdde60, 0x3716b1fd36e83ca5),
    ("NIKON D3 Packed { bits: 12, row_bytes: 6432, msb_first: true } 12-bit", 0xd890187c04dc0b4d, 0x4c1e18ea82349865),
    ("NIKON D3 Words { big_endian: true } 14-bit", 0x06553df1986db6ca, 0x338cca83ecbfb2f3),
    ("NIKON D500 Packed { bits: 12, row_bytes: 8400, msb_first: false } 12-bit", 0xaf3bd89792db43af, 0xd0de66b78dcce734),
    ("NIKON D6 Packed { bits: 14, row_bytes: 9776, msb_first: false } 14-bit", 0xf62d749b25818c3b, 0xae3b47b3864481e7),
    ("NIKON D850 Words { big_endian: false } 14-bit", 0x158a96d94be0c820, 0x9b06fe73b0531b1d),
    ("NIKON Z 6 Packed { bits: 12, row_bytes: 9104, msb_first: false } 12-bit", 0xfe0ef3c1a3ff6a85, 0xda7fdb18c758e65f),
    ("NIKON Z 6 Packed { bits: 14, row_bytes: 10624, msb_first: false } 14-bit", 0x6b07c70c369f8417, 0x1fa2b6a9882016e8),
];

#[test]
fn nefs_decode_as_recorded() {
    let Some(dir) = std::env::var_os("LOPSY_NEF_SAMPLES").map(PathBuf::from) else {
        eprintln!("LOPSY_NEF_SAMPLES is not set: skipping the NEF decode hashes");
        return;
    };
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("nef"))).collect();
    files.sort();
    let print = std::env::var_os("LOPSY_NEF_HASH_PRINT").is_some();
    let mut seen = Vec::new();
    for p in files {
        let data = std::fs::read(&p).unwrap();
        let Ok(info) = nef::read_info(&data) else { continue };
        let k = key(&info);
        let (baked, linear) = (baked_hash(&data), linear_hash(&data));
        if print {
            println!("    (\"{k}\", {baked:#018x}, {linear:#018x}),");
            continue;
        }
        let Some(&(_, want_baked, want_linear)) = EXPECTED.iter().find(|e| e.0 == k) else {
            eprintln!("{}: {k} has no recorded hashes", p.display());
            continue;
        };
        assert_eq!(baked, want_baked, "{}: the baked NEF decode changed", p.display());
        assert_eq!(linear, want_linear, "{}: the linear NEF decode changed", p.display());
        seen.push(k);
    }
    for (k, _, _) in EXPECTED {
        if !seen.iter().any(|s| s == k) {
            eprintln!("{k}: no such file in {}: skipped", dir.display());
        }
    }
}
