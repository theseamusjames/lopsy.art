//! Lopsy's baked RAF decode (`read_raf`: `render_rgb`, the clamp and the
//! orientation) must not change when the linear path does. Each sample
//! file's decoded pixels are hashed and compared with a recorded hash
//! (see `EXPECTED` for when they were last recorded, and why).
//! `LOPSY_BAKED_HASH_PRINT=1` prints the hashes of every `.RAF` in the
//! folder.
//!
//! Needs `LOPSY_RAF_SAMPLES` (a clone of `theseamusjames/sample-raf-images`);
//! without it the test notes that and passes. Slow in a debug build: run
//! with `--release`.

use std::path::PathBuf;

/// FNV-1a 64 over the bit patterns of the decoded floats, with the size.
fn hash_pixels(width: u32, height: u32, pixels: &[f32]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut eat = |bytes: &[u8]| {
        for &b in bytes {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    };
    eat(&width.to_le_bytes());
    eat(&height.to_le_bytes());
    for v in pixels {
        eat(&v.to_bits().to_le_bytes());
    }
    h
}

/// The hashes of `read_raf`, recorded when the sensor's matrix in
/// `lopsy_core::camera_colour` replaced the earlier one: every sample is an
/// X-E5 or an X100VI, so every one moved. Before that they were those of
/// commit 837f69227.
const EXPECTED: [(&str, u64); 8] = [
    ("DSCF6952.RAF", 0x5a76f6f0cca38219),
    ("DSCF7795.RAF", 0x48bf8f6bcb731307),
    ("DSCF7863.RAF", 0xb191601eaa693cd0),
    ("DSCF7912.RAF", 0x21e12200ba388a46),
    ("DSCF8005.RAF", 0xfb09feaedc81d22d),
    ("DSCF8078.RAF", 0x1c9924a39b0b1c75),
    ("DSCF8169.RAF", 0xaf2e446c4be0fd7a),
    ("DSCF8267.RAF", 0xd304bb40e1264dba),
];

#[test]
fn baked_decode_is_unchanged_on_every_sample() {
    let Some(dir) = std::env::var_os("LOPSY_RAF_SAMPLES").map(PathBuf::from) else {
        eprintln!("LOPSY_RAF_SAMPLES is not set: skipping the baked-decode hashes");
        return;
    };
    // Printed first, so a decode changed on purpose can be recorded.
    if std::env::var_os("LOPSY_BAKED_HASH_PRINT").is_some() {
        for entry in std::fs::read_dir(&dir).unwrap().flatten() {
            let p = entry.path();
            if p.extension().is_some_and(|e| e.eq_ignore_ascii_case("raf")) {
                let img = lopsy_core::raf::read_raf(&std::fs::read(&p).unwrap()).unwrap();
                println!("(\"{}\", {:#018x}),", p.file_name().unwrap().to_string_lossy(), hash_pixels(img.width, img.height, &img.pixels));
            }
        }
    }
    let mut seen = 0;
    for (name, expected) in EXPECTED {
        let path = dir.join(name);
        let Ok(data) = std::fs::read(&path) else {
            eprintln!("{name} is not in {}: skipped", dir.display());
            continue;
        };
        let img = lopsy_core::raf::read_raf(&data).unwrap();
        let got = hash_pixels(img.width, img.height, &img.pixels);
        eprintln!("{name}: {got:#018x}");
        assert_eq!(got, expected, "{name}: the baked decode changed");
        seen += 1;
    }
    eprintln!("{seen} sample files hashed");
}
