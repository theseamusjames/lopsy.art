//! Sharpness & noise and local contrast & haze on the composite: the GPU
//! side of `lopsy_core::detail`, whose module notes give the maths, the
//! stage placement and its deviations from spec 6.10.
//!
//! Each stage reads the composite, makes the blurred copies it needs in
//! pooled textures, combines them into scratch A and copies that back
//! texel for texel. Large blurs (σ above `PYRAMID_SIGMA` working pixels)
//! box-downscale by `ceil(σ / 2)` with `thumbnail_box.wgsl`, blur the small
//! image by the remaining σ and are read back bilinearly, so their cost
//! does not grow with the radius. Every stage is `None` by default; then
//! nothing runs and the composite is byte-identical.

use lopsy_core::detail::{self, DetailSettings, LocalContrastSettings};

use crate::engine::EngineInner;
use crate::gpu::params::core::ThumbnailBoxParams;
use crate::gpu::params::develop::{BlurAxisParams, DetailSharpenParams, LocalContrastParams, NoiseReduceParams};
use crate::gpu::pass::{Blend, Target};
use crate::gpu::texture_pool::TextureHandle;

fn log_error(what: &str, e: &str) {
    crate::host::log(crate::host::LogLevel::Error, &format!("{what}: {e}"));
}

/// One separable blur pass of `src` into `dst` (`w`×`h`).
fn blur_pass(engine: &EngineInner, src: TextureHandle, dst: TextureHandle, w: u32, h: u32, horizontal: bool, sigma: f32) -> Result<(), String> {
    let program = engine.shaders.blur_axis()?;
    let dir = if horizontal { [1.0, 0.0] } else { [0.0, 1.0] };
    let drawn = engine
        .pass(&program, BlurAxisParams { dir, sigma })
        .texture("u_tex", src)
        .blend(Blend::Off)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(dst));
    engine.gpu().unbind_textures(1);
    if drawn { Ok(()) } else { Err("blur pass did not draw".to_string()) }
}

/// A Gaussian of σ (working pixels) of `src`, `w`×`h`: full-size, or
/// downscaled when σ is above `PYRAMID_SIGMA`. The caller releases the
/// returned texture.
fn blur(engine: &mut EngineInner, src: TextureHandle, w: u32, h: u32, sigma: f32) -> Result<TextureHandle, String> {
    if sigma <= detail::PYRAMID_SIGMA {
        let a = engine.texture_pool.acquire(w, h)?;
        let b = match engine.texture_pool.acquire(w, h) {
            Ok(b) => b,
            Err(e) => {
                engine.texture_pool.release(a);
                return Err(e);
            }
        };
        let result = blur_pass(engine, src, a, w, h, true, sigma).and_then(|_| blur_pass(engine, a, b, w, h, false, sigma));
        engine.texture_pool.release(a);
        return match result {
            Ok(()) => Ok(b),
            Err(e) => {
                engine.texture_pool.release(b);
                Err(e)
            }
        };
    }
    let factor = (sigma / 2.0).ceil().max(2.0) as u32;
    let (lw, lh) = (w.div_ceil(factor).max(1), h.div_ceil(factor).max(1));
    let a = engine.texture_pool.acquire(lw, lh)?;
    let b = match engine.texture_pool.acquire(lw, lh) {
        Ok(b) => b,
        Err(e) => {
            engine.texture_pool.release(a);
            return Err(e);
        }
    };
    let drawn = engine
        .pass(&engine.shaders.thumbnail_box, ThumbnailBoxParams { dst_size: [lw as f32, lh as f32], channel: crate::document::thumbnail_gpu::COLOUR })
        .texture("u_tex", src)
        .blend(Blend::Off)
        .viewport(0, 0, lw as i32, lh as i32)
        .draw(Target::Texture(a));
    engine.gpu().unbind_textures(1);
    let low_sigma = sigma / factor as f32;
    let result = if drawn { Ok(()) } else { Err("downscale did not draw".to_string()) }
        .and_then(|_| blur_pass(engine, a, b, lw, lh, true, low_sigma))
        .and_then(|_| blur_pass(engine, b, a, lw, lh, false, low_sigma));
    engine.texture_pool.release(b);
    match result {
        Ok(()) => Ok(a),
        Err(e) => {
            engine.texture_pool.release(a);
            Err(e)
        }
    }
}

/// Copy scratch A over the composite, texel for texel.
fn scratch_to_composite(engine: &EngineInner) {
    engine
        .pass(&engine.shaders.copy_exact, ())
        .texture("u_tex", engine.scratch_texture_a)
        .blend(Blend::Off)
        .viewport(0, 0, engine.doc_width as i32, engine.doc_height as i32)
        .draw(Target::Framebuffer(engine.composite_fbo));
    engine.gpu().unbind_textures(1);
}

/// Noise reduction on the composite, when the document's detail settings
/// reduce noise.
pub fn apply_noise_reduction(engine: &mut EngineInner) {
    let Some(s) = engine.detail.filter(DetailSettings::reduces_noise) else { return };
    if let Err(e) = noise_reduction(engine, &s) {
        log_error("Noise reduction", &e);
    }
}

fn noise_reduction(engine: &mut EngineInner, s: &DetailSettings) -> Result<(), String> {
    let program = engine.shaders.noise_reduce()?;
    let (w, h) = (engine.doc_width, engine.doc_height);
    let chroma = blur(engine, engine.composite_texture, w, h, detail::NR_CHROMA_SIGMA * s.pixel_scale)?;
    let params = NoiseReduceParams {
        luminance: s.nr_luminance / 100.0,
        color: s.nr_color / 100.0,
        range_sigma: detail::nr_range_sigma(s),
    };
    let drawn = engine
        .pass(&program, params)
        .texture("u_tex", engine.composite_texture)
        .texture("u_chroma", chroma)
        .blend(Blend::Off)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));
    engine.gpu().unbind_textures(2);
    engine.texture_pool.release(chroma);
    if drawn {
        scratch_to_composite(engine);
    }
    Ok(())
}

/// Sharpening on the composite, when the document's detail settings sharpen.
pub fn apply_sharpening(engine: &mut EngineInner) {
    let Some(s) = engine.detail.filter(DetailSettings::sharpens) else { return };
    if let Err(e) = sharpening(engine, &s, false) {
        log_error("Sharpening", &e);
    }
}

/// The live frame's sharpening: as `apply_sharpening`, or, while
/// `engine.detail_mask_view` is on and detail settings are set, the
/// sharpening edge mask as grey (white where it sharpens fully) in place of
/// the image. Exports call `apply_sharpening` and never show the mask.
pub fn apply_sharpening_live(engine: &mut EngineInner) {
    if !engine.detail_mask_view {
        apply_sharpening(engine);
        return;
    }
    let Some(s) = engine.detail else { return };
    if let Err(e) = sharpening(engine, &s, true) {
        log_error("Sharpening mask", &e);
    }
}

fn sharpening(engine: &mut EngineInner, s: &DetailSettings, mask_view: bool) -> Result<(), String> {
    let program = engine.shaders.detail_sharpen()?;
    let (w, h) = (engine.doc_width, engine.doc_height);
    // σ is at most 3 full-resolution pixels, so never a pyramid.
    let blurred = blur(engine, engine.composite_texture, w, h, s.sharpen_sigma().min(detail::PYRAMID_SIGMA))?;
    let drawn = engine
        .pass(&program, DetailSharpenParams { amount: s.amount / 100.0, edges: s.edges, mask_view: i32::from(mask_view) })
        .texture("u_tex", engine.composite_texture)
        .texture("u_blurred", blurred)
        .blend(Blend::Off)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));
    engine.gpu().unbind_textures(2);
    engine.texture_pool.release(blurred);
    if drawn {
        scratch_to_composite(engine);
    }
    Ok(())
}

/// Haze and local contrast on the composite, when set and not all zero.
pub fn apply_local_contrast(engine: &mut EngineInner) {
    let Some(s) = engine.local_contrast.filter(LocalContrastSettings::is_active) else { return };
    if let Err(e) = local_contrast(engine, &s) {
        log_error("Local contrast", &e);
    }
}

fn local_contrast(engine: &mut EngineInner, s: &LocalContrastSettings) -> Result<(), String> {
    let program = engine.shaders.local_contrast()?;
    let (w, h) = (engine.doc_width, engine.doc_height);
    let small = blur(engine, engine.composite_texture, w, h, detail::LC_SMALL_SIGMA * s.pixel_scale)?;
    let large = match blur(engine, engine.composite_texture, w, h, detail::LC_LARGE_SIGMA * s.pixel_scale) {
        Ok(l) => l,
        Err(e) => {
            engine.texture_pool.release(small);
            return Err(e);
        }
    };
    let drawn = engine
        .pass(&program, LocalContrastParams { large_amount: s.large, small_amount: s.small, haze_amount: s.haze })
        .texture("u_tex", engine.composite_texture)
        .texture("u_small", small)
        .texture("u_large", large)
        .blend(Blend::Off)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));
    engine.gpu().unbind_textures(3);
    engine.texture_pool.release(small);
    engine.texture_pool.release(large);
    if drawn {
        scratch_to_composite(engine);
    }
    Ok(())
}
