//! CR2 files must decode as recorded: each sample's baked decode and
//! prepared linear plane (with its parameters and develop defaults) are
//! hashed and compared with recorded hashes (see `EXPECTED`), so any change
//! to a Canon decode shows.
//!
//! Needs `LOPSY_CR2_SAMPLES` (files from raw.pixls.us, CC0, named as below);
//! without it the test notes that and passes. Slow in a debug build: run
//! with `--release`. `LOPSY_CR2_HASH_PRINT=1` prints the hashes of every
//! full-size `.CR2` in the folder.

use std::path::PathBuf;

use lopsy_core::cr2;

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

fn baked_hash(data: &[u8]) -> u64 {
    let img = cr2::read_cr2(data).unwrap();
    let mut h = Fnv::new();
    h.eat(&img.image.width.to_le_bytes());
    h.eat(&img.image.height.to_le_bytes());
    h.floats(&img.image.pixels);
    h.eat(format!("{:?} {}", img.colour, img.camera_model).as_bytes());
    h.0
}

fn linear_hash(data: &[u8]) -> u64 {
    let prep = cr2::linear::prepare_cr2(data).unwrap();
    let mut h = Fnv::new();
    h.floats(&prep.plane);
    let d = cr2::linear::develop_defaults(&prep.params);
    h.floats(&d.cam_to_rgb);
    h.floats(&d.wb_ratio);
    h.floats(&prep.params.as_shot_gain);
    h.eat(&prep.params.cfa);
    h.eat(&prep.params.white_level.to_le_bytes());
    h.eat(&prep.params.width.to_le_bytes());
    h.eat(&prep.params.height.to_le_bytes());
    h.0
}

/// (file, baked decode, linear plane and defaults), recorded when the CR2
/// decoder was added; the 5D Mark III's and 5D Mark IV's again when those
/// bodies took a matrix of the engine's own.
const EXPECTED: [(&str, u64, u64); 7] = [
    ("EOS-20D_RAW.CR2", 0x83011e5be747bcff, 0xc84ac2fd34b289cc),
    ("EOS-40D_RAW.CR2", 0x8800fd339d3e0d97, 0xb29f82057675438f),
    ("EOS-5D-Mark-III_RAW.CR2", 0x1c8848de92084fe4, 0xda20adf62973c90f),
    ("EOS-5D-Mark-IV_RAW-B.CR2", 0xf7e3585dc1c15fff, 0xe05ac79784cafa11),
    ("EOS-5D-Mark-IV_RAW.CR2", 0x37d96d4c5811b5fc, 0x7dc70e46a8c82011),
    ("EOS-7D_RAW.CR2", 0x5d535eaa3c0cbd4b, 0x6aaa180b4950e49a),
    ("PowerShot-G16_RAW.CR2", 0x9de1d3317955ef08, 0xc78651e6bbf5a658),
];

#[test]
fn cr2s_decode_as_recorded() {
    let Some(dir) = std::env::var_os("LOPSY_CR2_SAMPLES").map(PathBuf::from) else {
        eprintln!("LOPSY_CR2_SAMPLES is not set: skipping the CR2 decode hashes");
        return;
    };
    if std::env::var_os("LOPSY_CR2_HASH_PRINT").is_some() {
        let mut files: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("cr2"))).collect();
        files.sort();
        for p in files {
            let data = std::fs::read(&p).unwrap();
            if cr2::read_info(&data).is_err() {
                continue;
            }
            println!("(\"{}\", {:#018x}, {:#018x}),", p.file_name().unwrap().to_string_lossy(), baked_hash(&data), linear_hash(&data));
        }
    }
    for (name, baked, linear) in EXPECTED {
        let Ok(data) = std::fs::read(dir.join(name)) else {
            eprintln!("{name} is not in {}: skipped", dir.display());
            continue;
        };
        assert_eq!(baked_hash(&data), baked, "{name}: the baked CR2 decode changed");
        assert_eq!(linear_hash(&data), linear, "{name}: the linear CR2 decode changed");
    }
}
