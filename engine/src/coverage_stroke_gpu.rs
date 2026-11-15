//! Shared stroke pipeline of the coverage tools, Dodge / Burn and Sponge.
//!
//! A stroke MAX-accumulates each dab's strength into a per-stroke coverage
//! texture; the compositor previews `apply(layer, coverage)` every frame,
//! and the end of the stroke bakes it into the layer once. Every pass is
//! scissored to the texels the stroke has touched (#1219): coverage is zero
//! elsewhere, where both apply shaders return the layer unchanged.

use std::collections::HashMap;

use lopsy_core::dab_rect::{dab_rect, DirtyRect};
use lopsy_core::geometry::Rect;

use crate::dab_pass_gpu::copy_scratch_a_to;
use crate::engine::EngineInner;
use crate::gpu::pass::{Blend, Pass, Scissor, Target};
use crate::gpu::shader::{ShaderProgram, ShaderPrograms};
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::params::brush::{CoverageApplyParams, DodgeBurnDabParams};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CoverageTool {
    DodgeBurn,
    Sponge,
}

impl CoverageTool {
    fn apply_shader(self, shaders: &ShaderPrograms) -> &ShaderProgram<CoverageApplyParams> {
        match self {
            Self::DodgeBurn => &shaders.dodge_burn,
            Self::Sponge => &shaders.sponge,
        }
    }

    fn coverage(self, engine: &EngineInner) -> &HashMap<String, TextureHandle> {
        match self {
            Self::DodgeBurn => &engine.brush.stroke_dodge_textures,
            Self::Sponge => &engine.brush.stroke_sponge_textures,
        }
    }

    fn maps_mut(
        self,
        engine: &mut EngineInner,
    ) -> (
        &mut HashMap<String, TextureHandle>,
        &mut HashMap<String, TextureHandle>,
        &mut HashMap<String, u32>,
    ) {
        match self {
            Self::DodgeBurn => (
                &mut engine.brush.stroke_dodge_textures,
                &mut engine.brush.stroke_dodge_preview_textures,
                &mut engine.brush.stroke_dodge_modes,
            ),
            Self::Sponge => (
                &mut engine.brush.stroke_sponge_textures,
                &mut engine.brush.stroke_sponge_preview_textures,
                &mut engine.brush.stroke_sponge_modes,
            ),
        }
    }
}

/// Which texels of a layer's in-progress coverage stroke are non-zero.
#[derive(Debug, Default)]
pub struct CoverageStroke {
    /// Every dab so far: the region the bake must cover.
    pub stroke: DirtyRect,
    /// Dabs since the compositor last rendered the preview.
    pub preview_pending: DirtyRect,
    /// The layer texture and content generation the preview was last built
    /// from. Preview texels outside `preview_pending` are current only while
    /// both still match.
    pub preview_base: Option<(TextureHandle, u64)>,
}

/// Start a stroke on `layer_id`: allocate a zeroed coverage texture and a
/// preview texture the size of the layer. Until `end_stroke` runs the
/// compositor shows the preview instead of the layer, so overlapping dabs
/// within one stroke never compound.
pub(crate) fn begin_stroke(
    engine: &mut EngineInner,
    layer_id: &str,
    mode: u32,
    tool: CoverageTool,
) -> Result<(), String> {
    engine.ensure_layer_full_size(layer_id)?;

    if let Some(&layer_tex) = engine.layer_textures.get(layer_id) {
        let (w, h) = engine.texture_pool.get_size(layer_tex).unwrap_or((1, 1));
        let coverage_tex = engine.texture_pool.acquire(w, h)?;
        let preview_tex = engine.texture_pool.acquire(w, h)?;
        let (coverage, previews, modes) = tool.maps_mut(engine);
        let old_coverage = coverage.insert(layer_id.to_string(), coverage_tex);
        let old_preview = previews.insert(layer_id.to_string(), preview_tex);
        modes.insert(layer_id.to_string(), mode);
        for old in old_coverage.into_iter().chain(old_preview) {
            engine.texture_pool.release(old);
        }
        engine
            .coverage_strokes
            .insert(layer_id.to_string(), CoverageStroke::default());

        if engine.brush.stroke_fbo.is_none() {
            let fbo = engine.fbo_pool.create()?;
            engine.brush.stroke_fbo = Some(fbo);
        }
    }
    engine.needs_recomposite = true;
    Ok(())
}

/// MAX-accumulate each dab's scalar strength (stamp × `strength`) into the
/// stroke's coverage texture, written equally to all four channels, so one
/// stroke paints at the highest strength each texel ever sees rather than
/// the sum of its dabs. Each dab's quad is scissored to the dab.
pub(crate) fn accumulate_dabs(
    engine: &mut EngineInner,
    layer_id: &str,
    tool: CoverageTool,
    points: &[f64],
    size: f32,
    hardness: f32,
    strength: f32,
) {
    let Some(&coverage_handle) = tool.coverage(engine).get(layer_id) else {
        return;
    };
    let (w, h) = engine
        .texture_pool
        .get_size(coverage_handle)
        .unwrap_or((1, 1));
    if engine.brush.stroke_fbo.is_none() || engine.texture_pool.get(coverage_handle).is_none() {
        return;
    }

    // Selection mask — same coordinate dance as brush_dab.
    let has_selection = engine.selection_mask_texture.is_some();
    let selection_mask = engine
        .selection_mask_texture
        .filter(|&mask| engine.texture_pool.get(mask).is_some());
    let (layer_ox, layer_oy) = engine
        .layer_stack
        .iter()
        .find(|l| l.id == layer_id)
        .map(|l| (l.x as f32, l.y as f32))
        .unwrap_or((0.0, 0.0));

    let params = DodgeBurnDabParams {
        center: match points {
            [x, y, ..] => [*x as f32, *y as f32],
            _ => [0.0, 0.0],
        },
        size,
        hardness,
        tex_size: [w as f32, h as f32],
        exposure: strength,
        has_selection: i32::from(has_selection),
        doc_size: [engine.doc_width as f32, engine.doc_height as f32],
        layer_offset: [layer_ox, layer_oy],
    };
    let mut pass = engine.pass(&engine.shaders.dodge_burn_dab, params);
    if let Some(mask) = selection_mask {
        pass = pass.texture("u_selectionMask", mask);
    }
    let pass = pass.blend(Blend::Max);
    let Some(mut dabs) = pass.begin(Target::Texture(coverage_handle)) else {
        return;
    };

    let mut touched = DirtyRect::default();
    for chunk in points.chunks_exact(2) {
        let (cx, cy) = (chunk[0] as f32, chunk[1] as f32);
        let Some(rect) = dab_rect(cx, cy, size, w, h) else {
            continue;
        };
        touched.add(Some(rect));
        dabs.set(&DodgeBurnDabParams { center: [cx, cy], ..params });
        dabs.draw_in(rect);
    }
    dabs.end();

    if let Some(state) = engine.coverage_strokes.get_mut(layer_id) {
        state.stroke.add(touched.get());
        state.preview_pending.add(touched.get());
    }
    engine.needs_recomposite = true;
}

/// Render the in-progress stroke into its preview texture —
/// `apply(layer, coverage)` with exposure 1.0, since exposure is already
/// baked into the coverage — and return the preview's handle, or `None` to
/// composite the raw layer. Only texels dabbed since the last preview are
/// redrawn while the layer texture is unchanged; otherwise the whole
/// preview is rebuilt.
pub(crate) fn render_preview(
    engine: &mut EngineInner,
    layer_id: &str,
    layer_handle: TextureHandle,
    tw: u32,
    th: u32,
    tool: CoverageTool,
) -> Option<TextureHandle> {
    let (coverage_handle, preview_handle, mode) = {
        let (coverage, previews, modes) = tool.maps_mut(engine);
        (
            *coverage.get(layer_id)?,
            *previews.get(layer_id)?,
            modes.get(layer_id).copied().unwrap_or(0),
        )
    };

    // Layer texture may have been resized (ensure_layer_full_size) since
    // begin_stroke — if coverage/preview are stale, skip preview and let
    // the raw layer through.
    if engine
        .texture_pool
        .get_size(coverage_handle)
        .map_or(true, |(w, h)| w != tw || h != th)
    {
        return None;
    }
    if engine
        .texture_pool
        .get_size(preview_handle)
        .map_or(true, |(w, h)| w != tw || h != th)
    {
        return None;
    }

    // A source other than the layer texture itself (a merged brush-stroke
    // temp) can change between frames without a content-generation bump.
    let base = (engine.layer_textures.get(layer_id) == Some(&layer_handle))
        .then(|| (layer_handle, engine.layer_content_gen(layer_id)));
    let state = engine
        .coverage_strokes
        .entry(layer_id.to_string())
        .or_default();
    let pending = state.preview_pending.take();
    let rect = if base.is_some() && state.preview_base == base {
        pending
    } else {
        Some(Rect::new(0, 0, tw, th))
    };
    state.preview_base = base;

    engine.texture_pool.get(layer_handle)?;
    engine.texture_pool.get(coverage_handle)?;
    engine.texture_pool.get(preview_handle)?;

    if let Some(rect) = rect {
        apply_pass(engine, tool, mode, layer_handle, coverage_handle)
            .blend(Blend::Off)
            .scissor(Scissor::Rect(rect))
            .draw(Target::Texture(preview_handle));
        engine.gpu().unbind_textures(2);
    }

    Some(preview_handle)
}

/// Bake the stroke's coverage into the layer, limited to the texels the
/// stroke touched, then release its coverage and preview textures.
pub(crate) fn end_stroke(engine: &mut EngineInner, layer_id: &str, tool: CoverageTool) {
    let (coverage_handle, preview_handle, mode) = {
        let (coverage, previews, modes) = tool.maps_mut(engine);
        let Some(c) = coverage.remove(layer_id) else {
            return;
        };
        (
            c,
            previews.remove(layer_id),
            modes.remove(layer_id).unwrap_or(0),
        )
    };
    let touched = engine
        .coverage_strokes
        .remove(layer_id)
        .and_then(|s| s.stroke.get());

    if let Some(rect) = touched {
        bake(engine, layer_id, tool, mode, coverage_handle, rect);
        engine.mark_layer_dirty(layer_id);
    } else {
        engine.needs_recomposite = true;
    }

    engine.texture_pool.release(coverage_handle);
    if let Some(p) = preview_handle {
        engine.texture_pool.release(p);
    }
}

fn bake(
    engine: &mut EngineInner,
    layer_id: &str,
    tool: CoverageTool,
    mode: u32,
    coverage_handle: TextureHandle,
    rect: Rect,
) {
    let Some(&layer_tex_handle) = engine.layer_textures.get(layer_id) else {
        return;
    };
    let (w, h) = engine
        .texture_pool
        .get_size(layer_tex_handle)
        .unwrap_or((1, 1));
    // Coverage and layer share texel coordinates only while their sizes match.
    if engine.texture_pool.get_size(coverage_handle) != Some((w, h)) {
        return;
    }
    if engine.texture_pool.get(layer_tex_handle).is_none()
        || engine.texture_pool.get(coverage_handle).is_none()
    {
        return;
    }
    // The copy-back reads scratch texel for texel, so it must match the layer.
    if engine.ensure_scratch_size(w, h).is_err() {
        return;
    }

    apply_pass(engine, tool, mode, layer_tex_handle, coverage_handle)
        .blend(Blend::Off)
        .viewport(0, 0, w as i32, h as i32)
        .scissor(Scissor::Rect(rect))
        .draw(Target::Framebuffer(engine.scratch_fbo_a));
    // Unbind the layer texture before blitting back onto it, otherwise
    // some drivers sample the FBO's own attachment.
    engine.gpu().unbind_textures(2);
    copy_scratch_a_to(engine, layer_tex_handle, w, h, rect);
}

/// The pass that draws `apply(layer, coverage)` at full strength.
fn apply_pass<'a>(
    engine: &'a EngineInner,
    tool: CoverageTool,
    mode: u32,
    layer: TextureHandle,
    coverage: TextureHandle,
) -> Pass<'a, CoverageApplyParams> {
    engine
        .pass(tool.apply_shader(&engine.shaders), CoverageApplyParams { mode: mode as i32, exposure: 1.0 })
        .texture("u_layerTex", layer)
        .texture("u_stampTex", coverage)
}
