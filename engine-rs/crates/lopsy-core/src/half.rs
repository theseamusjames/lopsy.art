//! IEEE 754 half-precision floats as bits. A backend whose textures are
//! `rgba16float` and whose uploads and readbacks are raw bytes converts
//! with these; WebGL does the same conversions inside the driver.

/// The half nearest to `value`, ties to even, as the driver's conversion
/// rounds. Out-of-range values become infinity and NaN stays NaN.
pub fn f32_to_f16(value: f32) -> u16 {
    let bits = value.to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let exponent = ((bits >> 23) & 0xff) as i32;
    let mantissa = bits & 0x007f_ffff;

    if exponent == 0xff {
        // Infinity, or NaN with its top mantissa bits kept (and made quiet).
        let nan = if mantissa != 0 { 0x0200 | (mantissa >> 13) as u16 } else { 0 };
        return sign | 0x7c00 | nan;
    }
    let unbiased = exponent - 127;
    if unbiased > 15 {
        return sign | 0x7c00;
    }
    if unbiased >= -14 {
        // Normal half: keep 10 mantissa bits and round on the 13 dropped.
        let half = (((unbiased + 15) as u32) << 10) | (mantissa >> 13);
        return sign | round_ties_even(half, mantissa & 0x1fff, 0x1000) as u16;
    }
    if unbiased >= -25 {
        // Subnormal half: the implicit one becomes an explicit bit.
        let full = mantissa | 0x0080_0000;
        let shift = (-unbiased - 14 + 13) as u32;
        let half = full >> shift;
        let dropped = full & ((1 << shift) - 1);
        return sign | round_ties_even(half, dropped, 1 << (shift - 1)) as u16;
    }
    sign
}

/// `kept` rounded up when the dropped bits are over half, or exactly half
/// with `kept` odd. A carry out of the mantissa lands in the exponent,
/// which is the right result for a half.
fn round_ties_even(kept: u32, dropped: u32, half: u32) -> u32 {
    if dropped > half || (dropped == half && kept & 1 == 1) {
        kept + 1
    } else {
        kept
    }
}

/// The value of a half, exactly.
pub fn f16_to_f32(half: u16) -> f32 {
    let sign = ((half & 0x8000) as u32) << 16;
    let exponent = ((half >> 10) & 0x1f) as u32;
    let mantissa = (half & 0x03ff) as u32;
    let bits = match (exponent, mantissa) {
        (0, 0) => 0,
        (0, _) => {
            // Subnormal: shift the leading one up into the implicit place.
            let shift = mantissa.leading_zeros() - 21;
            let mantissa = (mantissa << shift) & 0x03ff;
            ((113 - shift) << 23) | (mantissa << 13)
        }
        (0x1f, _) => 0x7f80_0000 | (mantissa << 13),
        _ => ((exponent + 112) << 23) | (mantissa << 13),
    };
    f32::from_bits(sign | bits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_values_convert_both_ways() {
        for (value, half) in [
            (0.0f32, 0x0000u16),
            (-0.0, 0x8000),
            (1.0, 0x3c00),
            (-2.0, 0xc000),
            (0.5, 0x3800),
            (65504.0, 0x7bff),
            (f32::INFINITY, 0x7c00),
            (f32::NEG_INFINITY, 0xfc00),
            (6.103_515_6e-5, 0x0400),
            (5.960_464_5e-8, 0x0001),
        ] {
            assert_eq!(f32_to_f16(value), half, "{value}");
            assert_eq!(f16_to_f32(half).to_bits(), value.to_bits(), "{half:#06x}");
        }
    }

    #[test]
    fn every_half_survives_a_round_trip() {
        for half in 0..=u16::MAX {
            let value = f16_to_f32(half);
            if value.is_nan() {
                assert!(f16_to_f32(f32_to_f16(value)).is_nan());
            } else {
                assert_eq!(f32_to_f16(value), half, "{half:#06x}");
            }
        }
    }

    #[test]
    fn rounding_is_to_nearest_with_ties_to_even() {
        // Halfway between 1.0 (even mantissa) and the next half up.
        let ulp = f32::powi(2.0, -10);
        assert_eq!(f32_to_f16(1.0 + ulp / 2.0), 0x3c00);
        assert_eq!(f32_to_f16(1.0 + ulp * 1.5), 0x3c02);
        assert_eq!(f32_to_f16(1.0 + ulp * 0.51), 0x3c01);
        // Rounding up out of the top mantissa carries into the exponent.
        assert_eq!(f32_to_f16(2.0 - ulp / 4.0), 0x4000);
        // Too large for a half.
        assert_eq!(f32_to_f16(65520.0), 0x7c00);
        // Below half the smallest subnormal.
        assert_eq!(f32_to_f16(1.0e-9), 0x0000);
    }

    #[test]
    fn eight_bit_values_read_back_as_they_were_written() {
        for byte in 0..=255u8 {
            let stored = f16_to_f32(f32_to_f16(byte as f32 / 255.0));
            assert_eq!((stored.clamp(0.0, 1.0) * 255.0 + 0.5) as u8, byte);
        }
    }
}
