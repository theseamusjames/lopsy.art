use crate::gpu::uniforms::{uniforms, FloatArray, Vec4Array};

uniforms! {
    /// `gradient/gradient_linear.glsl`
    pub struct GradientLinearParams {
        pub has_mask: i32,
        pub start: [f32; 2],
        pub end: [f32; 2],
        pub stops: Vec4Array<16>,
        pub stop_positions: FloatArray<16>,
        pub stop_count: i32,
        pub tex_size: [f32; 2],
        pub doc_size: [f32; 2],
        pub layer_offset: [f32; 2],
    }
}

uniforms! {
    /// `gradient/gradient_radial.glsl`
    pub struct GradientRadialParams {
        pub has_mask: i32,
        pub center: [f32; 2],
        pub radius: f32,
        pub stops: Vec4Array<16>,
        pub stop_positions: FloatArray<16>,
        pub stop_count: i32,
        pub tex_size: [f32; 2],
        pub doc_size: [f32; 2],
        pub layer_offset: [f32; 2],
    }
}
