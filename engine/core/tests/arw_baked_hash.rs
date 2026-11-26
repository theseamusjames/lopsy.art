//! ARW files from bodies without measured colour data must decode exactly
//! as before the per-camera colour table: each one's baked decode and
//! prepared linear plane (with its parameters and develop defaults) are
//! hashed and compared with recorded hashes (see `EXPECTED`).
//!
//! Needs `LOPSY_ARW_SAMPLES`; without it the test notes that and passes.
//! Slow in a debug build: run with `--release`. `LOPSY_ARW_HASH_PRINT=1`
//! prints the hashes of every `.ARW` in the folder.

use std::path::PathBuf;

use lopsy_core::arw;

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
    let img = arw::read_arw(data).unwrap();
    let mut h = Fnv::new();
    h.eat(&img.image.width.to_le_bytes());
    h.eat(&img.image.height.to_le_bytes());
    h.floats(&img.image.pixels);
    h.eat(format!("{:?} {}", img.colour, img.camera_model).as_bytes());
    h.0
}

fn linear_hash(data: &[u8]) -> u64 {
    let prep = arw::linear::prepare_arw(data).unwrap();
    let mut h = Fnv::new();
    h.floats(&prep.plane);
    let d = arw::linear::develop_defaults(&prep.params);
    h.floats(&d.cam_to_rgb);
    h.floats(&d.wb_ratio);
    h.floats(&prep.params.as_shot_gain);
    h.eat(&prep.params.width.to_le_bytes());
    h.eat(&prep.params.height.to_le_bytes());
    h.0
}

/// (file, baked decode, linear plane and defaults). The linear hashes are
/// those of commit f69556963; the baked ones were re-recorded on purpose
/// when the baked decode came to match the camera's preview exposure.
const EXPECTED: [(&str, u64, u64); 2] = [
    ("DSC-RX100M3_DSC00734.ARW", 0x3d9c13851f1278b8, 0x96bae85696e4dd5c),
    ("ILCE-6000_DSC01542.ARW", 0x97d76256e9440edd, 0xad262ad041aec277),
];

#[test]
fn arws_without_colour_data_are_unchanged() {
    let Some(dir) = std::env::var_os("LOPSY_ARW_SAMPLES").map(PathBuf::from) else {
        eprintln!("LOPSY_ARW_SAMPLES is not set: skipping the ARW decode hashes");
        return;
    };
    if std::env::var_os("LOPSY_ARW_HASH_PRINT").is_some() {
        let mut files: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("arw"))).collect();
        files.sort();
        for p in files {
            let data = std::fs::read(&p).unwrap();
            println!("(\"{}\", {:#018x}, {:#018x}),", p.file_name().unwrap().to_string_lossy(), baked_hash(&data), linear_hash(&data));
        }
    }
    for (name, baked, linear) in EXPECTED {
        let Ok(data) = std::fs::read(dir.join(name)) else {
            eprintln!("{name} is not in {}: skipped", dir.display());
            continue;
        };
        assert_eq!(baked_hash(&data), baked, "{name}: the baked ARW decode changed");
        assert_eq!(linear_hash(&data), linear, "{name}: the linear ARW decode changed");
    }
}
