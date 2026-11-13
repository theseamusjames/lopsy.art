use crate::gpu::uniforms::uniforms;

uniforms! {
    /// `filters/posterize.glsl`
    pub struct PosterizeParams {
        pub levels: f32,
    }
}

uniforms! {
    /// `filters/threshold.glsl`
    pub struct ThresholdParams {
        pub level: f32,
    }
}
