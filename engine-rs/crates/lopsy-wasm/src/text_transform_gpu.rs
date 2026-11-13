//! Place an upright text raster into a layer texture through an affine
//! transform. The raster is always re-rendered from the text props, so the
//! transform is applied fresh each time and never compounds.

use lopsy_core::text_transform::{doc_to_raster_linear, transformed_raster_rect, DocRect, TextMatrix};
use crate::engine::EngineInner;
use crate::gpu::pass::{Blend, Target};
use crate::gpu::texture_pool::TextureHandle;

/// Upright glyph raster produced by the text renderer.
pub struct TextRaster<'a> {
    pub pixels: &'a [u8],
    pub width: u32,
    pub height: u32,
    /// Raster top-left relative to the anchor, in raster pixels.
    pub offset_x: i32,
    pub offset_y: i32,
    /// Raster pixels per layout pixel.
    pub scale: f64,
}

/// Resample `raster` through `m` at `anchor` into `layer_id`'s texture,
/// sized to the transformed bounds. Returns the texture's document rect.
pub fn render_text_raster_transformed(
    engine: &mut EngineInner,
    layer_id: &str,
    raster: &TextRaster,
    m: &TextMatrix,
    anchor: (f64, f64),
) -> Result<DocRect, String> {
    let rect = transformed_raster_rect(
        m, anchor, raster.scale, raster.width, raster.height,
        raster.offset_x as f64, raster.offset_y as f64,
    ).ok_or("Transformed text bounds are empty or too large")?;
    let inv = doc_to_raster_linear(m, raster.scale).ok_or("Text transform is not invertible")?;

    let src = engine.texture_pool.acquire(raster.width, raster.height)?;
    if let Err(e) = engine.texture_pool.upload_rgba(src, 0, 0, raster.width, raster.height, raster.pixels,
    ) {
        engine.texture_pool.delete(src);
        return Err(e);
    }
    if engine.texture_pool.get(src).is_none() {
        engine.texture_pool.delete(src);
        return Err("Text raster texture missing".to_string());
    }

    // transform_affine maps an output pixel at `doc` to source pixel
    // `srcCenter + invMatrix · (doc - dstCenter) - floatOffset`; with these
    // uniforms that is `scale · M⁻¹ · (doc - anchor) - offset`, the raster
    // pixel holding that layout point.
    let inv_matrix: [f32; 9] = [
        inv.a as f32, inv.b as f32, 0.0,
        inv.c as f32, inv.d as f32, 0.0,
        0.0, 0.0, 1.0,
    ];
    let src_center = (
        (rect.x - raster.offset_x) as f32,
        (rect.y - raster.offset_y) as f32,
    );

    let result = layer_texture_sized(engine, layer_id, rect.width, rect.height).and_then(|handle| {
        let is_drawn = engine
            .pass_untyped(&engine.shaders.transform_affine)
            .texture("u_floatTex", src)
            .vec2("u_floatSize", raster.width as f32, raster.height as f32)
            .vec2("u_layerOffset", rect.x as f32, rect.y as f32)
            .vec2("u_floatOffset", rect.x as f32, rect.y as f32)
            .vec2("u_layerSize", rect.width as f32, rect.height as f32)
            .vec2("u_srcCenter", src_center.0, src_center.1)
            .vec2("u_dstCenter", anchor.0 as f32, anchor.1 as f32)
            .mat3("u_invMatrix", &inv_matrix)
            // Uniforms persist per program: clear the float path's source rect.
            .vec4("u_srcRect", 0.0, 0.0, 0.0, 0.0)
            .blend(Blend::Off)
            .clear([0.0, 0.0, 0.0, 0.0])
            .draw(Target::Texture(handle));
        if !is_drawn {
            return Err("Layer texture missing".to_string());
        }
        engine.mark_layer_dirty(layer_id);
        Ok(())
    });

    // Raster sizes follow the text and the drag; don't pool one-off sizes.
    engine.texture_pool.delete(src);
    result.map(|_| rect)
}

/// The layer's texture at exactly `width × height`. A texture of another
/// size is deleted rather than returned to the pool: a transform drag
/// re-renders at a new size on nearly every step, and the pool never
/// reclaims sizes it won't see again (#1019).
fn layer_texture_sized(
    engine: &mut EngineInner,
    layer_id: &str,
    width: u32,
    height: u32,
) -> Result<TextureHandle, String> {
    if let Some(&current) = engine.layer_textures.get(layer_id) {
        if engine.texture_pool.get_size(current) == Some((width, height)) {
            return Ok(current);
        }
        engine.layer_textures.remove(layer_id);
        engine.texture_pool.delete(current);
    }
    let handle = engine.texture_pool.acquire(width, height)?;
    engine.layer_textures.insert(layer_id.to_string(), handle);
    Ok(handle)
}
