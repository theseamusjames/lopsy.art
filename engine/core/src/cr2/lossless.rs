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

use crate::dng::ljpeg::decode_lossless_jpeg_framed;

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
/// `frame` is the header `cr2::frame_header` read, which the checks
/// before decoding were made on: the decoder walks the stream's markers
/// its own way (restart markers and the end of image differ), so a stream
/// whose two readings disagree on the depth or the size is refused.
pub fn decode(strip: &[u8], frame: &super::FrameHeader, width: usize, height: usize, slices: &[u32]) -> Result<Vec<u16>, String> {
    let (stream, used) = decode_lossless_jpeg_framed(strip).map_err(|e| format!("This Canon RAW's data is damaged ({e})"))?;
    if used.precision != frame.precision || used.width != u32::from(frame.width) || used.height != u32::from(frame.height) || usize::from(used.components) != frame.sampling.len() {
        return Err("This Canon RAW's sensor data is damaged: it holds two different descriptions of its frame".into());
    }
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

    /// A made-up stream (not a camera's) with two frame headers: a restart
    /// marker whose two bytes after it the decoder takes for a length,
    /// skipping the first header, which the header reader takes byte by
    /// byte. The same number of samples, a different depth and shape.
    #[test]
    fn a_stream_read_two_ways_is_refused() {
        let first = [0xFF, 0xC3, 0, 11, 12, 0, 2, 0, 2, 1, 1, 0x11, 0];
        let second = [0xFF, 0xC3, 0, 11, 14, 0, 4, 0, 1, 1, 1, 0x11, 0];
        let mut dht = vec![0xFF, 0xC4, 0, 20, 0x00, 1];
        dht.extend_from_slice(&[0; 15]);
        dht.push(0);
        let sos = [0xFF, 0xDA, 0, 8, 1, 1, 0x00, 1, 0, 0];
        let mut s = vec![0xFF, 0xD8, 0xFF, 0xD0, 0, 15];
        s.extend_from_slice(&first);
        s.extend_from_slice(&second);
        s.extend_from_slice(&dht);
        s.extend_from_slice(&sos);
        s.push(0);
        let frame = super::super::frame_header(&s).unwrap();
        assert_eq!((frame.precision, frame.width, frame.height), (12, 2, 2));
        let e = decode(&s, &frame, 2, 2, &[2]).err().expect("refused");
        assert!(e.contains("two different"), "{e}");
        // The same stream with one header decodes.
        let mut one = vec![0xFF, 0xD8];
        one.extend_from_slice(&second);
        one.extend_from_slice(&dht);
        one.extend_from_slice(&sos);
        one.push(0);
        let frame = super::super::frame_header(&one).unwrap();
        assert_eq!(decode(&one, &frame, 1, 4, &[1]).unwrap().len(), 4);
    }
}
