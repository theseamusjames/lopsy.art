use crate::gpu::uniforms::{uniforms, Mat2};

uniforms! {
    /// `blit_region.glsl`
    pub struct BlitRegionParams {
        pub scale: [f32; 2],
        pub offset: [f32; 2],
    }
}

uniforms! {
    /// `flip.glsl`
    pub struct FlipParams {
        pub flip_h: i32,
        pub flip_v: i32,
    }
}

uniforms! {
    /// `rotate90.glsl`
    pub struct Rotate90Params {
        pub clockwise: i32,
    }
}

uniforms! {
    /// `mask_remap.glsl`
    pub struct MaskRemapParams {
        pub dst_size: [f32; 2],
        pub src_size: [f32; 2],
        pub linear: Mat2,
        pub offset: [f32; 2],
    }
}

uniforms! {
    /// `quick_mask_translate.glsl`
    pub struct QuickMaskTranslateParams {
        pub offset: [i32; 2],
    }
}

uniforms! {
    /// `thumbnail_box.glsl`
    pub struct ThumbnailBoxParams {
        pub dst_size: [f32; 2],
        pub channel: i32,
    }
}
