//! `OpcodeList2` as far as the develop chain applies it: `MapPolynomial`
//! (opcode 8) over whole sample planes. The DNG specification (chapter 7,
//! "Opcode List Processing") applies `OpcodeList2` to the raw image "just
//! after it has been mapped to linear reference values", in the logical
//! range 0..1, clipping to that range after each opcode. A lossy JPEG DNG
//! needs it: its 8-bit samples are stored through a curve, and three
//! `MapPolynomial` opcodes, one a plane, map them back to linear (on the
//! Adobe DNG Converter samples, `0.0625·x + 0.9375·x³`, near enough).
//!
//! **What is read.** An opcode list is big-endian whatever the file's byte
//! order: a count, then for each opcode its ID, the DNG version it was
//! defined in, flags (bit 0: optional), and a parameter area of the length
//! it gives. `MapPolynomial`'s parameters are Top, Left, Bottom, Right,
//! Plane, Planes, RowPitch, ColPitch, Degree (LONG each) and Degree + 1
//! DOUBLE coefficients, constant term first; Degree is at most 8.
//!
//! **What is applied.** Only a list this reader can apply whole: every
//! opcode a `MapPolynomial` that covers the whole stored image at pitch 1
//! (the case the converter writes), or an optional opcode, which the
//! specification lets a reader skip. Anything else is refused with a
//! sentence and the caller decides: a lossless file leaves the list
//! unapplied, as before, and a lossy one is refused, since its samples are
//! not linear without it.

/// The most opcodes a list may hold here.
const MAX_OPCODES: u32 = 256;
/// The newest opcode version this reader was written to (DNG 1.7).
const NEWEST_VERSION: u32 = 0x0107_0000;
const MAP_POLYNOMIAL: u32 = 8;

/// A polynomial over some sample planes, coefficients constant term first.
#[derive(Clone, Debug, PartialEq)]
pub struct PlanePolynomial {
    pub plane: usize,
    pub planes: usize,
    pub coefficients: Vec<f64>,
}

/// The applicable part of an `OpcodeList2`: polynomials in list order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LinearMaps {
    pub polynomials: Vec<PlanePolynomial>,
}

fn be_u32(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}

fn be_f64(b: &[u8], at: usize) -> Option<f64> {
    b.get(at..at + 8).map(|s| f64::from_be_bytes(std::array::from_fn(|i| s[i])))
}

/// Read an `OpcodeList2` value for a stored image of `width` × `height`
/// with `samples` planes. An error is a sentence saying why the list
/// cannot be applied whole.
pub fn read_opcode_list2(raw: &[u8], width: u32, height: u32, samples: usize) -> Result<LinearMaps, String> {
    let short = || "the opcode list is shorter than it says".to_string();
    let count = be_u32(raw, 0).ok_or_else(short)?;
    if count > MAX_OPCODES {
        return Err(format!("the opcode list holds {count} opcodes, more than {MAX_OPCODES}"));
    }
    let mut at = 4usize;
    let mut maps = LinearMaps::default();
    for _ in 0..count {
        let (id, version, flags, len) = match (be_u32(raw, at), be_u32(raw, at + 4), be_u32(raw, at + 8), be_u32(raw, at + 12)) {
            (Some(a), Some(b), Some(c), Some(d)) => (a, b, c, d as usize),
            _ => return Err(short()),
        };
        let body = at.checked_add(16).and_then(|s| raw.get(s..s.checked_add(len)?)).ok_or_else(short)?;
        at += 16 + len;
        let optional = flags & 1 == 1;
        if id != MAP_POLYNOMIAL || version > NEWEST_VERSION {
            if optional {
                continue;
            }
            return Err(format!("opcode {id} (version {version:#x}) is required and not one this decoder applies"));
        }
        let long = |i: usize| be_u32(body, 4 * i).ok_or_else(short);
        let (top, left, bottom, right) = (long(0)?, long(1)?, long(2)?, long(3)?);
        let (plane, planes, row_pitch, col_pitch, degree) = (long(4)? as usize, long(5)? as usize, long(6)?, long(7)?, long(8)? as usize);
        if degree > 8 {
            return Err(format!("a MapPolynomial of degree {degree} (at most 8)"));
        }
        let coefficients: Vec<f64> = (0..=degree).map(|k| be_f64(body, 36 + 8 * k).ok_or_else(short)).collect::<Result<_, _>>()?;
        if !coefficients.iter().all(|c| c.is_finite()) {
            return Err("a MapPolynomial coefficient is not a number".into());
        }
        let whole = top == 0 && left == 0 && bottom >= height && right >= width && row_pitch == 1 && col_pitch == 1;
        let planes_ok = planes >= 1 && plane.checked_add(planes).is_some_and(|end| end <= samples);
        if !(whole && planes_ok) {
            if optional {
                continue;
            }
            return Err(format!(
                "a MapPolynomial over rows {top}..{bottom}, columns {left}..{right}, planes {plane}+{planes}, pitch {row_pitch}×{col_pitch}, not the whole {width}×{height} image"
            ));
        }
        maps.polynomials.push(PlanePolynomial { plane, planes, coefficients });
    }
    Ok(maps)
}

impl LinearMaps {
    pub fn is_empty(&self) -> bool {
        self.polynomials.is_empty()
    }

    /// A linear reference value of sample plane `plane` through every
    /// polynomial that covers it, in order, clipped to 0..1 after each.
    #[inline]
    pub fn apply(&self, plane: usize, mut x: f64) -> f64 {
        for p in &self.polynomials {
            if plane >= p.plane && plane < p.plane + p.planes {
                x = p.coefficients.iter().rev().fold(0.0, |acc, &c| acc * x + c).clamp(0.0, 1.0);
            }
        }
        x
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opcode(id: u32, flags: u32, params: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        for x in [id, 0x0103_0000, flags, params.len() as u32] {
            v.extend(x.to_be_bytes());
        }
        v.extend_from_slice(params);
        v
    }

    fn polynomial(area: [u32; 4], plane: u32, planes: u32, pitch: [u32; 2], coeffs: &[f64]) -> Vec<u8> {
        let mut v = Vec::new();
        for x in [area[0], area[1], area[2], area[3], plane, planes, pitch[0], pitch[1], coeffs.len() as u32 - 1] {
            v.extend(x.to_be_bytes());
        }
        for c in coeffs {
            v.extend(c.to_be_bytes());
        }
        v
    }

    fn list(ops: &[Vec<u8>]) -> Vec<u8> {
        let mut v = (ops.len() as u32).to_be_bytes().to_vec();
        for o in ops {
            v.extend_from_slice(o);
        }
        v
    }

    #[test]
    fn whole_image_polynomials_are_read_and_applied_per_plane() {
        let cube = [0.0, 0.0625, 0.0, 0.9375];
        let raw = list(&[
            opcode(8, 0, &polynomial([0, 0, 40, 60], 0, 1, [1, 1], &cube)),
            opcode(8, 0, &polynomial([0, 0, 40, 60], 1, 2, [1, 1], &[0.1, 0.5])),
        ]);
        let maps = read_opcode_list2(&raw, 60, 40, 3).unwrap();
        assert_eq!(maps.polynomials.len(), 2);
        assert_eq!(maps.apply(0, 1.0), 1.0);
        assert!((maps.apply(0, 0.5) - (0.03125 + 0.9375 * 0.125)).abs() < 1e-12);
        assert!((maps.apply(2, 0.5) - 0.35).abs() < 1e-12);
        // Clipped to 0..1 after each.
        let big = read_opcode_list2(&list(&[opcode(8, 0, &polynomial([0, 0, 40, 60], 0, 3, [1, 1], &[0.5, 2.0]))]), 60, 40, 3).unwrap();
        assert_eq!(big.apply(1, 0.6), 1.0);
    }

    #[test]
    fn what_cannot_be_applied_whole_is_refused_and_optional_opcodes_are_skipped() {
        let poly = |area: [u32; 4], plane, planes, pitch| polynomial(area, plane, planes, pitch, &[0.0, 1.0]);
        assert!(read_opcode_list2(&list(&[opcode(9, 0, &[0; 8])]), 10, 10, 3).unwrap_err().contains("opcode 9"));
        assert!(read_opcode_list2(&list(&[opcode(9, 1, &[0; 8])]), 10, 10, 3).unwrap().is_empty());
        assert!(read_opcode_list2(&list(&[opcode(8, 0, &poly([0, 0, 5, 10], 0, 1, [1, 1]))]), 10, 10, 3).is_err(), "part of the image");
        assert!(read_opcode_list2(&list(&[opcode(8, 0, &poly([0, 0, 10, 10], 0, 1, [2, 1]))]), 10, 10, 3).is_err(), "pitch");
        assert!(read_opcode_list2(&list(&[opcode(8, 0, &poly([0, 0, 10, 10], 2, 2, [1, 1]))]), 10, 10, 3).is_err(), "planes");
        assert!(read_opcode_list2(&list(&[opcode(8, 0, &polynomial([0, 0, 10, 10], 0, 1, [1, 1], &[0.0; 10]))]), 10, 10, 3).unwrap_err().contains("degree"));
        assert!(read_opcode_list2(&list(&[opcode(8, 0, &polynomial([0, 0, 10, 10], 0, 1, [1, 1], &[f64::NAN, 1.0]))]), 10, 10, 3).is_err());
        assert!(read_opcode_list2(&u32::MAX.to_be_bytes(), 10, 10, 3).is_err());
        // Every truncation is refused, never a panic.
        let good = list(&[opcode(8, 0, &poly([0, 0, 10, 10], 0, 3, [1, 1]))]);
        assert!(read_opcode_list2(&good, 10, 10, 3).is_ok());
        for cut in 0..good.len() {
            assert!(read_opcode_list2(&good[..cut], 10, 10, 3).is_err(), "cut at {cut}");
        }
    }
}
