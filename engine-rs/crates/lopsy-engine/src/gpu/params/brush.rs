use crate::gpu::uniforms::{uniforms, Mat2};

uniforms! {
    /// `brush/eraser_dab.glsl`
    pub struct EraserDabParams {
        pub opacity: f32,
        pub center: [f32; 2],
        pub size: f32,
        pub tex_size: [f32; 2],
        pub has_selection: i32,
        pub doc_size: [f32; 2],
        pub layer_offset: [f32; 2],
    }
}

uniforms! {
    /// `brush/pencil_dab.glsl`
    pub struct PencilDabParams {
        pub color: [f32; 4],
        pub center: [f32; 2],
        pub size: f32,
        pub tex_size: [f32; 2],
        pub has_selection: i32,
        pub doc_size: [f32; 2],
        pub layer_offset: [f32; 2],
    }
}

uniforms! {
    /// `brush/quick_mask_dab.glsl`
    pub struct QuickMaskDabParams {
        pub size: f32,
        pub hardness: f32,
        pub opacity: f32,
        pub center: [f32; 2],
        pub tex_size: [f32; 2],
        pub mode: i32,
    }
}

uniforms! {
    /// `brush/dodge_burn.glsl` and `brush/sponge.glsl`: apply a stroke's coverage to the layer.
    pub struct CoverageApplyParams {
        pub mode: i32,
        pub exposure: f32,
    }
}

uniforms! {
    /// `brush/dodge_burn_dab.glsl`
    pub struct DodgeBurnDabParams {
        pub center: [f32; 2],
        pub size: f32,
        pub hardness: f32,
        pub tex_size: [f32; 2],
        pub exposure: f32,
        pub has_selection: i32,
        pub doc_size: [f32; 2],
        pub layer_offset: [f32; 2],
    }
}

uniforms! {
    /// `brush/smudge_dab.glsl`
    pub struct SmudgeDabParams {
        pub center: [f32; 2],
        pub prev: [f32; 2],
        pub size: f32,
        pub strength: f32,
        pub tex_size: [f32; 2],
    }
}

uniforms! {
    /// `brush/clone_stamp.glsl`
    pub struct CloneStampParams {
        pub source_offset: [f32; 2],
        pub center: [f32; 2],
        pub size: f32,
        pub tex_size: [f32; 2],
    }
}

uniforms! {
    /// `brush/healing_dab.glsl`
    pub struct HealingDabParams {
        pub center: [f32; 2],
        pub size: f32,
        pub tex_size: [f32; 2],
        pub source_offset: [f32; 2],
        pub opacity: f32,
    }
}

uniforms! {
    /// `brush/healing_mean.glsl`
    pub struct HealingMeanParams {
        pub src_center: [f32; 2],
        pub dst_center: [f32; 2],
        pub radius: f32,
        pub tex_size: [f32; 2],
    }
}

uniforms! {
    /// `brush/stamp_preview.glsl`
    pub struct StampPreviewParams {
        pub resolution: [f32; 2],
        pub zoom: f32,
        pub pan: [f32; 2],
        pub doc_size: [f32; 2],
        pub cursor: [f32; 2],
        pub source: [f32; 2],
        pub radius: f32,
        pub layer_origin: [f32; 2],
        pub layer_size: [f32; 2],
        pub opacity: f32,
    }
}

uniforms! {
    /// `brush/brush_dab_header.glsl`, shared by the circle, alpha and colour dab shaders.
    pub struct BrushDabParams {
        pub brush_color: [f32; 4],
        pub opacity: f32,
        pub flow: f32,
        pub hardness: f32,
        pub center: [f32; 2],
        pub size: f32,
        pub tex_size: [f32; 2],
        pub has_selection: i32,
        pub doc_size: [f32; 2],
        pub layer_offset: [f32; 2],
        pub angle: f32,
        pub dab_transform: Mat2,
        pub tip_aspect: [f32; 2],
        pub size_jitter: f32,
        pub angle_jitter: f32,
        pub opacity_jitter: f32,
        pub has_brush_texture: i32,
        pub texture_scale: f32,
        pub texture_blend_mode: i32,
        pub brush_texture_size: [f32; 2],
        pub stroke_origin: [f32; 2],
        pub texture_rotation: f32,
    }
}
