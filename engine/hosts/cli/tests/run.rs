//! The `lopsy` binary, run on real files on this machine's GPU. On a
//! machine with no GPU adapter the binary says so and the tests skip.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use lopsy_core::decode::{decode_png, DecodedPixels};

const RED: [u8; 4] = [255, 0, 0, 255];
const GREEN: [u8; 4] = [0, 255, 0, 255];
const BLUE: [u8; 4] = [0, 0, 255, 255];
const WHITE: [u8; 4] = [255, 255, 255, 255];

/// A fresh directory for one test, under cargo's own temporary directory.
fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_png(path: &Path, width: u32, height: u32, texels: &[[u8; 4]]) {
    let mut encoder = png::Encoder::new(fs::File::create(path).unwrap(), width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header().unwrap().write_image_data(texels.as_flattened()).unwrap();
}

fn read_png(path: &Path) -> Vec<[u8; 4]> {
    let image = decode_png(&fs::read(path).unwrap()).expect("a PNG");
    let DecodedPixels::Rgba8(bytes) = image.pixels else { panic!("8-bit output expected") };
    bytes.chunks_exact(4).map(|t| [t[0], t[1], t[2], t[3]]).collect()
}

/// Run `lopsy` with `args`. `None` where there is no GPU to run it on.
fn lopsy(args: &[&str]) -> Option<std::process::Output> {
    let output = Command::new(env!("CARGO_BIN_EXE_lopsy")).args(args).output().expect("lopsy runs");
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() && stderr.contains("GPU adapter") {
        eprintln!("skipped: no GPU for the command-line host ({})", stderr.trim());
        return None;
    }
    Some(output)
}

#[test]
fn operations_run_in_order_on_every_input() {
    let dir = scratch("operations");
    let out = dir.join("out");
    // 2 x 2: red, green over blue, white.
    write_png(&dir.join("a.png"), 2, 2, &[RED, GREEN, BLUE, WHITE]);
    write_png(&dir.join("b.png"), 2, 1, &[BLUE, WHITE]);

    let Some(output) = lopsy(&[
        "--op", "flip-h", "--op", "invert", "--out", out.to_str().unwrap(),
        dir.join("a.png").to_str().unwrap(), dir.join("b.png").to_str().unwrap(),
    ]) else { return };
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));

    // Mirrored, then inverted: green and red swap places and become
    // magenta and cyan; white and blue become black and yellow.
    assert_eq!(read_png(&out.join("a.png")), [[255, 0, 255, 255], [0, 255, 255, 255], [0, 0, 0, 255], [255, 255, 0, 255]]);
    assert_eq!(read_png(&out.join("b.png")), [[0, 0, 0, 255], [255, 255, 0, 255]]);
}

#[test]
fn an_image_with_no_operations_comes_back_as_it_went_in() {
    let dir = scratch("unchanged");
    let out = dir.join("out");
    let texels = [RED, [10, 20, 30, 255], [0, 0, 0, 0], WHITE, GREEN, BLUE];
    write_png(&dir.join("a.png"), 3, 2, &texels);

    let Some(output) = lopsy(&["--out", out.to_str().unwrap(), dir.join("a.png").to_str().unwrap()]) else { return };
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    assert_eq!(read_png(&out.join("a.png")), texels);
}

#[test]
fn a_file_that_is_not_a_png_fails_and_names_it() {
    let dir = scratch("not-a-png");
    fs::write(dir.join("notes.png"), b"not an image").unwrap();

    let Some(output) = lopsy(&["--out", dir.join("out").to_str().unwrap(), dir.join("notes.png").to_str().unwrap()]) else { return };
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("notes.png"));
}
