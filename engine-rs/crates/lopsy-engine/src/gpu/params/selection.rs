use crate::gpu::uniforms::uniforms;

uniforms! {
    /// `selection/marching_ants.glsl`
    pub struct MarchingAntsParams {
        pub time: f32,
        pub tex_size: [f32; 2],
    }
}
