//! The raw data of a CR2: one lossless JPEG (ITU-T T.81 process 14, `SOF3`)
//! decoded by `dng::ljpeg`, whose samples, in the order the stream gives
//! them, fill the sensor in vertical slices.
//!
//! The slice layout is the raw IFD's tag 0xC640, three numbers: how many
//! slices of the first width there are, that width, and the width of the
//! one last slice, all in sensor columns. The stream fills the first slice
//! row by row from the top of the sensor to the bottom, then the next
//! slice, and so on; the slices sit side by side left to right. Without
//! the tag, or with a count of 0, the stream is the sensor row by row.
//!
//! How the stream's frame is shaped (two or four components, a frame row
//! holding one sensor row or two) does not matter to this placement: only
//! the order of the samples does. This was worked out on the real files
//! listed in `cr2`'s module notes: with the slices placed this way the
//! mosaic has the colour filter's 2×2 structure everywhere and its edges
//! line up with the camera's JPEG, and slice edges are no rougher than
//! their insides (`tests/cr2_decode.rs`).

use crate::dng::ljpeg::decode_lossless_jpeg;

/// The widths of the slices, left to right, for a sensor `width` columns
/// wide: from the slice tag's (count, width, last width), or one slice of
/// the whole width. An error when the slices do not add up to the width.
pub fn slice_widths(tag: Option<&[u16]>, width: u32) -> Result<Vec<u32>, String> {
    match tag {
        Some(&[count, w, last]) if count > 0 => {
            let (count, w, last) = (u32::from(count), u32::from(w), u32::from(last));
            if w == 0 || last == 0 || count.checked_mul(w).and_then(|n| n.checked_add(last)) != Some(width) {
                return Err(format!("This Canon RAW's slices ({count} × {w} + {last}) do not make up its {width}-column sensor"));
            }
            let mut v = vec![w; count as usize];
            v.push(last);
            Ok(v)
        }
        _ => Ok(vec![width]),
    }
}

/// Place the stream's samples, in decode order, on a `width` × `height`
/// sensor in slices of `slices` widths (which add up to `width`). One slice
/// is the stream as it is, given back without a copy.
pub fn unslice(stream: Vec<u16>, width: usize, height: usize, slices: &[u32]) -> Result<Vec<u16>, String> {
    let total = width.checked_mul(height).ok_or("This Canon RAW's sensor size overflows")?;
    if stream.len() != total || slices.iter().map(|&s| s as usize).sum::<usize>() != width {
        return Err(format!("This Canon RAW's data holds {} samples, not the {total} of its {width}×{height} sensor", stream.len()));
    }
    if slices.len() == 1 {
        return Ok(stream);
    }
    let mut out: Vec<u16> = Vec::new();
    out.try_reserve_exact(total).map_err(|_| "not enough memory for the Canon RAW's pixels".to_string())?;
    out.resize(total, 0);
    let mut k = 0usize;
    let mut x0 = 0usize;
    for &sw in slices {
        let sw = sw as usize;
        for row in 0..height {
            let dst = row * width + x0;
            out[dst..dst + sw].copy_from_slice(&stream[k..k + sw]);
            k += sw;
        }
        x0 += sw;
    }
    Ok(out)
}

/// Decode the raw strip to the sensor mosaic, `width` × `height` values.
pub fn decode(strip: &[u8], width: usize, height: usize, slices: &[u32]) -> Result<Vec<u16>, String> {
    let stream = decode_lossless_jpeg(strip).map_err(|e| format!("This Canon RAW's data is damaged ({e})"))?;
    unslice(stream, width, height, slices)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slices_must_make_up_the_sensor() {
        assert_eq!(slice_widths(Some(&[1, 2960, 2960]), 5920).unwrap(), vec![2960, 2960]);
        assert_eq!(slice_widths(Some(&[2, 1728, 1904]), 5360).unwrap(), vec![1728, 1728, 1904]);
        // No tag, or a count of 0 (the G16's [0, 0, 4176]): the sensor row by row.
        assert_eq!(slice_widths(None, 4192).unwrap(), vec![4192]);
        assert_eq!(slice_widths(Some(&[0, 0, 4176]), 4192).unwrap(), vec![4192]);
        assert!(slice_widths(Some(&[1, 2960, 2959]), 5920).is_err());
        assert!(slice_widths(Some(&[65535, 65535, 65535]), 5920).is_err());
        assert!(slice_widths(Some(&[3, 0, 5920]), 5920).is_err());
    }

    #[test]
    fn each_slice_is_filled_top_to_bottom_before_the_next() {
        // A 5×2 sensor in slices of 2, 2 and 1 columns: the stream holds
        // slice 0's rows, then slice 1's, then slice 2's.
        let stream: Vec<u16> = (0..10).collect();
        let out = unslice(stream.clone(), 5, 2, &[2, 2, 1]).unwrap();
        assert_eq!(out, vec![0, 1, 4, 5, 8, 2, 3, 6, 7, 9]);
        assert!(unslice(stream[..9].to_vec(), 5, 2, &[2, 2, 1]).is_err());
        assert!(unslice(stream.clone(), 5, 2, &[2, 2]).is_err());
        assert_eq!(unslice(stream.clone(), 5, 2, &[5]).unwrap(), stream);
    }

    #[test]
    fn one_slice_is_the_stream_itself_not_a_copy() {
        let stream: Vec<u16> = (0..10).collect();
        let at = stream.as_ptr();
        let out = unslice(stream, 5, 2, &[5]).unwrap();
        assert_eq!(out.as_ptr(), at);
    }
}
