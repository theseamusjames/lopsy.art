use crate::gpu::uniforms::uniforms;

uniforms! {
    /// `shape/shape_fill.glsl`
    pub struct ShapeFillParams {
        pub shape_type: i32,
        pub center: [f32; 2],
        pub size: [f32; 2],
        pub fill_color: [f32; 4],
        pub stroke_color: [f32; 4],
        pub stroke_width: f32,
        pub corner_radius: f32,
        pub sides: i32,
        pub tex_size: [f32; 2],
    }
}

uniforms! {
    /// `shape/flood_fill_apply.glsl`
    pub struct FloodFillApplyParams {
        pub fill_color: [f32; 4],
    }
}

uniforms! {
    /// `shape/bucket_fill_color_match.glsl`
    pub struct BucketFillColorMatchParams {
        pub has_sel_mask: i32,
        pub sample_uv: [f32; 2],
        pub fill_color: [f32; 4],
        pub tolerance: f32,
    }
}
