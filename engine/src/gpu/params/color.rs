use crate::gpu::uniforms::{uniforms, Mat3};

uniforms! {
    /// `color/color_convert.wgsl`
    pub struct ColorConvertParams {
        pub color_matrix: Mat3,
    }
}

