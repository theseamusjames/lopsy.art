//! Stylize filters: pixelate, halftone, kaleidoscope, oil paint, chromatic
//! aberration, pixel stretch, find edges, cel shading, bloom.

use wasm_bindgen::prelude::*;

use super::full_size_doc_center;
use crate::Engine;
use crate::filter_gpu;
use crate::gpu::pass::Target;
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::params::filters::{
    BloomCombineParams, BloomThresholdParams, CelShadingParams, ChromaticAberrationParams, EmbossParams,
    GaussianBlurParams, HalftoneParams, KaleidoscopeParams, LensDistortionParams, OilPaintParams,
    PixelStretchParams, VoronoiParams,
};
use crate::gpu::uniforms::FloatArray;

#[wasm_bindgen(js_name = "filterPixelate")]
pub fn filter_pixelate(engine: &mut Engine, layer_id: &str, block_size: u32) {
    if block_size <= 1 {
        return;
    }
    filter_gpu::apply_pixelate(&mut engine.inner, layer_id, block_size);
}

#[wasm_bindgen(js_name = "filterHalftone")]
pub fn filter_halftone(engine: &mut Engine, layer_id: &str, dot_size: f32, density: f32, angle: f32, contrast: f32) {
    if dot_size < 2.0 {
        return;
    }
    let density = density.clamp(0.25, 3.0);
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.halftone,
        HalftoneParams { dot_size, angle, contrast, density },
    );
}

#[wasm_bindgen(js_name = "filterKaleidoscope")]
pub fn filter_kaleidoscope(engine: &mut Engine, layer_id: &str, segments: u32, rotation_degrees: f32) {
    // Kaleidoscope's polar math needs the texture's pixel dimensions to stay
    // isotropic on non-square layers (see kaleidoscope.glsl), and mirrors
    // around the canvas centre, which moves in UV when the layer hangs past
    // the canvas. Resize up front so both match the texture the shader runs on.
    let Some((w, h, cu, cv)) = full_size_doc_center(&mut engine.inner, layer_id) else {
        return;
    };

    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.kaleidoscope,
        KaleidoscopeParams {
            segments: segments.max(2) as f32,
            rotation: rotation_degrees.to_radians(),
            size: [w as f32, h as f32],
            center: [cu, cv],
        },
    );
}

#[wasm_bindgen(js_name = "filterOilPaint")]
pub fn filter_oil_paint(engine: &mut Engine, layer_id: &str, radius: f32, sharpness: f32) {
    let radius = radius.clamp(1.0, 10.0);
    let sharpness = sharpness.clamp(0.1, 5.0);
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.oil_paint,
        OilPaintParams { radius, sharpness },
    );
}

#[wasm_bindgen(js_name = "filterChromaticAberration")]
pub fn filter_chromatic_aberration(engine: &mut Engine, layer_id: &str, amount: f32, angle_degrees: f32) {
    let amount = amount.clamp(0.0, 100.0);
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.chromatic_aberration,
        ChromaticAberrationParams { amount, angle: angle_degrees.to_radians() },
    );
}

#[wasm_bindgen(js_name = "filterPixelStretch")]
pub fn filter_pixel_stretch(
    engine: &mut Engine,
    layer_id: &str,
    amount: f32,
    bands: f32,
    seed: f32,
    rgb_split: f32,
) {
    let amount = amount.clamp(0.0, 200.0);
    let bands = bands.clamp(2.0, 50.0);
    let rgb_split = rgb_split.clamp(0.0, 1.0);
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.pixel_stretch,
        PixelStretchParams { amount, bands, seed, rgb_split },
    );
}

#[wasm_bindgen(js_name = "filterLensDistortion")]
pub fn filter_lens_distortion(
    engine: &mut Engine,
    layer_id: &str,
    strength: f32,
    zoom: f32,
    fringing: f32,
) {
    let strength = strength.clamp(-1.0, 1.0);
    let zoom = zoom.clamp(0.5, 2.0);
    let fringing = fringing.clamp(0.0, 1.0);
    let Some((_, _, cu, cv)) = full_size_doc_center(&mut engine.inner, layer_id) else {
        return;
    };
    let doc_long_side = engine.inner.doc_width.max(engine.inner.doc_height).max(1) as f32;
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.lens_distortion,
        LensDistortionParams {
            strength,
            zoom,
            fringing,
            center: [cu, cv],
            radius_scale: doc_long_side,
        },
    );
}

#[wasm_bindgen(js_name = "filterFindEdges")]
pub fn filter_find_edges(engine: &mut Engine, layer_id: &str) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.find_edges,
        (),
    );
}

#[wasm_bindgen(js_name = "filterCelShading")]
pub fn filter_cel_shading(engine: &mut Engine, layer_id: &str, levels: u32, edge_strength: f32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.cel_shading,
        CelShadingParams { levels: levels as i32, edge_strength },
    );
}

#[wasm_bindgen(js_name = "filterEmboss")]
pub fn filter_emboss(engine: &mut Engine, layer_id: &str, angle_degrees: f32, strength: f32, emboss_type: f32) {
    let strength = strength.clamp(0.0, 1.0);
    let emboss_type = emboss_type.clamp(0.0, 1.0);
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.emboss,
        EmbossParams { angle: angle_degrees.to_radians(), strength, emboss_type },
    );
}

#[wasm_bindgen(js_name = "filterBloom")]
pub fn filter_bloom(
    engine: &mut Engine,
    layer_id: &str,
    threshold: f32,
    soft_knee: f32,
    radius: u32,
    intensity: f32,
) {
    if radius == 0 { return; }

    let threshold = threshold.clamp(0.0, 1.0);
    let soft_knee = soft_knee.clamp(0.0, 1.0);
    let intensity = intensity.clamp(0.0, 5.0);

    let _ = engine.inner.ensure_layer_full_size(layer_id);

    let kernel = lopsy_core::filters::blur::gaussian_kernel(radius);

    let tex_handle = match engine.inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.inner.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.inner.texture_pool.get(tex_handle).is_none() {
        return;
    }
    let inner = &engine.inner;

    // Pass 1: Threshold — extract bright pixels (layer → scratch B)
    inner.pass(&inner.shaders.bloom_threshold, BloomThresholdParams { threshold, soft_knee })
        .texture("u_tex", tex_handle)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(inner.scratch_fbo_b));

    // Half-kernel from the centre out.
    let weights = FloatArray::from_slice(kernel.get(radius as usize..).unwrap_or(&[]));
    let blur_pass = |src: TextureHandle, direction: (f32, f32)| {
        inner
            .pass(&inner.shaders.gaussian_blur, GaussianBlurParams {
                direction: [direction.0, direction.1],
                weights,
                radius: radius as i32,
            })
            .texture("u_tex", src)
            .viewport(0, 0, w as i32, h as i32)
    };
    // Pass 2: Horizontal blur (scratch B → scratch A)
    blur_pass(inner.scratch_texture_b, (1.0, 0.0)).draw(Target::Framebuffer(inner.scratch_fbo_a));
    // Pass 3: Vertical blur (scratch A → scratch B)
    blur_pass(inner.scratch_texture_a, (0.0, 1.0)).draw(Target::Framebuffer(inner.scratch_fbo_b));

    // Pass 4: Combine — add bloom onto original (layer + scratch B → scratch A)
    inner.pass(&inner.shaders.bloom_combine, BloomCombineParams { intensity })
        .texture("u_tex", tex_handle)
        .texture("u_bloomTex", inner.scratch_texture_b)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(inner.scratch_fbo_a));

    // Bloomed result is in scratch A; confine it to the selection (#1176).
    filter_gpu::commit_scratch_a_to_layer(&mut engine.inner, layer_id);
}

#[wasm_bindgen(js_name = "filterVoronoi")]
pub fn filter_voronoi(
    engine: &mut Engine,
    layer_id: &str,
    cell_count: f32,
    edge_width: f32,
    edge_r: f32,
    edge_g: f32,
    edge_b: f32,
    seed: f32,
) {
    let cell_count = cell_count.clamp(2.0, 200.0);
    let edge_width = edge_width.clamp(0.0, 20.0);
    let edge_r = edge_r.clamp(0.0, 1.0);
    let edge_g = edge_g.clamp(0.0, 1.0);
    let edge_b = edge_b.clamp(0.0, 1.0);
    let seed = seed.clamp(0.0, 999.0);
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.voronoi,
        VoronoiParams { cell_count, edge_width, edge_r, edge_g, edge_b, seed },
    );
}
