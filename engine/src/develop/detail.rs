//! Sharpness & noise and local contrast & haze on the composite: the GPU
//! side of `lopsy_core::detail`, whose module notes give the maths, the
//! stage placement and its deviations from spec 6.10, and, with the working
//! space, of `lopsy_core::linear_detail` (large and small details on
//! rendered linear data, haze on scene data).
//!
//! Each stage reads the composite, makes the blurred copies it needs in
//! pooled textures, combines them into scratch A and copies that back
//! texel for texel. Large blurs (σ above `PYRAMID_SIGMA` working pixels)
//! box-downscale by `ceil(σ / 2)` with `thumbnail_box.wgsl`, blur the small
//! image by the remaining σ and are read back bilinearly, so their cost
//! does not grow with the radius. Every stage is `None` by default; then
//! nothing runs and the composite is byte-identical.

use lopsy_core::detail::{self, DetailSettings, LocalContrastSettings, NoiseRun};
use lopsy_core::geometry::Rect;
use lopsy_core::tile;
use lopsy_core::linear_detail::{self, Statistic};
use lopsy_core::working_space::{luma, Gamut};

use crate::engine::EngineInner;
use crate::gpu::params::core::ThumbnailBoxParams;
use crate::gpu::params::develop::{
    BlurAxisParams, DetailSharpenParams, HazeParams, LocalContrastLogParams, LocalContrastParams, LuminanceStatsParams,
    NoiseReduceParams,
};
use crate::gpu::pass::{Blend, Target};
use crate::gpu::texture_pool::TextureHandle;

fn log_error(what: &str, e: &str) {
    crate::host::log(crate::host::LogLevel::Error, &format!("{what}: {e}"));
}

/// One separable blur pass of `src` into `dst`, drawing `rect` of it.
fn blur_pass(engine: &EngineInner, src: TextureHandle, dst: TextureHandle, rect: Rect, horizontal: bool, sigma: f32) -> Result<(), String> {
    let program = engine.shaders.blur_axis()?;
    let dir = if horizontal { [1.0, 0.0] } else { [0.0, 1.0] };
    let drawn = engine
        .pass(&program, BlurAxisParams { dir, sigma })
        .texture("u_tex", src)
        .blend(Blend::Off)
        .viewport(rect.x, rect.y, rect.width as i32, rect.height as i32)
        .draw(Target::Texture(dst));
    engine.gpu().unbind_textures(1);
    if drawn { Ok(()) } else { Err("blur pass did not draw".to_string()) }
}

/// A blurred copy of an image, and how a combining shader reads it: the
/// `grid` its `blurUv` takes (`include/region.wgsl`).
struct Blurred {
    texture: TextureHandle,
    grid: [f32; 4],
}

/// A Gaussian of σ (working pixels) of `src`, `w`×`h`: full-size, or
/// downscaled when σ is above `PYRAMID_SIGMA`. The caller releases the
/// returned texture.
///
/// With a document region (a tile of a larger picture), a downscaled blur
/// is on the whole picture's grid (`lopsy_core::tile`): its smaller image
/// is as large as the whole's, cleared, and only the texels the tile meets
/// are drawn (`tile::low_rect`), box-downscaled from the tile at their
/// place in the whole, then blurred. The combining shader reads it at the
/// whole render's own coordinate, so the sampler sees the texture and the
/// coordinate the whole render gives it. A full-size blur needs nothing:
/// the apron covers its reach.
fn blur(engine: &mut EngineInner, src: TextureHandle, w: u32, h: u32, sigma: f32) -> Result<Blurred, String> {
    if sigma <= detail::PYRAMID_SIGMA {
        let a = engine.texture_pool.acquire(w, h)?;
        let b = match engine.texture_pool.acquire(w, h) {
            Ok(b) => b,
            Err(e) => {
                engine.texture_pool.release(a);
                return Err(e);
            }
        };
        let rect = Rect::new(0, 0, w, h);
        let result = blur_pass(engine, src, a, rect, true, sigma).and_then(|_| blur_pass(engine, a, b, rect, false, sigma));
        engine.texture_pool.release(a);
        return match result {
            Ok(()) => Ok(Blurred { texture: b, grid: tile::NO_REGION }),
            Err(e) => {
                engine.texture_pool.release(b);
                Err(e)
            }
        };
    }
    let factor = detail::pyramid_factor(sigma);
    let region = engine.document_region;
    let (lw, lh, rect) = match region {
        None => {
            let (lw, lh) = (detail::pyramid_size(w, factor), detail::pyramid_size(h, factor));
            (lw, lh, Rect::new(0, 0, lw, lh))
        }
        Some(r) => {
            let (lw, lh) = (detail::pyramid_size(r.whole_width, factor), detail::pyramid_size(r.whole_height, factor));
            (lw, lh, tile::low_rect(&r, w, h, lw, lh))
        }
    };
    let a = engine.texture_pool.acquire(lw, lh)?;
    let b = match engine.texture_pool.acquire(lw, lh) {
        Ok(b) => b,
        Err(e) => {
            engine.texture_pool.release(a);
            return Err(e);
        }
    };
    if region.is_some() {
        // Texels outside `rect` are never drawn; zeros keep what a blur or
        // a bilinear read at its edge picks up finite.
        engine.gpu().clear(a, [0.0; 4]);
        engine.gpu().clear(b, [0.0; 4]);
    }
    let params = ThumbnailBoxParams {
        dst_size: [lw as f32, lh as f32],
        channel: crate::document::thumbnail_gpu::COLOUR,
        region: engine.region_uniform(),
    };
    let drawn = engine
        .pass(&engine.shaders.thumbnail_box, params)
        .texture("u_tex", src)
        .blend(Blend::Off)
        .viewport(rect.x, rect.y, rect.width as i32, rect.height as i32)
        .draw(Target::Texture(a));
    engine.gpu().unbind_textures(1);
    let low_sigma = sigma / factor as f32;
    let result = if drawn { Ok(()) } else { Err("downscale did not draw".to_string()) }
        .and_then(|_| blur_pass(engine, a, b, rect, true, low_sigma))
        .and_then(|_| blur_pass(engine, b, a, rect, false, low_sigma));
    engine.texture_pool.release(b);
    match result {
        Ok(()) => Ok(Blurred { texture: a, grid: engine.region_uniform() }),
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
/// reduce noise: on display-encoded values after the tone pass (without the
/// working space, and an area layer's with it), never clamped with the
/// working space.
pub fn apply_noise_reduction(engine: &mut EngineInner) {
    let run = NoiseRun { keep_negative: engine.working_space.is_some(), ..detail::DISPLAY_RUN };
    reduce_noise(engine, run);
}

/// The document's noise reduction with the working space, on scene data
/// wrapped in the display encoding, before haze and the tone pass: a RAW
/// photo's thresholds scaled for data before its base curve
/// (`detail::NR_SCENE_THRESHOLD_SCALE`), nothing clamped.
pub fn apply_noise_reduction_scene(engine: &mut EngineInner) {
    let threshold_scale = if engine.raw_develop.is_some() { detail::NR_SCENE_THRESHOLD_SCALE } else { 1.0 };
    reduce_noise(engine, NoiseRun { threshold_scale, keep_negative: true });
}

fn reduce_noise(engine: &mut EngineInner, run: NoiseRun) {
    let Some(s) = engine.detail.filter(DetailSettings::reduces_noise) else { return };
    if let Err(e) = noise_reduction(engine, &s, run) {
        log_error("Noise reduction", &e);
    }
}

fn noise_reduction(engine: &mut EngineInner, s: &DetailSettings, run: NoiseRun) -> Result<(), String> {
    let program = engine.shaders.noise_reduce()?;
    let (w, h) = (engine.doc_width, engine.doc_height);
    let chroma = blur(engine, engine.composite_texture, w, h, detail::NR_CHROMA_SIGMA * s.pixel_scale)?;
    let params = NoiseReduceParams {
        luminance: lopsy_core::detail::nr_luminance_mix(s),
        color: s.nr_color / 100.0,
        range_sigma: detail::nr_range_sigma(s) / run.threshold_scale,
        guard_scale: run.threshold_scale,
        keep_negative: i32::from(run.keep_negative),
        chroma_grid: chroma.grid,
    };
    let drawn = engine
        .pass(&program, params)
        .texture("u_tex", engine.composite_texture)
        .texture("u_chroma", chroma.texture)
        .blend(Blend::Off)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));
    engine.gpu().unbind_textures(2);
    engine.texture_pool.release(chroma.texture);
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
/// the image. Exports, and the live frame's photo that the statistics keep
/// while the view is on (`compositor::run_live_develop_chain`), call
/// `apply_sharpening` and never show the mask.
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
        .texture("u_blurred", blurred.texture)
        .blend(Blend::Off)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));
    engine.gpu().unbind_textures(2);
    engine.texture_pool.release(blurred.texture);
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
            engine.texture_pool.release(small.texture);
            return Err(e);
        }
    };
    let drawn = engine
        .pass(
            &program,
            LocalContrastParams {
                large_amount: s.large,
                small_amount: s.small,
                haze_amount: s.haze,
                small_grid: small.grid,
                large_grid: large.grid,
            },
        )
        .texture("u_tex", engine.composite_texture)
        .texture("u_small", small.texture)
        .texture("u_large", large.texture)
        .blend(Blend::Off)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));
    engine.gpu().unbind_textures(3);
    engine.texture_pool.release(small.texture);
    engine.texture_pool.release(large.texture);
    if drawn {
        scratch_to_composite(engine);
    }
    Ok(())
}

/// The statistics image of the composite (`luminance_stats.wgsl`), in a
/// pooled document-sized texture the caller releases.
fn statistics(engine: &mut EngineInner, what: Statistic) -> Result<TextureHandle, String> {
    let program = engine.shaders.luminance_stats()?;
    let (w, h) = (engine.doc_width, engine.doc_height);
    let target = engine.texture_pool.acquire(w, h)?;
    let params = LuminanceStatsParams {
        luma: luma(Gamut::Rec2020),
        mode: what.mode(),
        floor: linear_detail::LC_FLOOR,
        centre: linear_detail::LC_CENTRE,
    };
    let drawn = engine
        .pass(&program, params)
        .texture("u_tex", engine.composite_texture)
        .blend(Blend::Off)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(target));
    engine.gpu().unbind_textures(1);
    if drawn {
        Ok(target)
    } else {
        engine.texture_pool.release(target);
        Err("statistics pass did not draw".to_string())
    }
}

/// Large and small details on the rendered linear composite, with the
/// working space, when either is set and not zero
/// (`lopsy_core::linear_detail`). Haze is not part of it.
pub fn apply_local_contrast_linear(engine: &mut EngineInner) {
    let Some(s) = engine.local_contrast.filter(linear_detail::local_contrast_draws) else { return };
    if let Err(e) = local_contrast_linear(engine, &s) {
        log_error("Local contrast", &e);
    }
}

fn local_contrast_linear(engine: &mut EngineInner, s: &LocalContrastSettings) -> Result<(), String> {
    let program = engine.shaders.local_contrast_log()?;
    let (w, h) = (engine.doc_width, engine.doc_height);
    let moments = statistics(engine, Statistic::LogMoments)?;
    let blurs = blur(engine, moments, w, h, detail::LC_SMALL_SIGMA * s.pixel_scale).and_then(|small| {
        match blur(engine, moments, w, h, detail::LC_LARGE_SIGMA * s.pixel_scale) {
            Ok(large) => Ok((small, large)),
            Err(e) => {
                engine.texture_pool.release(small.texture);
                Err(e)
            }
        }
    });
    engine.texture_pool.release(moments);
    let (small, large) = blurs?;
    let params = LocalContrastLogParams {
        luma: luma(Gamut::Rec2020),
        large_gain: linear_detail::detail_gain(s.large),
        small_gain: linear_detail::detail_gain(s.small),
        large_epsilon: linear_detail::LC_LARGE_EPSILON,
        small_epsilon: linear_detail::LC_SMALL_EPSILON,
        floor: linear_detail::LC_FLOOR,
        centre: linear_detail::LC_CENTRE,
        small_grid: small.grid,
        large_grid: large.grid,
    };
    let drawn = engine
        .pass(&program, params)
        .texture("u_tex", engine.composite_texture)
        .texture("u_small", small.texture)
        .texture("u_large", large.texture)
        .blend(Blend::Off)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));
    engine.gpu().unbind_textures(3);
    engine.texture_pool.release(small.texture);
    engine.texture_pool.release(large.texture);
    if drawn {
        scratch_to_composite(engine);
    }
    Ok(())
}

/// Haze on the scene linear composite, with the working space, when set and
/// not zero (`lopsy_core::linear_detail`).
pub fn apply_haze(engine: &mut EngineInner) {
    let Some(s) = engine.local_contrast.filter(linear_detail::haze_draws) else { return };
    if let Err(e) = haze(engine, &s) {
        log_error("Haze", &e);
    }
}

fn haze(engine: &mut EngineInner, s: &LocalContrastSettings) -> Result<(), String> {
    let program = engine.shaders.haze()?;
    let (w, h) = (engine.doc_width, engine.doc_height);
    let stats = statistics(engine, Statistic::Veil)?;
    let veil = blur(engine, stats, w, h, linear_detail::HAZE_SIGMA * s.pixel_scale);
    engine.texture_pool.release(stats);
    let veil = veil?;
    let params = HazeParams {
        haze: s.haze / 100.0,
        remove: linear_detail::HAZE_REMOVE,
        add: linear_detail::HAZE_ADD,
        middle_grey: lopsy_core::scene_tone::MIDDLE_GREY,
        veil_grid: veil.grid,
    };
    let drawn = engine
        .pass(&program, params)
        .texture("u_tex", engine.composite_texture)
        .texture("u_veil", veil.texture)
        .blend(Blend::Off)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));
    engine.gpu().unbind_textures(2);
    engine.texture_pool.release(veil.texture);
    if drawn {
        scratch_to_composite(engine);
    }
    Ok(())
}
