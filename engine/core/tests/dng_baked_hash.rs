//! Both DNG decodes must not move when code they share with another format
//! changes: each real sample's baked decode (`dng::read_dng`) and prepared
//! linear plane (`dng::linear::prepare_dng`, with its parameters) are
//! hashed and compared with the hashes recorded at commit 682471f19,
//! before the Sony ARW decoder came to share them.
//!
//! Needs `LOPSY_DNG_SAMPLES` (a folder holding `sample_dng_00.dng` and
//! `sample_dng_01.dng`); without it the test notes that and passes. Slow in
//! a debug build: run with `--release`. `LOPSY_DNG_HASH_PRINT=1` prints the
//! hashes of every `.dng` in the folder.

use std::path::PathBuf;

/// FNV-1a 64 over the bytes given.
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
    let img = lopsy_core::dng::read_dng(data).unwrap();
    let mut h = Fnv::new();
    h.eat(&img.width.to_le_bytes());
    h.eat(&img.height.to_le_bytes());
    h.floats(&img.pixels);
    h.eat(&img.baseline_exposure.to_bits().to_le_bytes());
    for (x, y) in &img.tone_curve {
        h.eat(&x.to_bits().to_le_bytes());
        h.eat(&y.to_bits().to_le_bytes());
    }
    h.0
}

fn linear_hash(data: &[u8], apply_gain_table_map: bool) -> u64 {
    let options = lopsy_core::dng::linear::PrepareOptions { apply_gain_table_map };
    let prep = lopsy_core::dng::linear::prepare_dng_with(data, options).unwrap();
    let mut h = Fnv::new();
    h.eat(serde_json::to_string(&prep.params).unwrap().as_bytes());
    h.floats(&prep.plane);
    for what in &prep.unhandled {
        h.eat(what.as_bytes());
    }
    h.0
}

/// (file, baked decode, linear plane and parameters without the gain map,
/// with it) at commit 682471f19. The linear hashes were re-recorded when
/// DNG began to open with the Standard curve: only the wording of the
/// ProfileToneCurve note in the not-applied list changed ("the Standard
/// curve is used instead"); the plane and parameters hashed the same with
/// the old wording. The plane without the map is the one before
/// `ProfileGainTableMap` was applied (`PrepareOptions`), and hashes as it
/// did; the last column is the plane with the map applied, its clip levels
/// and its shorter not-applied list, recorded when the map was.
const EXPECTED: [(&str, u64, u64, u64); 2] = [
    ("sample_dng_00.dng", 0x3e370f9742a8521a, 0x362fbac48dda4a8f, 0xb1052bf9624db47c),
    ("sample_dng_01.dng", 0x9bc594c8f822e0b5, 0xf8319c3b76fb6480, 0x5faa34803409f07f),
];

#[test]
fn dng_decodes_are_unchanged_on_every_sample() {
    let Some(dir) = std::env::var_os("LOPSY_DNG_SAMPLES").map(PathBuf::from) else {
        eprintln!("LOPSY_DNG_SAMPLES is not set: skipping the DNG decode hashes");
        return;
    };
    if std::env::var_os("LOPSY_DNG_HASH_PRINT").is_some() {
        let mut files: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("dng"))).collect();
        files.sort();
        for p in files {
            let data = std::fs::read(&p).unwrap();
            println!("(\"{}\", {:#018x}, {:#018x}, {:#018x}),", p.file_name().unwrap().to_string_lossy(), baked_hash(&data), linear_hash(&data, false), linear_hash(&data, true));
        }
    }
    let mut seen = 0;
    for (name, baked, linear, mapped) in EXPECTED {
        let Ok(data) = std::fs::read(dir.join(name)) else {
            eprintln!("{name} is not in {}: skipped", dir.display());
            continue;
        };
        let (b, l, m) = (baked_hash(&data), linear_hash(&data, false), linear_hash(&data, true));
        eprintln!("{name}: baked {b:#018x}, linear {l:#018x}, with the gain map {m:#018x}");
        assert_eq!(b, baked, "{name}: the baked DNG decode changed");
        assert_eq!(l, linear, "{name}: the linear DNG plane or its parameters changed");
        assert_eq!(m, mapped, "{name}: the linear DNG plane with its gain map, or its parameters, changed");
        seen += 1;
    }
    eprintln!("{seen} DNG files hashed");
}
