use crate::gpu::uniforms::uniforms;

uniforms! {
    /// `text/text_glyph.glsl`
    pub struct TextGlyphParams {
        pub color: [f32; 4],
        pub tex_size: [f32; 2],
        pub glyph_pos: [f32; 2],
        pub glyph_size: [f32; 2],
        pub glyph_uv: [f32; 4],
    }
}
