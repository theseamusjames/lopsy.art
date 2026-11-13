use crate::gpu::uniforms::uniforms;

uniforms! {
    /// `effects/glow.glsl`
    pub struct GlowParams {
        pub has_orig_tex: i32,
        pub glow_color: [f32; 4],
        pub size: f32,
        pub spread: f32,
        pub opacity: f32,
        pub texel_size: [f32; 2],
        pub src_offset: [f32; 2],
        pub src_size: [f32; 2],
        pub doc_size: [f32; 2],
        pub mode: i32,
        pub raw_alpha: i32,
        pub orig_offset: [f32; 2],
        pub orig_size: [f32; 2],
    }
}

uniforms! {
    /// `effects/shadow.glsl`
    pub struct ShadowParams {
        pub shadow_color: [f32; 4],
        pub offset: [f32; 2],
        pub spread: f32,
        pub opacity: f32,
        pub texel_size: [f32; 2],
        pub src_offset: [f32; 2],
        pub src_size: [f32; 2],
        pub doc_size: [f32; 2],
        pub knockout: i32,
        pub layer_opacity: f32,
        pub raw_alpha: i32,
    }
}

uniforms! {
    /// `effects/separable_edt.glsl`
    pub struct SeparableEdtParams {
        pub pass: i32,
        pub radius: i32,
        pub reach_sq: f32,
        pub oob_seed: i32,
    }
}

uniforms! {
    /// `effects/stroke_apply.glsl`
    pub struct StrokeApplyParams {
        pub stroke_color: [f32; 4],
        pub opacity: f32,
        pub position: i32,
        pub orig_offset: [f32; 2],
        pub orig_size: [f32; 2],
        pub doc_size: [f32; 2],
        pub silhouette: i32,
        pub knockout: i32,
        pub layer_opacity: f32,
    }
}

uniforms! {
    /// `effects/color_overlay.glsl`
    pub struct ColorOverlayParams {
        pub overlay_color: [f32; 4],
        pub opacity: f32,
    }
}

uniforms! {
    /// `effects/layer_mask_apply.glsl`
    pub struct LayerMaskApplyParams {
        pub layer_offset: [f32; 2],
        pub layer_size: [f32; 2],
        pub mask_offset: [f32; 2],
        pub mask_size: [f32; 2],
    }
}
