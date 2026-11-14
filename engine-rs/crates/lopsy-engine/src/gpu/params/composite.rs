use crate::gpu::uniforms::uniforms;

uniforms! {
    /// `composite.glsl`
    pub struct CompositeParams {
        pub opacity: f32,
    }
}

uniforms! {
    /// `final_blit.glsl`
    pub struct FinalBlitParams {
        pub resolution: [f32; 2],
        pub zoom: f32,
        pub pan: [f32; 2],
        pub doc_size: [f32; 2],
        pub bg_alpha: f32,
        pub seamless_enabled: f32,
        pub seamless_dim: f32,
        pub channel_mask: [f32; 4],
        pub doc_color_mode: i32,
    }
}

uniforms! {
    /// `blend.glsl`, every blend-mode variant.
    pub struct BlendParams {
        pub opacity: f32,
        pub src_offset: [f32; 2],
        pub src_size: [f32; 2],
        pub doc_size: [f32; 2],
        pub src_premultiplied: i32,
        pub wrap_layer: i32,
        pub overlay_enabled: i32,
        pub overlay_color: [f32; 3],
        pub overlay_opacity: f32,
        pub has_mask: i32,
        pub mask_size: [f32; 2],
        pub mask_offset: [f32; 2],
        pub mask_overlay: i32,
        pub doc_color_mode: i32,
        pub has_backdrop: i32,
    }
}

impl BlendParams {
    /// A straight-alpha source over the destination, with the colour
    /// overlay, mask, mask-edit tint, wrap and backdrop all off.
    pub fn plain(opacity: f32, src_offset: [f32; 2], src_size: [f32; 2], doc_size: [f32; 2], doc_color_mode: u32) -> Self {
        Self {
            opacity,
            src_offset,
            src_size,
            doc_size,
            src_premultiplied: 0,
            wrap_layer: 0,
            overlay_enabled: 0,
            overlay_color: [0.0; 3],
            overlay_opacity: 0.0,
            has_mask: 0,
            mask_size: [0.0; 2],
            mask_offset: [0.0; 2],
            mask_overlay: 0,
            doc_color_mode: doc_color_mode as i32,
            has_backdrop: 0,
        }
    }
}
