use crate::gpu::uniforms::{uniforms, Mat2, Mat3};

uniforms! {
    /// `blit_region.wgsl`
    pub struct BlitRegionParams {
        pub scale: [f32; 2],
        pub offset: [f32; 2],
    }
}

uniforms! {
    /// `flip.wgsl`
    pub struct FlipParams {
        pub flip_h: i32,
        pub flip_v: i32,
    }
}

uniforms! {
    /// `rotate90.wgsl`
    pub struct Rotate90Params {
        pub clockwise: i32,
    }
}

uniforms! {
    /// `mask_remap.wgsl`
    pub struct MaskRemapParams {
        pub dst_size: [f32; 2],
        pub src_size: [f32; 2],
        pub linear: Mat2,
        pub offset: [f32; 2],
    }
}

uniforms! {
    /// `quick_mask_translate.wgsl`
    pub struct QuickMaskTranslateParams {
        pub offset: [i32; 2],
    }
}

uniforms! {
    /// `thumbnail_box.wgsl`
    pub struct ThumbnailBoxParams {
        pub dst_size: [f32; 2],
        pub channel: i32,
    }
}

uniforms! {
    /// `clipboard_copy.wgsl`
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
    /// `clipboard_clear.wgsl`
    pub struct ClipboardClearParams {
        pub has_mask: i32,
        pub extend_past_canvas: i32,
        pub doc_size: [f32; 2],
        pub layer_offset: [f32; 2],
        pub layer_size: [f32; 2],
    }
}

uniforms! {
    /// `selection_fill.wgsl`
    pub struct SelectionFillParams {
        pub has_mask: i32,
        pub fill_color: [f32; 4],
        pub doc_size: [f32; 2],
        pub layer_offset: [f32; 2],
        pub layer_size: [f32; 2],
    }
}

uniforms! {
    /// `frame_fill.wgsl`
    pub struct FrameFillParams {
        pub color: [f32; 4],
        pub outer_rect: [f32; 4],
        pub hole_rect: [f32; 4],
        pub outer_radius: f32,
        pub inner_radius: f32,
        pub has_hole: i32,
    }
}

uniforms! {
    /// `content_bounds_reduce.wgsl`
    pub struct ContentBoundsReduceParams {
        pub axis: [i32; 2],
        pub span: i32,
        pub src_size: [i32; 2],
        pub alpha_test: i32,
    }
}

uniforms! {
    /// `transform_affine.wgsl`
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
    /// `transform_perspective.wgsl`
    pub struct TransformPerspectiveParams {
        pub float_size: [f32; 2],
        pub float_offset: [f32; 2],
        pub layer_offset: [f32; 2],
        pub layer_size: [f32; 2],
        pub orig_rect: [f32; 4],
        pub quad_to_square: Mat3,
    }
}
