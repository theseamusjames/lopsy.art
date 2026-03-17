use lopsy_core::color::{self, ColorSpace};

pub fn convert_color_space(
    data: &[u8],
    width: u32,
    height: u32,
    from_space: u32,
    to_space: u32,
) -> Vec<u8> {
    let from = space_from_u32(from_space);
    let to = space_from_u32(to_space);

    if from == to {
        return data.to_vec();
    }

    let total = (width * height) as usize;
    let mut result = data.to_vec();

    let matrix = get_conversion_matrix(from, to);

    for i in 0..total {
        let base = i * 4;
        if base + 3 >= result.len() { break; }

        let r = result[base] as f32 / 255.0;
        let g = result[base + 1] as f32 / 255.0;
        let b = result[base + 2] as f32 / 255.0;

        let (or, og, ob) = color::apply_matrix3(&matrix, r, g, b);

        result[base] = (or.clamp(0.0, 1.0) * 255.0) as u8;
        result[base + 1] = (og.clamp(0.0, 1.0) * 255.0) as u8;
        result[base + 2] = (ob.clamp(0.0, 1.0) * 255.0) as u8;
    }

    result
}

fn space_from_u32(v: u32) -> ColorSpace {
    match v {
        1 => ColorSpace::DisplayP3,
        2 => ColorSpace::Rec2020,
        3 => ColorSpace::LinearSrgb,
        _ => ColorSpace::Srgb,
    }
}

fn get_conversion_matrix(from: ColorSpace, to: ColorSpace) -> [f32; 9] {
    match (from, to) {
        (ColorSpace::Srgb, ColorSpace::DisplayP3) => color::SRGB_TO_P3_MATRIX,
        (ColorSpace::DisplayP3, ColorSpace::Srgb) => color::P3_TO_SRGB_MATRIX,
        _ => {
            // Identity
            [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
        }
    }
}
