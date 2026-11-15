use crate::gpu::uniforms::{uniforms, Vec4Array};

uniforms! {
    /// `gradient/gradient_linear.wgsl`
    pub struct GradientLinearParams {
        pub has_mask: i32,
        pub start: [f32; 2],
        pub end: [f32; 2],
        pub stops: Vec4Array<16>,
        /// 16 positions, four to a vector.
        pub stop_positions: Vec4Array<4>,
        pub stop_count: i32,
        pub tex_size: [f32; 2],
        pub doc_size: [f32; 2],
        pub layer_offset: [f32; 2],
    }
}

uniforms! {
    /// `gradient/gradient_radial.wgsl`
    pub struct GradientRadialParams {
        pub has_mask: i32,
        pub center: [f32; 2],
        pub radius: f32,
        pub stops: Vec4Array<16>,
        /// 16 positions, four to a vector.
        pub stop_positions: Vec4Array<4>,
        pub stop_count: i32,
        pub tex_size: [f32; 2],
        pub doc_size: [f32; 2],
        pub layer_offset: [f32; 2],
    }
}
