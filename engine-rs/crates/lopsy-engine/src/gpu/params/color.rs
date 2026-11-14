use crate::gpu::uniforms::{uniforms, Mat3};

uniforms! {
    /// `color/color_convert.glsl`
    pub struct ColorConvertParams {
        pub color_matrix: Mat3,
    }
}

