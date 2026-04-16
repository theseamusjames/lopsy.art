/// Encode a single scanline using Apple PackBits compression.
///
/// PackBits rules:
/// - Flag byte n as i8:
///   - 0..=127: copy next (n+1) literal bytes
///   - -1..=-127 (129..=255 as u8): repeat next byte (1-n) times
///   - -128 (128 as u8): no-op
pub fn packbits_encode(data: &[u8]) -> Vec<u8> {
    if data.is_empty() {
        return Vec::new();
    }

    let mut out = Vec::with_capacity(data.len() + data.len() / 128 + 1);
    let len = data.len();
    let mut i = 0;

    while i < len {
        // Count run length
        let mut run = 1;
        while i + run < len && run < 128 && data[i + run] == data[i] {
            run += 1;
        }

        if run >= 3 || (run == 2 && (i + run >= len || data[i + run] != data[i])) {
            // Emit a run: flag = 1-run as i8 (e.g. run=128 -> flag=-127 -> 0x81)
            out.push((1i16 - run as i16) as u8);
            out.push(data[i]);
            i += run;
        } else {
            // Collect literals
            let start = i;
            let mut lit_len = 0;

            while i + lit_len < len && lit_len < 128 {
                // Check if a run of 3+ starts here
                let remaining = len - (i + lit_len);
                if remaining >= 3
                    && data[i + lit_len] == data[i + lit_len + 1]
                    && data[i + lit_len] == data[i + lit_len + 2]
                {
                    break;
                }
                lit_len += 1;
            }

            if lit_len == 0 {
                lit_len = 1;
            }

            out.push((lit_len - 1) as u8);
            out.extend_from_slice(&data[start..start + lit_len]);
            i += lit_len;
        }
    }

    out
}

/// Decode PackBits-compressed data into the original bytes.
pub fn packbits_decode(data: &[u8], expected_len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(expected_len);
    let mut pos = 0;

    while pos < data.len() && out.len() < expected_len {
        let flag = data[pos] as i8;
        pos += 1;

        if flag >= 0 {
            // Literal run: copy (flag+1) bytes
            let count = flag as usize + 1;
            let end = (pos + count).min(data.len());
            out.extend_from_slice(&data[pos..end]);
            pos = end;
        } else if flag == -128 {
            // No-op
        } else {
            // Repeated byte: repeat (1-flag) times
            let count = (1 - flag as i16) as usize;
            if pos < data.len() {
                let byte = data[pos];
                pos += 1;
                for _ in 0..count {
                    out.push(byte);
                }
            }
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_empty() {
        let encoded = packbits_encode(&[]);
        assert!(encoded.is_empty());
        let decoded = packbits_decode(&encoded, 0);
        assert!(decoded.is_empty());
    }

    #[test]
    fn roundtrip_single_byte() {
        let data = vec![42];
        let encoded = packbits_encode(&data);
        let decoded = packbits_decode(&encoded, data.len());
        assert_eq!(decoded, data);
    }

    #[test]
    fn roundtrip_constant_run() {
        let data = vec![0xAA; 200];
        let encoded = packbits_encode(&data);
        // Should compress well: 200 identical bytes
        assert!(encoded.len() < data.len() / 10);
        let decoded = packbits_decode(&encoded, data.len());
        assert_eq!(decoded, data);
    }

    #[test]
    fn roundtrip_alternating() {
        let data: Vec<u8> = (0..200).map(|i| if i % 2 == 0 { 0xAA } else { 0x55 }).collect();
        let encoded = packbits_encode(&data);
        let decoded = packbits_decode(&encoded, data.len());
        assert_eq!(decoded, data);
    }

    #[test]
    fn roundtrip_mixed() {
        let mut data = Vec::new();
        // Run of 50 identical
        data.extend_from_slice(&vec![0xFF; 50]);
        // 20 unique bytes
        for i in 0..20u8 {
            data.push(i * 10);
        }
        // Run of 80 identical
        data.extend_from_slice(&vec![0x42; 80]);
        // 5 unique
        data.extend_from_slice(&[1, 2, 3, 4, 5]);

        let encoded = packbits_encode(&data);
        let decoded = packbits_decode(&encoded, data.len());
        assert_eq!(decoded, data);
    }

    #[test]
    fn roundtrip_max_run() {
        let data = vec![0xBB; 128];
        let encoded = packbits_encode(&data);
        // Single run: flag + byte = 2 bytes
        assert_eq!(encoded.len(), 2);
        let decoded = packbits_decode(&encoded, data.len());
        assert_eq!(decoded, data);
    }

    #[test]
    fn roundtrip_over_max_run() {
        let data = vec![0xCC; 300];
        let encoded = packbits_encode(&data);
        let decoded = packbits_decode(&encoded, data.len());
        assert_eq!(decoded, data);
    }

    #[test]
    fn roundtrip_gradient() {
        // Simulates a gradient scanline — each byte is unique
        let data: Vec<u8> = (0..=255).collect();
        let encoded = packbits_encode(&data);
        let decoded = packbits_decode(&encoded, data.len());
        assert_eq!(decoded, data);
    }

    #[test]
    fn run_of_two_at_end() {
        // Edge case: run of 2 identical bytes at the very end
        let data = vec![1, 2, 3, 0xAA, 0xAA];
        let encoded = packbits_encode(&data);
        let decoded = packbits_decode(&encoded, data.len());
        assert_eq!(decoded, data);
    }
}
