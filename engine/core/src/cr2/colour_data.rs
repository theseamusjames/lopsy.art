//! The as-shot white balance in Canon's colour data (maker-note tag
//! 0x4001), worked out from the real files listed in `cr2`'s module notes.
//!
//! The colour data is an array of 16-bit numbers whose layout differs
//! between bodies. Every layout seen holds a run of white-balance entries
//! of five numbers each, red, green, green, blue levels and a colour
//! temperature in kelvin, the first of which is the white balance the
//! picture was taken with: on every sample, those levels make the neutral
//! surfaces of the camera's own JPEG neutral in the decode
//! (`tests/cr2_decode.rs`). Where the run starts:
//!
//! | layout (length, first number) | bodies seen | first entry |
//! |---|---|---|
//! | 582 numbers, no version | EOS 20D | 25 |
//! | version 3, 7, 10, 13 (692, 1337, 1312, 1592 numbers) | 40D, 7D, 5D Mark III, 5D Mark IV | 63 |
//! | version −3 (2560 numbers, stored as bytes) | PowerShot G16 | 71 |
//!
//! A layout not in the table is searched for the first two white-balance
//! entries in a row ([`find_run`]), which finds exactly the indices above
//! on every sample; the decode's debug log says when it searched.

/// Where the as-shot entry starts in a layout seen on a real file.
fn known_index(cd: &[u16]) -> Option<usize> {
    match (cd.len(), cd.first().copied()?) {
        (582, _) => Some(25),
        (692, 3) | (1337, 7) | (1312, 10) | (1592, 13) => Some(63),
        (2560, 0xFFFD) => Some(71),
        _ => None,
    }
}

/// Whether five numbers look like a white-balance entry: four positive
/// levels whose two greens agree within 1/64, and a temperature in kelvin.
fn is_entry(e: &[u16]) -> bool {
    let [r, g1, g2, b, k] = [e[0], e[1], e[2], e[3], e[4]].map(u32::from);
    let level = |v: u32| (64..=16_384).contains(&v);
    level(r) && level(g1) && level(g2) && level(b) && g1.abs_diff(g2) * 64 <= g1.max(g2) && (1500..=16_000).contains(&k)
}

/// The first index at which two white-balance entries follow each other.
pub fn find_run(cd: &[u16]) -> Option<usize> {
    (0..cd.len().saturating_sub(9)).find(|&i| is_entry(&cd[i..i + 5]) && is_entry(&cd[i + 5..i + 10]))
}

/// The as-shot red, green, green and blue levels, and whether they were
/// found by searching (an unseen layout) rather than at a known index.
pub fn as_shot_levels(cd: &[u16]) -> Option<([u16; 4], bool)> {
    let (i, searched) = match known_index(cd) {
        Some(i) => (i, false),
        None => (find_run(cd)?, true),
    };
    let e = cd.get(i..i + 5)?;
    is_entry(e).then(|| ([e[0], e[1], e[2], e[3]], searched))
}

/// The levels as channel gains, green 1.
pub fn gains(levels: [u16; 4]) -> [f32; 3] {
    let g = (f64::from(levels[1]) + f64::from(levels[2])) / 2.0;
    [(f64::from(levels[0]) / g) as f32, 1.0, (f64::from(levels[3]) / g) as f32]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_run_is_found_where_the_known_layouts_put_it() {
        // A made-up layout: noise, a lone entry-like group, then the run.
        let mut cd = vec![10u16, 819, 1024, 1024, 351, 569, 1024, 1024, 480, 397];
        cd.extend_from_slice(&[2000, 1024, 1024, 1500, 5200]);
        cd.extend_from_slice(&[0, 0, 0]);
        let at = cd.len();
        cd.extend_from_slice(&[1689, 1024, 1024, 2217, 3653, 1689, 1024, 1024, 2217, 3653, 7, 7]);
        assert_eq!(find_run(&cd), Some(at));
        assert_eq!(as_shot_levels(&cd), Some(([1689, 1024, 1024, 2217], true)));
        let g = gains([1689, 1024, 1024, 2217]);
        assert!((g[0] - 1.6494).abs() < 1e-3 && g[1] == 1.0 && (g[2] - 2.1650).abs() < 1e-3);
    }

    #[test]
    fn nothing_that_is_not_an_entry_is_taken() {
        assert_eq!(as_shot_levels(&[]), None);
        assert_eq!(as_shot_levels(&[0; 40]), None);
        // A known layout whose entry is damaged (greens disagree).
        let mut cd = vec![0u16; 692];
        cd[0] = 3;
        cd[63..68].copy_from_slice(&[1921, 1171, 600, 2241, 3603]);
        assert_eq!(as_shot_levels(&cd), None);
        cd[65] = 1171;
        assert_eq!(as_shot_levels(&cd), Some(([1921, 1171, 1171, 2241], false)));
    }
}
