use crate::gpu::uniforms::{uniforms, Mat2, Mat3};

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

uniforms! {
    /// `clipboard_copy.glsl`
    pub struct ClipboardCopyParams {
        pub has_mask: i32,
        pub extend_past_canvas: i32,
        pub layer_offset: [f32; 2],
        pub layer_size: [f32; 2],
        pub bounds_offset: [f32; 2],
        pub bounds_size: [f32; 2],
        pub doc_size: [f32; 2],
    }
}

uniforms! {
    /// `clipboard_clear.glsl`
    pub struct ClipboardClearParams {
        pub has_mask: i32,
        pub extend_past_canvas: i32,
        pub doc_size: [f32; 2],
        pub layer_offset: [f32; 2],
        pub layer_size: [f32; 2],
    }
}

uniforms! {
    /// `selection_fill.glsl`
    pub struct SelectionFillParams {
        pub has_mask: i32,
        pub fill_color: [f32; 4],
        pub doc_size: [f32; 2],
        pub layer_offset: [f32; 2],
        pub layer_size: [f32; 2],
    }
}

uniforms! {
    /// `content_bounds_reduce.glsl`
    pub struct ContentBoundsReduceParams {
        pub axis: [i32; 2],
        pub span: i32,
        pub src_size: [i32; 2],
        pub alpha_test: i32,
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

uniforms! {
    /// `transform_affine.glsl`
    pub struct TransformAffineParams {
        pub float_size: [f32; 2],
        pub float_offset: [f32; 2],
        pub layer_offset: [f32; 2],
        pub layer_size: [f32; 2],
        pub inv_matrix: Mat3,
        pub src_center: [f32; 2],
        pub dst_center: [f32; 2],
        pub src_rect: [f32; 4],
    }
}

uniforms! {
    /// `transform_perspective.glsl`
    pub struct TransformPerspectiveParams {
        pub float_size: [f32; 2],
        pub float_offset: [f32; 2],
        pub layer_offset: [f32; 2],
        pub layer_size: [f32; 2],
        pub orig_rect: [f32; 4],
        pub quad_to_square: Mat3,
    }
}
