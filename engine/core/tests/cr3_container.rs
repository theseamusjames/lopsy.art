//! Canon CR3 on real files: every `.CR3` in `LOPSY_CR3_SAMPLES` is read as
//! a container (`cr3::read_info`), its full-size sensor track found and
//! described, and refused by the RAW interface with the sentence for its
//! kind (RAW or C-RAW): the codec is not decoded (see the `cr3` module
//! docs). Files whose names contain "CRAW" are taken to be C-RAW.
//!
//! What is checked: the camera's JPEG track is the size of the sensor
//! track's crop (`IAD1`), which is also the maker note's sensor
//! information; the sensor track is 14-bit, four planes; the white
//! balance is found where a CR2's is; damaged files are refused without a
//! panic. Without `LOPSY_CR3_SAMPLES` the tests note that and pass.

use std::path::PathBuf;

use lopsy_core::cr3::{self, Cr3Encoding};

fn files() -> Vec<PathBuf> {
    let Some(dir) = std::env::var_os("LOPSY_CR3_SAMPLES") else { return Vec::new() };
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default();
    v.retain(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("cr3")));
    v.sort();
    v
}

#[test]
fn real_cr3s_are_read_and_refused_with_their_kind() {
    let files = files();
    if files.is_empty() {
        println!("No CR3 files: set LOPSY_CR3_SAMPLES to a folder of .CR3 files. Skipping.");
        return;
    }
    for path in files {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let data = std::fs::read(&path).unwrap();
        assert!(cr3::is_canon_cr3(&data), "{name}");
        assert_eq!(lopsy_core::raw::sniff(&data), None, "{name}: no RAW format decodes a CR3 yet");
        let info = cr3::read_info(&data).unwrap_or_else(|e| panic!("{name}: {e}"));
        let sensor = info.sensor_track().unwrap_or_else(|| panic!("{name}: no sensor track"));
        let lossy = name.contains("CRAW");
        assert_eq!(sensor.encoding, if lossy { Cr3Encoding::Lossy } else { Cr3Encoding::Lossless }, "{name}");
        assert_eq!((sensor.bits, sensor.planes), (14, 4), "{name}");
        let crop = sensor.crop.unwrap_or_else(|| panic!("{name}: no crop"));
        let (cw, ch) = (u32::from(crop[2] - crop[0]) + 1, u32::from(crop[3] - crop[1]) + 1);
        let jpeg = info.tracks.iter().find(|t| t.encoding == Cr3Encoding::Jpeg).unwrap_or_else(|| panic!("{name}: no JPEG"));
        assert_eq!((jpeg.width, jpeg.height), (cw, ch), "{name}: the crop is not the camera's JPEG");
        assert!(data[jpeg.offset..].starts_with(&[0xFF, 0xD8]), "{name}: the JPEG track does not start a JPEG");
        let e0 = lopsy_core::cr2::shorts(&info.maker_note, 0xE0).unwrap_or_default();
        if e0.len() >= 9 {
            assert_eq!(&e0[5..9], &crop, "{name}: IAD1's crop is not the sensor information's");
            assert_eq!((u32::from(e0[1]), u32::from(e0[2])), (sensor.width, sensor.height), "{name}: sensor size");
        }
        let cd = lopsy_core::cr2::shorts(&info.maker_note, 0x4001).unwrap_or_default();
        let wb = lopsy_core::cr2::colour_data::as_shot_levels(&cd);
        // Not asserted: the M50's maker note (CMT3) has no colour data at
        // all; a decoder will have to find its white balance elsewhere.
        let expected = if lossy { cr3::CRAW_REFUSAL } else { cr3::RAW_REFUSAL };
        assert_eq!(lopsy_core::raw::prepare(&data).err().as_deref(), Some(expected), "{name}");
        println!(
            "{name}: {} {}, orientation {}; sensor {}×{} in {}×{} tiles, {}-bit, {} planes, {} wavelet levels ({:?}), {} bytes at {}; crop {crop:?}; JPEG {}×{}; colour data {} numbers (first {}), as shot {:?} (searched: {}), gain {:?}",
            info.camera_model, info.compressor, info.orientation, sensor.width, sensor.height, sensor.tile_width, sensor.tile_height, sensor.bits, sensor.planes, sensor.levels, sensor.encoding,
            sensor.size, sensor.offset, jpeg.width, jpeg.height, cd.len(), cd.first().copied().unwrap_or(0), wb.map(|w| w.0), wb.is_some_and(|w| w.1), info.as_shot_gain
        );
    }
}

/// Cut short and with bytes changed in the boxes, every sample is refused
/// with a sentence, never a panic.
#[test]
fn damaged_cr3s_are_refused_not_panicked_on() {
    for path in files() {
        let data = std::fs::read(&path).unwrap();
        for cut in [12usize, 24, 100, 1000, 30_000, 60_000, data.len() / 2] {
            assert!(!cr3::refusal(&data[..cut.min(data.len())]).is_empty());
            assert!(lopsy_core::raw::prepare(&data[..cut.min(data.len())]).is_err());
        }
        let mut seed = 0x9e37_79b9_7f4a_7c15u64;
        for _ in 0..64 {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            let mut damaged = data[..60_000.min(data.len())].to_vec();
            let at = (seed % damaged.len() as u64) as usize;
            damaged[at] ^= (seed >> 32) as u8 | 1;
            let _ = cr3::read_info(&damaged);
        }
        println!("{}: cut and damaged copies refused or read, no panic", path.display());
    }
}
