use std::collections::{HashMap, HashSet};
use crate::coverage_stroke_gpu::{self, CoverageTool};
use crate::engine::{EngineInner, ImageAdjustmentState};
use crate::gpu::pass::{Blend, Pass, Scissor, Target};
use crate::gpu::shader::ShaderProgram;
use crate::gpu::uniforms::Uniforms;
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::framebuffer::FramebufferHandle;
use crate::effect_cache_gpu::{self as fx_cache, emit_effect, DocTarget, EffectCacheKey, EffectCapture, EffectOut, Phase};
use lopsy_core::effect_cache as fx_extent;
use lopsy_core::geometry::Rect;
use lopsy_core::layer::{GlowDesc, ShadowDesc, StrokeDesc, ColorOverlayDesc};

/// The document-space origin of a layer's mask texture — where mask texel
/// (0, 0) sits in the document. Every mask reader and writer goes through
/// this so they agree: compositing (`blend.glsl`'s `u_maskOffset`), merge,
/// the mask-edit overlay, and the mask brush/pencil/fill/gradient, which
/// all take document-space coordinates and subtract this origin.
///
/// Raster and group masks are document-anchored: `addLayerMask` sizes them
/// to the document, at the origin. A raster layer's own `x/y` is *not* a
/// stable anchor — the "crop on switch away" optimization (#850), the
/// expand-on-activate path, and the brush prewarm's
/// `ensure_layer_full_size` all rewrite it without moving any content — so
/// a raster mask must never follow it (#907). Group layers composite
/// through a doc-sized scratch texture, so their mask is at the origin
/// too. Shape and text layers are never auto-cropped/expanded — their mask
/// is created at, and tracks, the layer's own (possibly non-zero) position.
pub(crate) fn mask_doc_offset(layer_type: lopsy_core::layer::LayerType, layer_x: f32, layer_y: f32) -> (f32, f32) {
    match layer_type {
        lopsy_core::layer::LayerType::Raster | lopsy_core::layer::LayerType::Group => (0.0, 0.0),
        _ => (layer_x, layer_y),
    }
}

/// `mask_doc_offset` for a layer looked up by id in the engine's stack.
pub(crate) fn mask_doc_origin(engine: &EngineInner, layer_id: &str) -> (f32, f32) {
    engine.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| mask_doc_offset(l.layer_type, l.x as f32, l.y as f32))
        .unwrap_or((0.0, 0.0))
}

/// Main compositing pipeline — called every frame
pub fn composite(engine: &mut EngineInner) -> Result<(), String> {
    let doc_w = engine.doc_width;
    let doc_h = engine.doc_height;
    let bg = engine.bg_color;

    // Every scratch pass below renders at the doc viewport and blits the
    // whole scratch texture back; a layer op may have left it layer-sized.
    engine.ensure_scratch_size(doc_w, doc_h)?;
    let budget = fx_cache::budget_for_document(doc_w, doc_h, fx_cache::bytes_per_texel(engine));
    engine.effect_cache.set_budget_bytes(budget);

    // 1. Clear the composite with the background color
    engine.gpu().clear(engine.composite_texture, bg);

    // 2. Iterate layers by index so we can take fresh borrows of engine
    //    inside the loop without holding a long-lived borrow of layer_stack.
    //    For each layer we read the scalar fields + clone only the enabled
    //    effect descs in a short scope, then the `&mut engine` render calls
    //    run freely. This avoids the previous per-frame Vec<tuple>
    //    allocation and the unconditional EffectsDesc.clone().
    let mask_edit_id = engine.mask_edit_layer_id.clone();
    let n = engine.layer_stack.len();

    // Pre-compute group adjustment routing: for each child layer, which group
    // (if any) owns it for adjustment purposes. `child_ids` for each group
    // only lists descendants up to (and including) the nearest nested group
    // that itself needs routing — see `flattenGroupDescendants` on the JS
    // side — so each id maps to exactly one immediate parent group, even
    // when adjusted groups are nested inside one another (#857).
    let child_to_group: HashMap<String, String> = engine.group_adjustments.iter()
        .flat_map(|(gid, ga)| ga.child_ids.iter().map(move |cid| (cid.clone(), gid.clone())))
        .collect();

    // Groups that participate in nesting (an adjusted ancestor or an
    // adjusted descendant of another adjusted group) never use the
    // pre-adjustment cache fast path: a nested group's cached texture would
    // otherwise embed a stale copy of the other group's adjusted output
    // whenever only the *other* group's adjustment values change. Flat
    // (non-nested) groups — the common case — keep the original caching
    // behavior untouched.
    let nested_group_ids: HashSet<String> = {
        let routed_ids: HashSet<&str> =
            engine.group_adjustments.keys().map(String::as_str).collect();
        let mut nested = HashSet::new();
        for (gid, ga) in engine.group_adjustments.iter() {
            for cid in &ga.child_ids {
                if routed_ids.contains(cid.as_str()) {
                    nested.insert(gid.clone());
                    nested.insert(cid.clone());
                }
            }
        }
        nested
    };

    // Whether the pre-adjustment caches were valid (nothing dirtied since
    // they were built) at the START of this frame. Captured once so a
    // recompute triggered by one group mid-frame doesn't let a later,
    // still-stale group in the same frame read a cache built before that
    // recompute — `group_pre_adj_valid` itself is only set back to `true`
    // once, at the end of this function, after every group encountered
    // this frame has had a chance to refresh its entry.
    let cache_was_valid = engine.group_pre_adj_valid;

    // Stack of currently-open adjusted-group accumulations, innermost last.
    // A leaf (or nested group marker) whose resolved parent doesn't match
    // the current top pushes a new frame at the next depth; a group marker
    // matching the top pops and finalizes it, blending onto whatever is now
    // the new top (an ancestor's scratch) or onto the main composite.
    let mut group_stack: Vec<GroupFrame> = Vec::new();

    for idx in 0..n {
        let (
            layer_id,
            layer_type,
            visible,
            opacity,
            blend_mode,
            layer_x,
            layer_y,
            layer_w,
            layer_h,
            outer_glow,
            inner_glow,
            drop_shadow,
            stroke_eff,
            color_overlay,
            is_mask_editing,
        ) = {
            let layer = &engine.layer_stack[idx];
            let is_editing = mask_edit_id.as_deref() == Some(layer.id.as_str());
            (
                layer.id.clone(),
                layer.layer_type,
                layer.visible,
                layer.opacity,
                layer.blend_mode as i32,
                layer.x as f32,
                layer.y as f32,
                layer.width as f32,
                layer.height as f32,
                layer.effects.outer_glow.as_ref().filter(|g| g.enabled).cloned(),
                layer.effects.inner_glow.as_ref().filter(|g| g.enabled).cloned(),
                layer.effects.drop_shadow.as_ref().filter(|s| s.enabled).cloned(),
                layer.effects.stroke.as_ref().filter(|s| s.enabled).cloned(),
                layer.effects.color_overlay.as_ref().filter(|o| o.enabled).cloned(),
                is_editing,
            )
        };

        if !visible || opacity < 1e-7 {
            // If this is a group layer with adjustments but invisible, close
            // out the group (discarding its unfinished scratch) so children
            // don't keep routing to it.
            if layer_type == lopsy_core::layer::LayerType::Group
                && group_stack.last().map(|f| f.id.as_str()) == Some(layer_id.as_str())
            {
                group_stack.pop();
            }
            continue;
        }

        // --- Group adjustment handling ---
        // When we encounter a Group layer that has adjustments, finalize the
        // group scratch: apply adjustments, blend onto whatever is
        // accumulating this group's content, then skip the normal
        // per-layer compositing (groups have no texture).
        if layer_type == lopsy_core::layer::LayerType::Group {
            if group_stack.last().map(|f| f.id.as_str()) == Some(layer_id.as_str()) {
                // This is the group marker — finalize its children.
                let frame = group_stack.pop().expect("checked by the condition above");
                let gs_tex = frame.target.tex;
                let is_cache_eligible = !nested_group_ids.contains(&layer_id);

                if !frame.skip && is_cache_eligible {
                    // Children were freshly rendered this frame (not
                    // restored from cache) — refresh the persistent
                    // pre-adjustment cache so a later frame that only
                    // changes adjustment values can skip re-blending them.
                    refresh_pre_adj_cache(engine, &layer_id, gs_tex);
                }

                if let Some(ga) = engine.group_adjustments.get(&layer_id) {
                    let adj = ga.adjustments.clone();
                    apply_adjustments_to_texture(engine, frame.target, &adj);
                }
                // Look up the group's mask (same path as individual layer masks).
                // A group's own scratch is always doc-sized/doc-origin (#850),
                // regardless of nesting depth, so its mask sits at the origin.
                let is_mask_enabled = engine.layer_stack[idx].mask.as_ref().map_or(false, |m| m.enabled);
                let group_mask = live_mask(engine, &layer_id, 0.0, 0.0).filter(|_| is_mask_enabled);
                // Blend the adjusted group scratch onto whichever target is
                // accumulating this group's content: an ancestor group's
                // scratch if this group is nested inside one that's still
                // open, otherwise the main composite (#857). The scratch
                // holds straight alpha (blend.glsl un-premultiplies its
                // output), so it must not be un-premultiplied again — that
                // over-brightened every partially transparent child pixel,
                // e.g. a glow's falloff.
                let dest = group_stack.last().map(|f| f.target).unwrap_or_else(|| main_target(engine));
                let source = BlendSource {
                    opacity,
                    mask: group_mask,
                    ..BlendSource::new(gs_tex, (0.0, 0.0), (doc_w as f32, doc_h as f32))
                };
                blend_onto_target(engine, &source, blend_mode, dest, None)?;
                // A mask-edited child's overlay can't be drawn into the
                // scratch (the adjustments would tint it) nor under it (the
                // scratch would cover it), so it's drawn once the outermost
                // adjusted group lands on the main composite (#992).
                if group_stack.is_empty() {
                    render_routed_mask_edit_overlay(engine, mask_edit_id.as_deref(), &layer_id, &child_to_group);
                }
                continue;
            }
            continue;
        }

        // Check if this layer is a child of a group with adjustments.
        // If so, ensure that group's scratch is set up (pushing a new
        // frame on the group stack if we're not already accumulating into
        // it) and redirect compositing there. If its pre-adjustment cache
        // is valid, skip child blending entirely — the cache already holds
        // the children together with their effects.
        let target = if let Some(gid) = child_to_group.get(&layer_id).cloned() {
            let top_matches = group_stack.last().map(|f| f.id.as_str()) == Some(gid.as_str());
            if top_matches {
                if group_stack.last().is_some_and(|f| f.skip) {
                    engine.effect_cache.touch(&layer_id);
                    continue;
                }
                group_stack.last().unwrap().target
            } else {
                let depth = group_stack.len();
                let scratch_target = acquire_group_scratch_level(engine, depth)?;
                let is_cache_eligible = !nested_group_ids.contains(&gid);
                let use_cache = is_cache_eligible
                    && cache_was_valid
                    && engine.group_pre_adj_cache.contains_key(&gid);
                if use_cache {
                    let cache_tex = *engine.group_pre_adj_cache.get(&gid).unwrap();
                    restore_pre_adj_cache(engine, cache_tex, scratch_target);
                    group_stack.push(GroupFrame { id: gid, target: scratch_target, skip: true });
                    engine.effect_cache.touch(&layer_id);
                    continue;
                }
                clear_target(engine, scratch_target);
                group_stack.push(GroupFrame { id: gid, target: scratch_target, skip: false });
                scratch_target
            }
        } else {
            main_target(engine)
        };

        let tex_handle = match engine.layer_textures.get(&layer_id) {
            Some(&h) => h,
            None => continue,
        };
        let (tw, th) = engine.texture_pool.get_size(tex_handle).unwrap_or((layer_w as u32, layer_h as u32));

        // If a brush stroke is in progress for this layer, pre-merge
        // (layer + stroke_texture) into a scratch so effects (drop shadow,
        // stroke, glows) sample the in-progress stroke as if it were part
        // of the layer. Without this, effects lag by one stroke because
        // endStroke is deferred until the next mousedown (shift-click
        // continuation).
        let merged_handle: Option<TextureHandle> = engine.stroke_textures.get(&layer_id)
            .copied()
            .and_then(|stroke_handle| render_layer_plus_stroke(engine, tex_handle, stroke_handle, tw, th));
        let effect_tex_handle = merged_handle.unwrap_or(tex_handle);

        // In mask edit mode: skip mask clipping so full layer content is visible
        let (mask_offset_x, mask_offset_y) = mask_doc_offset(layer_type, layer_x, layer_y);
        let layer_mask = live_mask(engine, &layer_id, mask_offset_x, mask_offset_y);
        let is_mask_enabled = engine.layer_stack[idx].mask.as_ref().map_or(false, |m| m.enabled);
        let mask_arg = layer_mask.filter(|_| is_mask_enabled && !is_mask_editing);

        // Effects follow the masked silhouette, not the raw layer alpha (#977).
        let has_shape_effects = outer_glow.is_some() || drop_shadow.is_some()
            || inner_glow.is_some() || stroke_eff.is_some();

        // Replay the layer's cached effect images when nothing they're built
        // from has changed. A live brush stroke bypasses the cache: the
        // effects then trace layer + stroke, which changes every dab.
        let cache_key = (has_shape_effects && !engine.stroke_textures.contains_key(&layer_id)).then(|| EffectCacheKey {
            content_gen: engine.layer_content_gen(&layer_id),
            texture: tex_handle,
            texture_size: (tw, th),
            origin: (layer_x as i32, layer_y as i32),
            mask: mask_arg.map(|m| (m.texture, m.width, m.height, m.offset_x, m.offset_y)),
            opacity,
            doc_size: (doc_w, doc_h),
            outer_glow: outer_glow.clone(),
            inner_glow: inner_glow.clone(),
            drop_shadow: drop_shadow.clone(),
            stroke: stroke_eff.clone(),
        });
        let mut stale = Vec::new();
        let cached = cache_key.as_ref().and_then(|key| {
            engine.effect_cache.lookup(&layer_id, key, &mut stale).map(|e| (e.behind.clone(), e.above.clone()))
        });
        let mut capture = match (&cache_key, &cached) {
            (Some(_), None) => {
                let (behind, above) = fx_extent::planned_images(
                    Rect::new(layer_x as i32, layer_y as i32, tw, th),
                    fx_extent::ShapeEffects {
                        outer_glow: outer_glow.as_ref(),
                        inner_glow: inner_glow.as_ref(),
                        drop_shadow: drop_shadow.as_ref(),
                        stroke: stroke_eff.as_ref(),
                    },
                    doc_w,
                    doc_h,
                );
                let bpp = fx_cache::bytes_per_texel(engine);
                let planned = fx_cache::image_bytes(&behind, bpp) + fx_cache::image_bytes(&above, bpp);
                engine.effect_cache.has_room_for(planned).then(|| EffectCapture::new(std::mem::take(&mut stale)))
            }
            _ => None,
        };
        fx_cache::delete_textures(engine, stale);

        let masked_effect_handle = match (mask_arg, has_shape_effects && cached.is_none()) {
            (Some(mask), true) => render_layer_masked_for_effects(
                engine, effect_tex_handle, tw, th, layer_x, layer_y, mask,
            ),
            _ => None,
        };
        let effects_src_handle = masked_effect_handle.unwrap_or(effect_tex_handle);

        let has_behind_effects = outer_glow.is_some() || drop_shadow.is_some()
            || stroke_eff.as_ref().is_some_and(is_behind_stroke);
        let effect_backdrop = capture_effect_backdrop(engine, blend_mode, has_behind_effects, target);

        // --- "Behind" effects: outer glow, drop shadow, outside stroke ---
        if let Some((behind, _)) = &cached {
            for image in behind {
                fx_cache::blend_cached_effect(engine, image, target);
            }
        } else {
            render_behind_effects(
                engine,
                EffectSource { handle: effects_src_handle, x: layer_x, y: layer_y, width: tw, height: th },
                outer_glow.as_ref(),
                drop_shadow.as_ref(),
                stroke_eff.as_ref(),
                opacity,
                &mut EffectOut { target, capture: capture.as_mut(), clip: true },
            );
        }

        // --- Color overlay + blend layer onto composite ---
        let overlay_desc = color_overlay.as_ref();
        // If an in-progress dodge/burn stroke exists for this layer, render
        // the preview (layer + coverage via dodge/burn shader) into the
        // per-stroke preview texture and composite that instead of the raw
        // layer. This way the stroke is non-destructive until `endStroke`
        // bakes it in.
        let composite_src = if engine.stroke_dodge_textures.contains_key(&layer_id) {
            coverage_stroke_gpu::render_preview(engine, &layer_id, effect_tex_handle, tw, th, CoverageTool::DodgeBurn)
                .map(|h| (h, tw, th))
        } else if engine.stroke_sponge_textures.contains_key(&layer_id) {
            coverage_stroke_gpu::render_preview(engine, &layer_id, effect_tex_handle, tw, th, CoverageTool::Sponge)
                .map(|h| (h, tw, th))
        } else if merged_handle.is_some() {
            Some((effect_tex_handle, tw, th))
        } else {
            None
        };
        let (src_handle, src_w, src_h) = composite_src.unwrap_or((tex_handle, tw, th));
        let source = BlendSource {
            opacity,
            overlay: overlay_desc,
            mask: mask_arg,
            backdrop: effect_backdrop.filter(|&h| engine.texture_pool.get(h).is_some()),
            ..BlendSource::new(src_handle, (layer_x, layer_y), (src_w as f32, src_h as f32))
        };
        blend_layer_rect_onto_target(engine, &source, blend_mode, target)?;
        if let Some(h) = effect_backdrop {
            engine.texture_pool.release(h);
        }

        // --- Active stroke texture ---
        // Skipped when we merged the stroke into effect_tex_handle above —
        // it's already in the composite source.
        if merged_handle.is_none() {
            if let Some(&stroke_handle) = engine.stroke_textures.get(&layer_id) {
                let (sw, sh) = engine.texture_pool.get_size(stroke_handle).unwrap_or((1, 1));
                let source = BlendSource {
                    opacity,
                    is_premultiplied: true,
                    mask: mask_arg,
                    ..BlendSource::new(stroke_handle, (layer_x, layer_y), (sw as f32, sh as f32))
                };
                blend_layer_rect_onto_target(engine, &source, 0, target)?;
            }
        }

        // --- Mask edit overlay: translucent blue showing mask coverage ---
        // Routed children get theirs at the group's finalize instead.
        let is_main_target = target.fbo == engine.composite_fbo;
        if is_mask_editing && is_main_target {
            if let Some(mask) = layer_mask {
                render_mask_overlay(engine, mask);
            }
        }

        // --- "On top" effects: inner glow, stroke effect ---
        if let Some((_, above)) = &cached {
            for image in above {
                fx_cache::blend_cached_effect(engine, image, target);
            }
        } else {
            if let Some(c) = capture.as_mut() {
                c.phase = Phase::Above;
            }
            let mut out = EffectOut { target, capture: capture.as_mut(), clip: true };
            if let Some(ref glow) = inner_glow {
                render_glow(engine, effects_src_handle, tw, th, glow, 1, layer_x, layer_y, &mut out);
            }
            if let Some(ref stroke) = stroke_eff {
                if !is_behind_stroke(stroke) {
                    render_stroke(engine, effects_src_handle, tw, th, stroke, layer_x, layer_y, opacity, &mut out);
                }
            }
        }

        if let Some(masked) = masked_effect_handle {
            engine.texture_pool.release(masked);
        }
        if let Some(merged) = merged_handle {
            engine.texture_pool.release(merged);
        }
        if let (Some(key), Some(c)) = (cache_key, capture) {
            fx_cache::store_capture(engine, &layer_id, key, c);
        }
    }

    // Layers not drawn through the cache this frame (hidden, deleted,
    // effects removed) give their images back.
    let mut unused = Vec::new();
    engine.effect_cache.end_frame(&mut unused);
    fx_cache::delete_textures(engine, unused);

    // 4. Apply image adjustments (exposure, contrast, etc.) if any are active
    apply_image_adjustments(engine);

    // 4b. Quick mask overlay: translucent blue tint over unselected areas
    if engine.quick_mask_texture.is_some() {
        render_quick_mask_overlay(engine);
    }

    present(engine)?;

    // Every adjusted group encountered this frame either refreshed its
    // pre-adjustment cache entry or (if `cache_was_valid`) reused an
    // already-fresh one, so the caches as a whole are now consistent.
    // Flipping this only here (not per-group mid-loop) keeps a group
    // recomputed early in the frame from making a still-stale group later
    // in the same frame think it's safe to read its own stale cache entry.
    engine.group_pre_adj_valid = true;

    engine.needs_recomposite = false;
    Ok(())
}

/// Draw the composite texture to the screen canvas through the viewport
/// transform. On its own this is the whole frame when only screen-space
/// state changed (pan, zoom, channel visibility): the composite texture
/// still holds the current document, so no layer is re-blended.
pub fn present(engine: &mut EngineInner) -> Result<(), String> {
    let (screen_w, screen_h) = engine.gpu().screen_size()?;
    let channel_mask = engine.channel_mask;
    engine
        .pass_untyped(&engine.shaders.final_blit)
        .blend(Blend::Off)
        .viewport(0, 0, screen_w, screen_h)
        .texture("u_compositeTex", engine.composite_texture)
        .vec2("u_resolution", screen_w as f32, screen_h as f32)
        .f32("u_zoom", engine.viewport.zoom as f32)
        .vec2("u_pan", engine.viewport.pan_x as f32, engine.viewport.pan_y as f32)
        .vec2("u_docSize", engine.doc_width as f32, engine.doc_height as f32)
        .f32("u_bgAlpha", engine.bg_color[3])
        .f32("u_seamlessEnabled", if engine.seamless_pattern { 1.0 } else { 0.0 })
        .f32("u_seamlessDim", if engine.seamless_dim { 1.0 } else { 0.0 })
        .vec4("u_channelMask", channel_mask[0], channel_mask[1], channel_mask[2], channel_mask[3])
        .i32("u_docColorMode", engine.doc_color_mode as i32)
        .draw(Target::Screen);
    crate::stamp_preview_gpu::draw(engine, screen_w, screen_h);
    engine.needs_present = false;
    Ok(())
}

// ---------------------------------------------------------------------------
// Effect rendering helpers
// ---------------------------------------------------------------------------

const TRANSPARENT: [f32; 4] = [0.0, 0.0, 0.0, 0.0];

fn main_target(engine: &EngineInner) -> DocTarget {
    DocTarget { tex: engine.composite_texture, fbo: engine.composite_fbo }
}

/// Start a pass that covers the whole document and replaces what it draws
/// over — the shape of every pass into the engine's document-sized
/// framebuffers (composite, group scratch, scratch A and B).
fn doc_pass<'a, P: Uniforms>(engine: &'a EngineInner, program: &'a ShaderProgram<P>, params: P) -> Pass<'a, P> {
    engine
        .pass(program, params)
        .blend(Blend::Off)
        .viewport(0, 0, engine.doc_width as i32, engine.doc_height as i32)
}

/// [`doc_pass`] for a program whose uniforms are still set by name.
fn doc_pass_untyped<'a>(engine: &'a EngineInner, program: &'a ShaderProgram) -> Pass<'a> {
    engine
        .pass_untyped(program)
        .blend(Blend::Off)
        .viewport(0, 0, engine.doc_width as i32, engine.doc_height as i32)
}

/// Copy the document-sized texture `src` over the framebuffer `dst`.
fn copy_doc(engine: &EngineInner, src: TextureHandle, dst: FramebufferHandle, scissor: Scissor) {
    doc_pass(engine, &engine.shaders.blit, ())
        .scissor(scissor)
        .texture("u_tex", src)
        .draw(Target::Framebuffer(dst));
}

/// A layer mask as `blend.glsl` reads it: the texture, its size, and where
/// its texel (0, 0) sits in the document (see `mask_doc_offset`).
#[derive(Clone, Copy)]
pub(crate) struct MaskRef {
    pub texture: TextureHandle,
    pub width: u32,
    pub height: u32,
    pub offset_x: f32,
    pub offset_y: f32,
}

/// `layer_id`'s mask texture placed at the given document origin, if it has
/// one. Whether the mask is enabled is the caller's question.
fn live_mask(engine: &EngineInner, layer_id: &str, offset_x: f32, offset_y: f32) -> Option<MaskRef> {
    let texture = *engine.layer_masks.get(layer_id)?;
    let (width, height) = engine.texture_pool.get_size(texture)?;
    engine.texture_pool.get(texture)?;
    Some(MaskRef { texture, width, height, offset_x, offset_y })
}

/// One source for `blend.glsl`: a texture placed in the document, and how
/// it is combined with the target.
#[derive(Clone, Copy)]
pub(crate) struct BlendSource<'a> {
    pub texture: TextureHandle,
    /// Document position of the texture's texel (0, 0).
    pub offset: (f32, f32),
    /// Texture size in texels.
    pub size: (f32, f32),
    pub opacity: f32,
    pub is_premultiplied: bool,
    pub overlay: Option<&'a ColorOverlayDesc>,
    pub mask: Option<MaskRef>,
    /// The target before the layer's behind effects, for the blend formula
    /// to read instead of the target itself (see `capture_effect_backdrop`).
    pub backdrop: Option<TextureHandle>,
    /// Draw the source's red channel as the translucent blue mask overlay
    /// instead of blending it.
    pub is_mask_overlay: bool,
    /// Tile the source across the document (seamless pattern preview).
    pub wraps: bool,
}

impl BlendSource<'static> {
    /// An opaque, unmasked, straight-alpha source.
    pub fn new(texture: TextureHandle, offset: (f32, f32), size: (f32, f32)) -> Self {
        Self {
            texture,
            offset,
            size,
            opacity: 1.0,
            is_premultiplied: false,
            overlay: None,
            mask: None,
            backdrop: None,
            is_mask_overlay: false,
            wraps: false,
        }
    }
}

/// Which of the engine's two document-sized scratch targets a blend goes
/// through on its way to the target.
#[derive(Clone, Copy)]
pub(crate) enum Scratch {
    A,
    B,
}

/// Blend `source` over `target` with `program` (a `blend.glsl` variant). The
/// shader reads the target, so the result is drawn into a scratch and copied
/// back. With `clip`, both passes only touch that rectangle. Returns `false`,
/// leaving the target as it was, if a texture no longer exists.
pub(crate) fn blend_through_scratch(
    engine: &EngineInner,
    program: &ShaderProgram,
    source: &BlendSource,
    target: DocTarget,
    scratch: Scratch,
    clip: Option<Rect>,
) -> bool {
    let (scratch_tex, scratch_fbo) = match scratch {
        Scratch::A => (engine.scratch_texture_a, engine.scratch_fbo_a),
        Scratch::B => (engine.scratch_texture_b, engine.scratch_fbo_b),
    };
    let scissor = clip.map_or(Scissor::Off, Scissor::Rect);

    let mut pass = doc_pass_untyped(engine, program)
        .scissor(scissor)
        .texture("u_srcTex", source.texture)
        .texture("u_dstTex", target.tex)
        .f32("u_opacity", source.opacity)
        .i32("u_hasBrushTexture", 0)
        .vec2("u_srcOffset", source.offset.0, source.offset.1)
        .vec2("u_srcSize", source.size.0, source.size.1)
        .vec2("u_docSize", engine.doc_width as f32, engine.doc_height as f32)
        .i32("u_srcPremultiplied", i32::from(source.is_premultiplied))
        .i32("u_docColorMode", engine.doc_color_mode as i32)
        .i32("u_wrapLayer", i32::from(source.wraps))
        .i32("u_maskOverlay", i32::from(source.is_mask_overlay));
    pass = match source.overlay {
        Some(overlay) => pass
            .i32("u_overlayEnabled", 1)
            .vec3("u_overlayColor", overlay.color[0], overlay.color[1], overlay.color[2])
            .f32("u_overlayOpacity", overlay.opacity),
        None => pass.i32("u_overlayEnabled", 0),
    };
    // A sampler the draw does not read must still not point at a unit that
    // holds the render target, so the unused ones share the source's unit.
    let mut units = 2;
    pass = match source.mask {
        Some(mask) => {
            units += 1;
            pass.texture("u_maskTex", mask.texture)
                .i32("u_hasMask", 1)
                .vec2("u_maskSize", mask.width as f32, mask.height as f32)
                .vec2("u_maskOffset", mask.offset_x, mask.offset_y)
        }
        None => pass.i32("u_maskTex", 0).i32("u_hasMask", 0),
    };
    pass = match source.backdrop {
        Some(backdrop) => {
            units += 1;
            pass.texture("u_backdropTex", backdrop).i32("u_hasBackdrop", 1)
        }
        None => pass.i32("u_backdropTex", 0).i32("u_hasBackdrop", 0),
    };
    if !pass.draw(Target::Framebuffer(scratch_fbo)) {
        return false;
    }

    // The target must leave its sampler unit before it is drawn into. The
    // mask and backdrop go too: a texture left on a unit outlives its layer,
    // and once the pool hands it to a new owner a later draw into it by any
    // blend program still pointing at that unit is a feedback loop that
    // WebGL drops without writing anything (#1414).
    engine.gpu().unbind_textures(units);
    copy_doc(engine, scratch_tex, target.fbo, scissor);
    true
}

/// Whether layers tile across the document (seamless pattern with wrap).
fn layers_wrap(engine: &EngineInner) -> bool {
    engine.seamless_pattern && engine.seamless_wrap
}

/// Blend a layer-like source onto `target` using the blend shader variant
/// specialized for `blend_mode`.
fn blend_onto_target(
    engine: &EngineInner,
    source: &BlendSource,
    blend_mode: i32,
    target: DocTarget,
    clip: Option<Rect>,
) -> Result<(), String> {
    let program = engine.shaders.blend_for_mode(blend_mode)?;
    let source = BlendSource { wraps: layers_wrap(engine), ..*source };
    blend_through_scratch(engine, &program, &source, target, Scratch::A, clip);
    Ok(())
}

/// `blend_onto_target` for the live compositor, touching only the source's
/// rectangle (clipped to the document). Outside it the blend shader returns
/// the destination texel unchanged, so skipping those texels gives the same
/// target as a full-document pass, at the cost of the layer's area instead
/// of the document's. With seamless wrap on the layer can land anywhere, so
/// the full pass runs.
fn blend_layer_rect_onto_target(
    engine: &EngineInner,
    source: &BlendSource,
    blend_mode: i32,
    target: DocTarget,
) -> Result<(), String> {
    if layers_wrap(engine) {
        return blend_onto_target(engine, source, blend_mode, target, None);
    }
    let x0 = source.offset.0.floor() as i32;
    let y0 = source.offset.1.floor() as i32;
    let x1 = (source.offset.0 + source.size.0).ceil() as i32;
    let y1 = (source.offset.1 + source.size.1).ceil() as i32;
    let rect = Rect::new(x0, y0, (x1 - x0).max(0) as u32, (y1 - y0).max(0) as u32);
    let Some(clip) = fx_extent::clip_to_document(rect, engine.doc_width, engine.doc_height) else {
        return Ok(());
    };
    blend_onto_target(engine, source, blend_mode, target, Some(clip))
}

/// One open adjusted-group accumulation on the compositor's group stack.
/// `skip == true` means this group's content was restored directly from
/// its pre-adjustment cache (its children were not re-rendered this frame).
struct GroupFrame {
    id: String,
    target: DocTarget,
    skip: bool,
}

/// Get (allocating or resizing on demand) the persistent scratch
/// (texture, FBO) pair for nesting depth `depth`, cleared to transparent.
/// Depth 0 is the outermost currently-open adjusted group; a group nested
/// inside another gets the next depth's scratch instead of colliding with
/// its ancestor's (#857).
fn acquire_group_scratch_level(engine: &mut EngineInner, depth: usize) -> Result<DocTarget, String> {
    let doc_w = engine.doc_width;
    let doc_h = engine.doc_height;
    while engine.group_scratch_levels.len() <= depth {
        let tex = engine.texture_pool.acquire(doc_w, doc_h)?;
        let fbo = engine.fbo_pool.create()?;
        if let Some(gl_tex) = engine.texture_pool.get(tex).cloned() {
            engine.fbo_pool.attach_texture(fbo, &gl_tex);
        }
        engine.group_scratch_levels.push((tex, fbo));
    }
    let (mut tex, fbo) = engine.group_scratch_levels[depth];
    if engine.texture_pool.get_size(tex) != Some((doc_w, doc_h)) {
        engine.texture_pool.release(tex);
        tex = engine.texture_pool.acquire(doc_w, doc_h)?;
        if let Some(gl_tex) = engine.texture_pool.get(tex).cloned() {
            engine.fbo_pool.attach_texture(fbo, &gl_tex);
        }
        engine.group_scratch_levels[depth] = (tex, fbo);
    }
    Ok(DocTarget { tex, fbo })
}

/// Clear a scratch target to transparent.
fn clear_target(engine: &EngineInner, target: DocTarget) {
    engine.gpu().clear(target.tex, TRANSPARENT);
}

/// Get (allocating or resizing on demand) the persistent pre-adjustment
/// cache texture for `group_id`.
fn get_or_create_pre_adj_cache(engine: &mut EngineInner, group_id: &str) -> Result<TextureHandle, String> {
    let doc_w = engine.doc_width;
    let doc_h = engine.doc_height;
    if let Some(&tex) = engine.group_pre_adj_cache.get(group_id) {
        if engine.texture_pool.get_size(tex) == Some((doc_w, doc_h)) {
            return Ok(tex);
        }
        engine.texture_pool.release(tex);
        engine.group_pre_adj_cache.remove(group_id);
    }
    let tex = engine.texture_pool.acquire(doc_w, doc_h)?;
    engine.group_pre_adj_cache.insert(group_id.to_string(), tex);
    Ok(tex)
}

/// Copy a group's freshly-composited children into its persistent
/// pre-adjustment cache, so a later frame that only changes adjustment
/// values (not children) can restore from it instead of re-blending.
fn refresh_pre_adj_cache(engine: &mut EngineInner, group_id: &str, src_tex: TextureHandle) {
    let Ok(cache_tex) = get_or_create_pre_adj_cache(engine, group_id) else {
        return;
    };
    engine
        .pass(&engine.shaders.blit, ())
        .blend(Blend::Off)
        .texture("u_tex", src_tex)
        .draw(Target::Texture(cache_tex));
}

/// A copy of `target` taken before a non-Normal layer draws its behind
/// effects, for its blend to read as the backdrop (`u_backdropTex` in
/// `blend.glsl`). Normal needs none: its result doesn't depend on the
/// backdrop's colour. The caller releases the texture.
fn capture_effect_backdrop(engine: &mut EngineInner, blend_mode: i32, has_behind_effects: bool, target: DocTarget) -> Option<TextureHandle> {
    if blend_mode == 0 || !has_behind_effects {
        return None;
    }
    let copy = engine.texture_pool.acquire(engine.doc_width, engine.doc_height).ok()?;
    let is_copied = engine
        .pass(&engine.shaders.blit, ())
        .blend(Blend::Off)
        .texture("u_tex", target.tex)
        .draw(Target::Texture(copy));
    if !is_copied {
        engine.texture_pool.release(copy);
        return None;
    }
    Some(copy)
}

/// Restore a group's cached pre-adjustment pixels into its live scratch
/// target, skipping re-rendering of its children.
fn restore_pre_adj_cache(engine: &EngineInner, cache_tex: TextureHandle, target: DocTarget) {
    copy_doc(engine, cache_tex, target.fbo, Scissor::Off);
}

/// Render the mask as a translucent blue overlay on top of the composite.
/// Used during mask edit mode so the user can see what's under the mask.
fn render_mask_overlay(engine: &EngineInner, mask: MaskRef) {
    let source = BlendSource {
        is_mask_overlay: true,
        ..BlendSource::new(mask.texture, (mask.offset_x, mask.offset_y), (mask.width as f32, mask.height as f32))
    };
    blend_through_scratch(engine, &engine.shaders.blend_normal, &source, main_target(engine), Scratch::A, None);
}

/// Draw the mask edit overlay for `mask_edit_id` if that layer is routed
/// (directly or through nested adjusted groups, #857) into `group_id`.
fn render_routed_mask_edit_overlay(
    engine: &mut EngineInner,
    mask_edit_id: Option<&str>,
    group_id: &str,
    child_to_group: &HashMap<String, String>,
) {
    let Some(edit_id) = mask_edit_id else { return };
    let mut parent = child_to_group.get(edit_id);
    while let Some(gid) = parent {
        if gid == group_id {
            break;
        }
        parent = child_to_group.get(gid);
    }
    if parent.is_none() {
        return;
    }
    let Some(layer) = engine.layer_stack.iter().find(|l| l.id == edit_id) else { return };
    if !layer.visible || layer.opacity < 1e-7 {
        return;
    }
    let (offset_x, offset_y) = mask_doc_offset(layer.layer_type, layer.x as f32, layer.y as f32);
    let Some(mask) = live_mask(engine, edit_id, offset_x, offset_y) else { return };
    render_mask_overlay(engine, mask);
}

/// Render the quick mask as a translucent blue overlay on top of the composite.
/// Blue covers unselected areas (mask=0), selected areas (mask=255) are clear.
fn render_quick_mask_overlay(engine: &EngineInner) {
    let Some(texture) = engine.quick_mask_texture else { return };
    let (width, height) = engine.texture_pool.get_size(texture).unwrap_or((engine.doc_width, engine.doc_height));
    render_mask_overlay(engine, MaskRef { texture, width, height, offset_x: 0.0, offset_y: 0.0 });
}

/// Render (layer + pending stroke) into a scratch texture via the
/// source-over composite shader, matching what `end_stroke` will bake into
/// the layer. Returns the merged texture handle (caller must release), or
/// `None` if the stroke texture size doesn't match the layer.
fn render_layer_plus_stroke(
    engine: &mut EngineInner,
    layer_handle: TextureHandle,
    stroke_handle: TextureHandle,
    tw: u32,
    th: u32,
) -> Option<TextureHandle> {
    if engine.texture_pool.get_size(stroke_handle).map_or(true, |(w, h)| w != tw || h != th) {
        return None;
    }
    engine.texture_pool.get(layer_handle)?;
    engine.texture_pool.get(stroke_handle)?;
    let merged = engine.texture_pool.acquire(tw, th).ok()?;

    let is_drawn = engine
        .pass_untyped(&engine.shaders.composite)
        .blend(Blend::Off)
        .texture("u_srcTex", stroke_handle)
        .texture("u_dstTex", layer_handle)
        .f32("u_opacity", 1.0)
        .vec2("u_strokeTexSize", tw as f32, th as f32)
        .draw(Target::Texture(merged));
    engine.gpu().unbind_textures(2);
    if !is_drawn {
        engine.texture_pool.release(merged);
        return None;
    }
    Some(merged)
}

/// Copy `src_handle` with the layer mask multiplied into its alpha, for the
/// effect passes. Glow, shadow and stroke read the layer's alpha to build
/// their outline, so without this they traced pixels the mask hides (#977).
/// Returns a pooled texture the caller releases, or `None` on failure.
fn render_layer_masked_for_effects(
    engine: &mut EngineInner,
    src_handle: TextureHandle,
    tw: u32,
    th: u32,
    layer_x: f32,
    layer_y: f32,
    mask: MaskRef,
) -> Option<TextureHandle> {
    engine.texture_pool.get(src_handle)?;
    let masked = engine.texture_pool.acquire(tw, th).ok()?;

    let is_drawn = engine
        .pass_untyped(&engine.shaders.layer_mask_apply)
        .blend(Blend::Off)
        .texture("u_srcTex", src_handle)
        .texture("u_maskTex", mask.texture)
        .vec2("u_layerOffset", layer_x, layer_y)
        .vec2("u_layerSize", tw as f32, th as f32)
        .vec2("u_maskOffset", mask.offset_x, mask.offset_y)
        .vec2("u_maskSize", mask.width as f32, mask.height as f32)
        .draw(Target::Texture(masked));
    engine.gpu().unbind_textures(2);
    if !is_drawn {
        engine.texture_pool.release(masked);
        return None;
    }
    Some(masked)
}

/// A texture holding a layer's silhouette, placed at (`x`, `y`) in document
/// pixels.
#[derive(Clone, Copy)]
struct EffectSource {
    handle: TextureHandle,
    x: f32,
    y: f32,
    width: u32,
    height: u32,
}

/// Render the effects drawn behind the layer, in order: outer glow, drop
/// shadow, then an outside Stroke (inside and centre strokes are drawn on
/// top of the layer by the caller). The glow and shadow are cast by
/// everything the layer shows, so an outside or centre Stroke grows the
/// silhouette they are built from; built from the layer's pixels alone, the
/// shadow started inside the outline and peeked out past it with a notch at
/// the corner, and the glow sat under the stroke. The outside stroke itself
/// runs under the layer's anti-aliased edge and is knocked out by the
/// layer's coverage, so no backdrop seam shows between shape and outline.
/// Live compositing, export and Rasterize Layer Style all come through here.
fn render_behind_effects(
    engine: &mut EngineInner,
    src: EffectSource,
    outer_glow: Option<&GlowDesc>,
    drop_shadow: Option<&ShadowDesc>,
    stroke: Option<&StrokeDesc>,
    layer_opacity: f32,
    out: &mut EffectOut,
) {
    if outer_glow.is_some() || drop_shadow.is_some() {
        let stroked = stroke.and_then(|s| render_stroke_silhouette(engine, src, s));
        let cast = stroked.unwrap_or(src);
        if let Some(glow) = outer_glow {
            render_glow(engine, cast.handle, cast.width, cast.height, glow, 0, cast.x, cast.y, out);
        }
        if let Some(shadow) = drop_shadow {
            render_shadow(engine, cast.handle, cast.width, cast.height, shadow, cast.x, cast.y, layer_opacity, out);
        }
        if let Some(s) = stroked {
            engine.texture_pool.release(s.handle);
        }
    }
    if let Some(stroke) = stroke.filter(|s| is_behind_stroke(s)) {
        render_stroke(engine, src.handle, src.width, src.height, stroke, src.x, src.y, layer_opacity, out);
    }
}

/// Render `src`'s alpha grown by the part of `stroke` outside the layer
/// into a pooled texture covering the layer plus the stroke's reach — not
/// the document, so a layer hanging off the canvas still casts its whole
/// shadow. Uses the same two algorithms `render_stroke` picks between, so
/// the silhouette matches the drawn ring. Returns `None` (cast from `src`)
/// when the stroke adds nothing outside the layer or a texture can't be had.
fn render_stroke_silhouette(engine: &mut EngineInner, src: EffectSource, stroke: &StrokeDesc) -> Option<EffectSource> {
    let reach = stroke.outside_reach()?;
    let rect = lopsy_core::layer::stroke_silhouette_rect(
        lopsy_core::layer::DocRect { x: src.x, y: src.y, width: src.width, height: src.height },
        reach,
    );
    engine.texture_pool.get(src.handle)?;
    let out = engine.texture_pool.acquire(rect.width, rect.height).ok()?;
    let frame = SilhouetteFrame { src: src.handle, src_w: src.width, src_h: src.height, pad_x: src.x - rect.x, pad_y: src.y - rect.y, w: rect.width, h: rect.height };

    // Units 0 and 1 may hold a texture the pool just handed back as `out`.
    engine.gpu().unbind_textures(2);
    let result = silhouette_by_band(engine, &frame, stroke, reach, out);
    engine.gpu().unbind_textures(2);

    match result {
        Some(handle) => Some(EffectSource { handle, x: rect.x, y: rect.y, width: rect.width, height: rect.height }),
        None => {
            engine.texture_pool.release(out);
            None
        }
    }
}

/// The source layer and the padded region a silhouette is rendered into.
struct SilhouetteFrame {
    src: TextureHandle,
    src_w: u32,
    src_h: u32,
    /// The layer's offset inside the region.
    pad_x: f32,
    pad_y: f32,
    w: u32,
    h: u32,
}

fn stroke_position_index(stroke: &StrokeDesc) -> i32 {
    match stroke.position {
        lopsy_core::layer::StrokePosition::Outside => 0,
        lopsy_core::layer::StrokePosition::Inside => 1,
        lopsy_core::layer::StrokePosition::Center => 2,
    }
}

/// Stroke silhouette: extract alpha, the two-pass Euclidean band
/// (`separable_edt.glsl`), then `stroke_apply.glsl` folds the ring into the
/// layer's alpha. Ping-pongs
/// between `out` and one more pooled texture; returns whichever holds the
/// result and releases the other.
fn silhouette_by_band(
    engine: &mut EngineInner,
    frame: &SilhouetteFrame,
    stroke: &StrokeDesc,
    reach: f32,
    out: TextureHandle,
) -> Option<TextureHandle> {
    let tmp = engine.texture_pool.acquire(frame.w, frame.h).ok()?;
    if engine.texture_pool.get(out).is_none() || engine.texture_pool.get(tmp).is_none() {
        engine.texture_pool.release(tmp);
        return None;
    }
    let (fw, fh) = (frame.w as f32, frame.h as f32);

    // Layer alpha placed in the padded region → out.
    alpha_extract_pass(engine, frame.src, (frame.pad_x, frame.pad_y), (frame.src_w as f32, frame.src_h as f32), (fw, fh), false)
        .draw(Target::Texture(out));

    // Euclidean band: out → tmp (rows) → out (columns).
    for (read, write, pass) in [(out, tmp, StrokeBandPass::Rows), (tmp, out, StrokeBandPass::Columns)] {
        stroke_band_pass(engine, read, pass, reach, false).draw(Target::Texture(write));
    }

    // Band (out) + layer → silhouette (tmp).
    engine
        .pass_untyped(&engine.shaders.stroke_apply)
        .blend(Blend::Off)
        .texture("u_bandTex", out)
        .texture("u_origTex", frame.src)
        .vec4("u_strokeColor", stroke.color[0], stroke.color[1], stroke.color[2], stroke.color[3])
        .f32("u_opacity", stroke.opacity)
        .i32("u_position", 0)
        .vec2("u_origOffset", frame.pad_x, frame.pad_y)
        .vec2("u_origSize", frame.src_w as f32, frame.src_h as f32)
        .vec2("u_docSize", fw, fh)
        .i32("u_silhouette", 1)
        // An outside ring covers the anti-aliased edge here just as when drawn.
        .i32("u_knockout", is_behind_stroke(stroke) as i32)
        .f32("u_layerOpacity", 1.0)
        .draw(Target::Texture(tmp));

    engine.texture_pool.release(out);
    Some(tmp)
}

/// The layer's alpha (inverted with `invert`) at its place in a region of
/// `region_size`, through `glow.glsl`'s raw-alpha mode.
fn alpha_extract_pass<'a>(
    engine: &'a EngineInner,
    layer: TextureHandle,
    offset: (f32, f32),
    size: (f32, f32),
    region_size: (f32, f32),
    invert: bool,
) -> Pass<'a> {
    engine
        .pass_untyped(&engine.shaders.glow)
        .blend(Blend::Off)
        .texture("u_srcTex", layer)
        .i32("u_origTex", 0)
        .vec2("u_srcOffset", offset.0, offset.1)
        .vec2("u_srcSize", size.0, size.1)
        .vec2("u_docSize", region_size.0, region_size.1)
        .i32("u_rawAlpha", 1)
        .i32("u_mode", i32::from(invert))
        .i32("u_hasOrigTex", 0)
}

/// Blur the alpha in scratch B with a separable Gaussian, through scratch A.
fn blur_scratch_b(engine: &EngineInner, blur_radius: u32) {
    let r = blur_radius.min(63);
    let kernel = lopsy_core::filters::blur::gaussian_kernel(r);
    // Half-kernel from the centre out: weights[0] is the centre and
    // weights[i] the tap at offset ±i.
    let mut weights = [0.0f32; 64];
    for (i, weight) in weights.iter_mut().enumerate() {
        *weight = kernel.get(r as usize + i).copied().unwrap_or(0.0);
    }
    let steps = [
        (engine.scratch_texture_b, engine.scratch_fbo_a, (1.0, 0.0)),
        (engine.scratch_texture_a, engine.scratch_fbo_b, (0.0, 1.0)),
    ];
    for (read, write, direction) in steps {
        doc_pass_untyped(engine, &engine.shaders.gaussian_blur)
            .texture("u_tex", read)
            .i32("u_radius", r as i32)
            .f32_array("u_weights[0]", &weights)
            .vec2("u_direction", direction.0, direction.1)
            .draw(Target::Framebuffer(write));
    }
}

/// A `glow.glsl` pass over the document with `source` as its input and every
/// uniform but the raw-alpha and masking switches set from `glow`.
fn glow_pass<'a>(engine: &'a EngineInner, source: TextureHandle, glow: &GlowDesc, mode: i32, tw: u32, th: u32, layer_x: f32, layer_y: f32) -> Pass<'a> {
    doc_pass_untyped(engine, &engine.shaders.glow)
        .texture("u_srcTex", source)
        .vec4("u_glowColor", glow.color[0], glow.color[1], glow.color[2], glow.color[3])
        .f32("u_size", glow.size)
        .f32("u_spread", glow.spread)
        .f32("u_opacity", glow.opacity)
        .vec2("u_texelSize", 1.0 / tw as f32, 1.0 / th as f32)
        .vec2("u_srcOffset", layer_x, layer_y)
        .vec2("u_srcSize", tw as f32, th as f32)
        .vec2("u_docSize", engine.doc_width as f32, engine.doc_height as f32)
        .i32("u_mode", mode)
}

/// Render outer or inner glow.
fn render_glow(engine: &mut EngineInner, tex_handle: TextureHandle, tw: u32, th: u32, glow: &GlowDesc, mode: i32, layer_x: f32, layer_y: f32, out: &mut EffectOut) {
    let blur_radius = glow.size.ceil() as u32;
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }
    let scratch_a = Target::Framebuffer(engine.scratch_fbo_a);
    let scratch_b = Target::Framebuffer(engine.scratch_fbo_b);

    if blur_radius < 2 {
        // Small size: single pass, no separable blur needed
        glow_pass(engine, tex_handle, glow, mode, tw, th, layer_x, layer_y)
            .i32("u_origTex", 0)
            .i32("u_rawAlpha", 0)
            .i32("u_hasOrigTex", 0)
            .clear(TRANSPARENT)
            .draw(scratch_a);
    } else {
        // Phase 1: extract raw alpha (outer) or inverted alpha (inner) → scratch_b
        glow_pass(engine, tex_handle, glow, mode, tw, th, layer_x, layer_y)
            .i32("u_origTex", 0)
            .i32("u_rawAlpha", 1)
            .i32("u_hasOrigTex", 0)
            .clear(TRANSPARENT)
            .draw(scratch_b);

        // Phase 2: separable Gaussian blur
        blur_scratch_b(engine, blur_radius);

        // Phase 3: apply spread + masking + color → scratch_a. The blurred
        // alpha in scratch_b is a document-sized source; the original layer
        // masks it through u_origTex.
        glow_pass(engine, engine.scratch_texture_b, glow, mode, tw, th, layer_x, layer_y)
            .texture("u_origTex", tex_handle)
            .i32("u_hasOrigTex", 1)
            .vec2("u_origOffset", layer_x, layer_y)
            .vec2("u_origSize", tw as f32, th as f32)
            .vec2("u_srcOffset", 0.0, 0.0)
            .vec2("u_srcSize", engine.doc_width as f32, engine.doc_height as f32)
            .i32("u_rawAlpha", 0)
            .clear(TRANSPARENT)
            .draw(scratch_a);
        engine.gpu().unbind_textures(2);
    }

    let src_rect = Rect::new(layer_x as i32, layer_y as i32, tw, th);
    emit_effect(engine, out, || if mode == 0 { fx_extent::outer_glow_extent(src_rect, glow) } else { fx_extent::inner_glow_extent(src_rect) });
}

/// A `shadow.glsl` pass over the document with `source` as its input and
/// every uniform but the knockout and raw-alpha switches set from `shadow`.
fn shadow_pass<'a>(engine: &'a EngineInner, source: TextureHandle, shadow: &ShadowDesc, tw: u32, th: u32, layer_x: f32, layer_y: f32) -> Pass<'a> {
    doc_pass_untyped(engine, &engine.shaders.shadow)
        .texture("u_srcTex", source)
        .vec4("u_shadowColor", shadow.color[0], shadow.color[1], shadow.color[2], shadow.color[3])
        .vec2("u_offset", shadow.offset_x, shadow.offset_y)
        .f32("u_spread", shadow.spread)
        .f32("u_opacity", shadow.opacity)
        .vec2("u_texelSize", 1.0 / tw as f32, 1.0 / th as f32)
        .vec2("u_srcOffset", layer_x, layer_y)
        .vec2("u_srcSize", tw as f32, th as f32)
        .vec2("u_docSize", engine.doc_width as f32, engine.doc_height as f32)
}

/// Render drop shadow.
fn render_shadow(engine: &mut EngineInner, tex_handle: TextureHandle, tw: u32, th: u32, shadow: &ShadowDesc, layer_x: f32, layer_y: f32, layer_opacity: f32, out: &mut EffectOut) {
    let blur_radius = shadow.blur.ceil() as u32;
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }
    let scratch_a = Target::Framebuffer(engine.scratch_fbo_a);
    let scratch_b = Target::Framebuffer(engine.scratch_fbo_b);

    if blur_radius == 0 {
        // No blur: single pass with spread + knockout + color → scratch_a
        shadow_pass(engine, tex_handle, shadow, tw, th, layer_x, layer_y)
            .i32("u_knockout", 1)
            .f32("u_layerOpacity", layer_opacity)
            .i32("u_rawAlpha", 0)
            .clear(TRANSPARENT)
            .draw(scratch_a);
    } else {
        // Phase 1: extract raw alpha silhouette → scratch_b
        shadow_pass(engine, tex_handle, shadow, tw, th, layer_x, layer_y)
            .i32("u_knockout", 0)
            .i32("u_rawAlpha", 1)
            .clear(TRANSPARENT)
            .draw(scratch_b);

        // Phase 2: separable Gaussian blur
        blur_scratch_b(engine, blur_radius);

        // Phase 3: apply spread + color to blurred alpha → scratch_a. The
        // blurred alpha in scratch_b is a document-sized source that already
        // carries the shadow's offset.
        shadow_pass(engine, engine.scratch_texture_b, shadow, tw, th, layer_x, layer_y)
            .vec2("u_srcOffset", 0.0, 0.0)
            .vec2("u_srcSize", engine.doc_width as f32, engine.doc_height as f32)
            .vec2("u_offset", 0.0, 0.0)
            .i32("u_knockout", 0)
            .i32("u_rawAlpha", 0)
            .clear(TRANSPARENT)
            .draw(scratch_a);
    }

    let src_rect = Rect::new(layer_x as i32, layer_y as i32, tw, th);
    emit_effect(engine, out, || fx_extent::drop_shadow_extent(src_rect, shadow));
}

/// Render stroke effect using proper hard-edge distance check.
/// Outside strokes are composited behind their layer (after the drop shadow),
/// inside and center strokes on top of it.
fn is_behind_stroke(stroke: &StrokeDesc) -> bool {
    stroke.position == lopsy_core::layer::StrokePosition::Outside
}

fn render_stroke(engine: &mut EngineInner, tex_handle: TextureHandle, tw: u32, th: u32, stroke: &StrokeDesc, layer_x: f32, layer_y: f32, layer_opacity: f32, out: &mut EffectOut) {
    let position = stroke_position_index(stroke);
    let src_rect = Rect::new(layer_x as i32, layer_y as i32, tw, th);
    let half_w = if position == 2 { stroke.width * 0.5 } else { stroke.width };

    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }
    let layer = StrokeLayer { texture: tex_handle, x: layer_x, y: layer_y, width: tw, height: th, opacity: layer_opacity };

    // Every width goes through the two-pass Euclidean band, O(r) per pixel
    // per pass. Narrow strokes used a single-pass brute-force search
    // (stroke_edt.glsl) that drew nothing on NVIDIA under ANGLE/Vulkan
    // (#1640); the band gives the same pixels (lopsy-core stroke_band tests).
    // For center strokes, handle outside and inside halves separately.
    // Outside: band around the opaque pixels → stroke where in band && !original
    // Inside: band around the transparent pixels → stroke where in band && original

    let do_outside = position == 0 || position == 2;
    let do_inside = position == 1 || position == 2;
    let is_inside_only = do_inside && !do_outside;

    // Extract alpha → scratch_b (or inverted alpha for inside-only)
    render_stroke_extract_alpha(engine, &layer, is_inside_only);

    // scratch_b → scratch_a → scratch_b. For inverted alpha (inner
    // stroke), texels beyond the edge are "outside the layer": seeds.
    render_stroke_band(engine, half_w, is_inside_only);

    // Apply stroke: read band (scratch_b) + original → scratch_a
    render_stroke_apply(engine, &layer, stroke, i32::from(is_inside_only), is_behind_stroke(stroke));

    // For center stroke: also need the inside half
    if do_outside && do_inside {
        // First half (outside) is in scratch_a, blend it onto composite
        emit_effect(engine, out, || fx_extent::stroke_extent(src_rect, stroke));

        // Now do inside half: extract inverted alpha, band, apply
        render_stroke_extract_alpha(engine, &layer, true);
        render_stroke_band(engine, half_w, true);
        render_stroke_apply(engine, &layer, stroke, 1, false);
    }

    emit_effect(engine, out, || fx_extent::stroke_extent(src_rect, stroke));
}

/// The layer a stroke is traced around.
struct StrokeLayer {
    texture: TextureHandle,
    x: f32,
    y: f32,
    width: u32,
    height: u32,
    /// Opacity the layer itself is composited with.
    opacity: f32,
}

/// Layer alpha (inverted for an inside stroke) at the layer's position →
/// scratch_b.
fn render_stroke_extract_alpha(engine: &EngineInner, layer: &StrokeLayer, invert: bool) {
    let doc = (engine.doc_width as f32, engine.doc_height as f32);
    alpha_extract_pass(engine, layer.texture, (layer.x, layer.y), (layer.width as f32, layer.height as f32), doc, invert)
        .viewport(0, 0, engine.doc_width as i32, engine.doc_height as i32)
        .clear(TRANSPARENT)
        .draw(Target::Framebuffer(engine.scratch_fbo_b));
}

#[derive(Clone, Copy)]
enum StrokeBandPass {
    Rows,
    Columns,
}

/// One `separable_edt.glsl` pass of the band within `reach` of the seeds
/// (texels with alpha ≥ 0.5) in `read`.
fn stroke_band_pass<'a>(engine: &'a EngineInner, read: TextureHandle, pass: StrokeBandPass, reach: f32, is_oob_seed: bool) -> Pass<'a> {
    engine
        .pass_untyped(&engine.shaders.separable_edt)
        .blend(Blend::Off)
        .texture("u_tex", read)
        .i32("u_pass", matches!(pass, StrokeBandPass::Columns) as i32)
        .i32("u_radius", lopsy_core::stroke_band::search_radius(reach) as i32)
        .f32("u_reachSq", reach * reach)
        .i32("u_oobSeed", is_oob_seed as i32)
}

/// Replace the seed alpha in scratch_b with the band within `reach` of it
/// (alpha 1 inside, 0 outside), going through scratch_a.
fn render_stroke_band(engine: &EngineInner, reach: f32, is_oob_seed: bool) {
    let passes = [
        (engine.scratch_texture_b, engine.scratch_fbo_a, StrokeBandPass::Rows),
        (engine.scratch_texture_a, engine.scratch_fbo_b, StrokeBandPass::Columns),
    ];
    for (read, write, pass) in passes {
        stroke_band_pass(engine, read, pass, reach, is_oob_seed)
            .viewport(0, 0, engine.doc_width as i32, engine.doc_height as i32)
            .draw(Target::Framebuffer(write));
    }
}

/// Band (scratch_b) + the original layer → the coloured stroke in scratch_a.
fn render_stroke_apply(engine: &EngineInner, layer: &StrokeLayer, stroke: &StrokeDesc, apply_position: i32, knockout: bool) {
    doc_pass_untyped(engine, &engine.shaders.stroke_apply)
        .texture("u_bandTex", engine.scratch_texture_b)
        .texture("u_origTex", layer.texture)
        .vec4("u_strokeColor", stroke.color[0], stroke.color[1], stroke.color[2], stroke.color[3])
        .f32("u_opacity", stroke.opacity)
        .i32("u_position", apply_position)
        .i32("u_knockout", knockout as i32)
        .f32("u_layerOpacity", layer.opacity)
        .vec2("u_origOffset", layer.x, layer.y)
        .vec2("u_origSize", layer.width as f32, layer.height as f32)
        .vec2("u_docSize", engine.doc_width as f32, engine.doc_height as f32)
        .i32("u_silhouette", 0)
        .clear(TRANSPARENT)
        .draw(Target::Framebuffer(engine.scratch_fbo_a));
    engine.gpu().unbind_textures(2);
}

/// Composite every visible layer (with effects and group adjustments) into
/// the composite texture over the background colour. Shared by the 8- and 16-bit export paths; unlike
/// `composite` it has no in-progress stroke / preview handling and no
/// group pre-adjustment cache.
fn composite_layers_for_export(engine: &mut EngineInner) -> Result<(), String> {
    let doc_w = engine.doc_width;
    let doc_h = engine.doc_height;
    let bg = engine.bg_color;
    engine.ensure_scratch_size(doc_w, doc_h)?;

    engine.gpu().clear(engine.composite_texture, bg);

    let child_to_group: HashMap<String, String> = engine.group_adjustments.iter()
        .flat_map(|(gid, ga)| ga.child_ids.iter().map(move |cid| (cid.clone(), gid.clone())))
        .collect();
    // No pre-adjustment cache here (export is a one-shot render, not a
    // per-frame loop), but nested adjusted groups still need their own
    // scratch per depth rather than colliding on a single slot (#857).
    let mut group_stack: Vec<GroupFrame> = Vec::new();

    let layer_info: Vec<_> = engine.layer_stack.iter().map(|layer| {
        let (mask_offset_x, mask_offset_y) = mask_doc_offset(layer.layer_type, layer.x as f32, layer.y as f32);
        let is_mask_enabled = layer.mask.as_ref().map_or(false, |m| m.enabled);
        let mask_info = live_mask(engine, &layer.id, mask_offset_x, mask_offset_y).filter(|_| is_mask_enabled);
        (layer.id.clone(), layer.layer_type, layer.visible, layer.opacity, layer.blend_mode as i32, layer.x as f32, layer.y as f32, layer.width as f32, layer.height as f32, layer.effects.clone(), mask_info)
    }).collect();

    for (layer_id, layer_type, visible, opacity, blend_mode, layer_x, layer_y, layer_w, layer_h, effects, mask_arg) in &layer_info {
        let mask_arg = *mask_arg;
        if !visible || *opacity < 1e-7 {
            if *layer_type == lopsy_core::layer::LayerType::Group
                && group_stack.last().map(|f| f.id.as_str()) == Some(layer_id.as_str())
            {
                group_stack.pop();
            }
            continue;
        }

        if *layer_type == lopsy_core::layer::LayerType::Group {
            if group_stack.last().map(|f| f.id.as_str()) == Some(layer_id.as_str()) {
                let frame = group_stack.pop().expect("checked by the condition above");
                if let Some(ga) = engine.group_adjustments.get(layer_id) {
                    let adj = ga.adjustments.clone();
                    apply_adjustments_to_texture(engine, frame.target, &adj);
                }
                // Same opacity / blend mode / mask handling as the live
                // compositor, so exports match the canvas. Blend onto the
                // new stack top (an ancestor group still open) or the main
                // composite if this group isn't nested inside another.
                let dest = group_stack.last().map(|f| f.target).unwrap_or_else(|| main_target(engine));
                let source = BlendSource {
                    opacity: *opacity,
                    mask: mask_arg,
                    ..BlendSource::new(frame.target.tex, (0.0, 0.0), (doc_w as f32, doc_h as f32))
                };
                blend_onto_target(engine, &source, *blend_mode, dest, None)?;
            }
            continue;
        }

        let target = if let Some(gid) = child_to_group.get(layer_id) {
            let top_matches = group_stack.last().map(|f| f.id.as_str()) == Some(gid.as_str());
            if top_matches {
                group_stack.last().unwrap().target
            } else {
                let depth = group_stack.len();
                let scratch_target = acquire_group_scratch_level(engine, depth)?;
                clear_target(engine, scratch_target);
                group_stack.push(GroupFrame { id: gid.clone(), target: scratch_target, skip: false });
                scratch_target
            }
        } else {
            main_target(engine)
        };

        let tex_handle = match engine.layer_textures.get(layer_id) { Some(&h) => h, None => continue };
        let (tw, th) = engine.texture_pool.get_size(tex_handle).unwrap_or((*layer_w as u32, *layer_h as u32));

        let has_shape_effects = [
            effects.outer_glow.as_ref().map(|g| g.enabled),
            effects.inner_glow.as_ref().map(|g| g.enabled),
            effects.drop_shadow.as_ref().map(|d| d.enabled),
            effects.stroke.as_ref().map(|st| st.enabled),
        ].into_iter().any(|e| e == Some(true));
        let masked_effect_handle = match (mask_arg, has_shape_effects) {
            (Some(mask), true) => render_layer_masked_for_effects(engine, tex_handle, tw, th, *layer_x, *layer_y, mask),
            _ => None,
        };
        let fx_handle = masked_effect_handle.unwrap_or(tex_handle);

        let has_behind_effects = effects.outer_glow.as_ref().is_some_and(|g| g.enabled)
            || effects.drop_shadow.as_ref().is_some_and(|d| d.enabled)
            || effects.stroke.as_ref().is_some_and(|st| st.enabled && is_behind_stroke(st));
        let effect_backdrop = capture_effect_backdrop(engine, *blend_mode, has_behind_effects, target);
        render_behind_effects(
            engine,
            EffectSource { handle: fx_handle, x: *layer_x, y: *layer_y, width: tw, height: th },
            effects.outer_glow.as_ref().filter(|g| g.enabled),
            effects.drop_shadow.as_ref().filter(|d| d.enabled),
            effects.stroke.as_ref().filter(|st| st.enabled),
            *opacity,
            &mut EffectOut::direct(target),
        );

        let overlay_desc = effects.color_overlay.as_ref().filter(|o| o.enabled);
        let source = BlendSource {
            opacity: *opacity,
            overlay: overlay_desc,
            mask: mask_arg,
            backdrop: effect_backdrop.filter(|&h| engine.texture_pool.get(h).is_some()),
            ..BlendSource::new(tex_handle, (*layer_x, *layer_y), (tw as f32, th as f32))
        };
        blend_onto_target(engine, &source, *blend_mode, target, None)?;
        if let Some(h) = effect_backdrop {
            engine.texture_pool.release(h);
        }

        if let Some(ref glow) = effects.inner_glow { if glow.enabled { render_glow(engine, fx_handle, tw, th, glow, 1, *layer_x, *layer_y, &mut EffectOut::direct(target)); } }
        if let Some(ref stroke) = effects.stroke { if stroke.enabled && !is_behind_stroke(stroke) { render_stroke(engine, fx_handle, tw, th, stroke, *layer_x, *layer_y, *opacity, &mut EffectOut::direct(target)); } }
        if let Some(masked) = masked_effect_handle {
            engine.texture_pool.release(masked);
        }
    }

    Ok(())
}

/// Composite for export — render to FBO, readPixels
pub fn composite_for_export(engine: &mut EngineInner) -> Result<Vec<u8>, String> {
    let doc_w = engine.doc_width;
    let doc_h = engine.doc_height;
    composite_layers_for_export(engine)?;
    // The export render replaced the live composite (no quick mask, no
    // in-progress strokes), so the next frame must rebuild it rather than
    // only re-present it.
    engine.needs_recomposite = true;

    let mut pixels = engine.gpu().read_rgba(engine.composite_texture, 0, 0, doc_w, doc_h)?;

    // Native modes composite in their own space; every consumer of this buffer
    // (PNG/JPEG encode, eyedropper, e2e pixel probes) expects sRGB, so decode
    // here with the same math final_blit.glsl uses for the screen.
    decode_native_color_mode(engine.doc_color_mode, &mut pixels);
    Ok(pixels)
}

/// In-place decode of a composited RGBA8 buffer out of a native color mode.
/// Mode 0 (RGB, grayscale, indexed) already holds sRGB and is left alone.
pub fn decode_native_color_mode(doc_color_mode: u32, pixels: &mut [u8]) {
    if doc_color_mode == 1 {
        lopsy_core::lab::lab_pixels_to_srgb(pixels);
    }
}

/// Composite for export at 16-bit precision — same pipeline as
/// `composite_for_export` but reads back as u16 RGBA.
pub fn composite_for_export_u16(engine: &mut EngineInner) -> Result<Vec<u16>, String> {
    let doc_w = engine.doc_width;
    let doc_h = engine.doc_height;
    composite_layers_for_export(engine)?;
    engine.needs_recomposite = true;

    apply_image_adjustments(engine);

    let mut pixels = engine.gpu().read_rgba_u16(engine.composite_texture, 0, 0, doc_w, doc_h)?;
    // Lab is stored 8-bit-encoded even in a 16-bit texture, so decoding steps
    // down to bytes and back; the extra precision is in the alpha/geometry, not
    // the encoded Lab channels.
    if engine.doc_color_mode == 1 {
        for px in pixels.chunks_exact_mut(4) {
            let mut rgba8 = [
                (px[0] >> 8) as u8,
                (px[1] >> 8) as u8,
                (px[2] >> 8) as u8,
                (px[3] >> 8) as u8,
            ];
            lopsy_core::lab::lab_pixels_to_srgb(&mut rgba8);
            px[0] = u16::from(rgba8[0]) * 257;
            px[1] = u16::from(rgba8[1]) * 257;
            px[2] = u16::from(rgba8[2]) * 257;
        }
    }

    Ok(pixels)
}

/// Composite a single layer with its effects onto a transparent canvas.
/// Returns (pixels, offsetX, offsetY, width, height) for the rasterized result.
/// Render one layer with its effects onto a transparent document-sized
/// target and read it back.
///
/// With `bake_mask`, the layer's enabled mask is applied the way the live
/// compositor applies it: to the content and, through a masked copy, to the
/// silhouette the effects trace (#977). Merge Down needs that because the
/// upper layer's mask goes away with it. Rasterize Layer Style keeps the
/// mask on the layer, so it bakes the unmasked layer.
pub fn composite_single_layer(engine: &mut EngineInner, layer_id: &str, bake_mask: bool) -> Result<Vec<u8>, String> {
    let doc_w = engine.doc_width;
    let doc_h = engine.doc_height;
    engine.ensure_scratch_size(doc_w, doc_h)?;

    let layer_info = engine.layer_stack.iter().find(|l| l.id == layer_id).map(|layer| {
        let mask_enabled = layer.mask.as_ref().is_some_and(|m| m.enabled);
        (layer.id.clone(), layer.layer_type, layer.opacity, layer.x as f32, layer.y as f32, layer.width as f32, layer.height as f32, layer.effects.clone(), mask_enabled)
    });
    let Some((lid, layer_type, opacity, layer_x, layer_y, layer_w, layer_h, effects, mask_enabled)) = layer_info else {
        return Err(format!("Layer {layer_id} not found"));
    };
    let tex_handle = match engine.layer_textures.get(&lid) { Some(&h) => h, None => return Err("Layer texture not found".to_string()) };
    let (tw, th) = engine.texture_pool.get_size(tex_handle).unwrap_or((layer_w as u32, layer_h as u32));

    let mask_arg = if bake_mask && mask_enabled {
        let (ox, oy) = mask_doc_offset(layer_type, layer_x, layer_y);
        live_mask(engine, &lid, ox, oy)
    } else {
        None
    };

    let has_shape_effects = [
        effects.outer_glow.as_ref().map(|g| g.enabled),
        effects.inner_glow.as_ref().map(|g| g.enabled),
        effects.drop_shadow.as_ref().map(|d| d.enabled),
        effects.stroke.as_ref().map(|st| st.enabled),
    ].into_iter().any(|e| e == Some(true));
    let masked_effect_handle = match (mask_arg, has_shape_effects) {
        (Some(mask), true) => render_layer_masked_for_effects(engine, tex_handle, tw, th, layer_x, layer_y, mask),
        _ => None,
    };
    let fx_handle = masked_effect_handle.unwrap_or(tex_handle);

    // Render into the composite over a transparent background
    let target = main_target(engine);
    clear_target(engine, target);

    // Behind effects
    render_behind_effects(
        engine,
        EffectSource { handle: fx_handle, x: layer_x, y: layer_y, width: tw, height: th },
        effects.outer_glow.as_ref().filter(|g| g.enabled),
        effects.drop_shadow.as_ref().filter(|d| d.enabled),
        effects.stroke.as_ref().filter(|st| st.enabled),
        opacity,
        &mut EffectOut::direct(target),
    );

    // Layer content with color overlay (use Normal blend, not the layer's blend mode)
    let overlay_desc = effects.color_overlay.as_ref().filter(|o| o.enabled);
    let source = BlendSource {
        opacity,
        overlay: overlay_desc,
        mask: mask_arg,
        ..BlendSource::new(tex_handle, (layer_x, layer_y), (tw as f32, th as f32))
    };
    blend_onto_target(engine, &source, 0, target, None)?;

    // On-top effects
    if let Some(ref glow) = effects.inner_glow { if glow.enabled { render_glow(engine, fx_handle, tw, th, glow, 1, layer_x, layer_y, &mut EffectOut::direct(target)); } }
    if let Some(ref stroke) = effects.stroke { if stroke.enabled && !is_behind_stroke(stroke) { render_stroke(engine, fx_handle, tw, th, stroke, layer_x, layer_y, opacity, &mut EffectOut::direct(target)); } }

    if let Some(masked) = masked_effect_handle {
        engine.texture_pool.release(masked);
    }

    let pixels = engine.gpu().read_rgba(engine.composite_texture, 0, 0, doc_w, doc_h)?;

    engine.needs_recomposite = true;
    Ok(pixels)
}

/// Set up the adjustments program for a one-off use outside the
/// compositor (the Brightness / Contrast filter): every adjustment at the
/// identity except the caller's brightness and contrast, from the same list
/// the compositor writes (#1163). The unused LUT samplers are pointed at
/// unit 0, the source texture, so none can alias the render target.
pub(crate) fn standalone_adjustments(pass: Pass<'_>, brightness: f32, contrast: f32, doc_color_mode: u32) -> Pass<'_> {
    let adj = ImageAdjustmentState { contrast, ..Default::default() };
    adjustment_values(pass, &adj, brightness, doc_color_mode)
        .i32("u_curveLut", 0)
        .i32("u_levelsLut", 0)
        .i32("u_gradientLut", 0)
}

fn has_lut(is_enabled: bool, texture: Option<TextureHandle>) -> bool {
    is_enabled && texture.is_some()
}

/// Every non-sampler uniform of `adjustments.glsl`, including the
/// `u_has*` LUT flags, derived from `adj`.
fn adjustment_values<'a>(pass: Pass<'a>, adj: &ImageAdjustmentState, brightness: f32, doc_color_mode: u32) -> Pass<'a> {
    pass
        .i32("u_docColorMode", doc_color_mode as i32)
        .f32("u_brightness", brightness)
        .f32("u_contrast", adj.contrast / 100.0)
        .f32("u_exposure", adj.exposure)
        .f32("u_highlights", adj.highlights)
        .f32("u_shadows", adj.shadows)
        .f32("u_whites", adj.whites)
        .f32("u_blacks", adj.blacks)
        .f32("u_saturation", adj.saturation / 100.0)
        .f32("u_vibrance", adj.vibrance / 100.0)
        // Hue/Saturation
        .f32("u_hue_shift", adj.hue_shift)
        .f32("u_hsl_saturation", adj.hsl_saturation)
        .f32("u_lightness", adj.lightness)
        // Color Balance
        .vec3("u_cb_shadows", adj.cb_shadows[0], adj.cb_shadows[1], adj.cb_shadows[2])
        .vec3("u_cb_midtones", adj.cb_midtones[0], adj.cb_midtones[1], adj.cb_midtones[2])
        .vec3("u_cb_highlights", adj.cb_highlights[0], adj.cb_highlights[1], adj.cb_highlights[2])
        // Photo Filter
        .vec3("u_pf_color", adj.pf_color[0], adj.pf_color[1], adj.pf_color[2])
        .f32("u_pf_density", adj.pf_density)
        .f32("u_pf_luminosity", if adj.pf_preserve_luminosity { 1.0 } else { 0.0 })
        // Black & White
        .f32("u_bw_reds", adj.bw_reds)
        .f32("u_bw_yellows", adj.bw_yellows)
        .f32("u_bw_greens", adj.bw_greens)
        .f32("u_bw_cyans", adj.bw_cyans)
        .f32("u_bw_blues", adj.bw_blues)
        .f32("u_bw_magentas", adj.bw_magentas)
        .f32("u_bw_enabled", if adj.bw_enabled { 1.0 } else { 0.0 })
        // Channel Mixer
        .f32("u_cm_rr", adj.cm_r[0] / 100.0)
        .f32("u_cm_rg", adj.cm_r[1] / 100.0)
        .f32("u_cm_rb", adj.cm_r[2] / 100.0)
        .f32("u_cm_rc", adj.cm_r[3])
        .f32("u_cm_gr", adj.cm_g[0] / 100.0)
        .f32("u_cm_gg", adj.cm_g[1] / 100.0)
        .f32("u_cm_gb", adj.cm_g[2] / 100.0)
        .f32("u_cm_gc", adj.cm_g[3])
        .f32("u_cm_br", adj.cm_b[0] / 100.0)
        .f32("u_cm_bg", adj.cm_b[1] / 100.0)
        .f32("u_cm_bb", adj.cm_b[2] / 100.0)
        .f32("u_cm_bc", adj.cm_b[3])
        .f32("u_cm_enabled", if adj.cm_enabled { 1.0 } else { 0.0 })
        // Invert
        .f32("u_invert", if adj.invert { 1.0 } else { 0.0 })
        // Color Grading
        .f32("u_cg_enabled", if adj.cg_enabled { 1.0 } else { 0.0 })
        .vec4("u_cg_shadows", adj.cg_shadows[0], adj.cg_shadows[1], adj.cg_shadows[2], adj.cg_shadows[3])
        .vec4("u_cg_midtones", adj.cg_midtones[0], adj.cg_midtones[1], adj.cg_midtones[2], adj.cg_midtones[3])
        .vec4("u_cg_highlights", adj.cg_highlights[0], adj.cg_highlights[1], adj.cg_highlights[2], adj.cg_highlights[3])
        .vec4("u_cg_global", adj.cg_global[0], adj.cg_global[1], adj.cg_global[2], adj.cg_global[3])
        .f32("u_cg_exponent", adj.cg_exponent)
        .f32("u_cg_width", adj.cg_width)
        .f32("u_hasLevels", if has_lut(adj.has_levels, adj.levels_texture) { 1.0 } else { 0.0 })
        .f32("u_hasCurves", if has_lut(adj.has_curves, adj.curves_texture) { 1.0 } else { 0.0 })
        .f32("u_hasGradientMap", if has_lut(adj.has_gradient_map, adj.gradient_map_texture) { 1.0 } else { 0.0 })
}

/// A pass over the document that applies `adj` to `source`: every uniform
/// of `adjustments.glsl`, plus the Curves / Levels / Gradient Map LUTs `adj`
/// enables. A LUT sampler that is not in use points at unit 0, the source,
/// so it cannot alias the render target. Returns the pass and how many
/// texture units it bound.
fn adjustments_pass<'a>(engine: &'a EngineInner, source: TextureHandle, adj: &ImageAdjustmentState) -> (Pass<'a>, u32) {
    let mut pass = doc_pass_untyped(engine, &engine.shaders.adjustments).texture("u_tex", source);
    pass = adjustment_values(pass, adj, 0.0, engine.doc_color_mode);
    let mut units = 1;
    let luts = [
        ("u_levelsLut", has_lut(adj.has_levels, adj.levels_texture), adj.levels_texture),
        ("u_curveLut", has_lut(adj.has_curves, adj.curves_texture), adj.curves_texture),
        ("u_gradientLut", has_lut(adj.has_gradient_map, adj.gradient_map_texture), adj.gradient_map_texture),
    ];
    for (name, is_enabled, texture) in luts {
        let live = texture.filter(|&h| is_enabled && engine.texture_pool.get(h).is_some());
        pass = match live {
            Some(lut) => {
                units += 1;
                pass.texture(name, lut)
            }
            None => pass.i32(name, 0),
        };
    }
    (pass, units)
}

/// A pass over the document that applies the vignette to `source`.
fn vignette_pass<'a>(engine: &'a EngineInner, source: TextureHandle, amount: f32) -> Pass<'a> {
    doc_pass_untyped(engine, &engine.shaders.vignette)
        .texture("u_tex", source)
        .f32("u_amount", amount)
        .i32("u_docColorMode", engine.doc_color_mode as i32)
}

/// Returns true if any adjustment in the state is non-default (i.e., would change pixels).
fn has_any_adjustment(adj: &crate::engine::ImageAdjustmentState) -> bool {
    adj.exposure.abs() > 1e-6
        || adj.contrast.abs() > 1e-6
        || adj.highlights.abs() > 1e-6
        || adj.shadows.abs() > 1e-6
        || adj.whites.abs() > 1e-6
        || adj.blacks.abs() > 1e-6
        || adj.saturation.abs() > 1e-6
        || adj.vibrance.abs() > 1e-6
        || adj.has_curves
        || adj.has_levels
        || adj.hue_shift.abs() > 1e-6
        || adj.hsl_saturation.abs() > 1e-6
        || adj.lightness.abs() > 1e-6
        || adj.cb_shadows.iter().any(|v| v.abs() > 1e-6)
        || adj.cb_midtones.iter().any(|v| v.abs() > 1e-6)
        || adj.cb_highlights.iter().any(|v| v.abs() > 1e-6)
        || adj.pf_density > 1e-6
        || adj.bw_enabled
        || adj.cm_enabled
        || adj.invert
        || adj.has_gradient_map
        || adj.cg_enabled
}

/// Apply image adjustments (exposure, contrast, highlights, shadows, whites, blacks)
/// to the composite texture. Renders composite → scratch_a via adjustments shader,
/// then copies scratch_a → composite.
fn apply_image_adjustments(engine: &EngineInner) {
    let has_adjustments = has_any_adjustment(&engine.adjustments);
    let has_vignette = engine.adjustments.vignette.abs() > 1e-6;
    let scratch_a = Target::Framebuffer(engine.scratch_fbo_a);

    if has_adjustments {
        let (pass, units) = adjustments_pass(engine, engine.composite_texture, &engine.adjustments);
        if !pass.draw(scratch_a) {
            return;
        }
        engine.gpu().unbind_textures(units);
        copy_doc(engine, engine.scratch_texture_a, engine.composite_fbo, Scissor::Off);
    }

    if has_vignette {
        if !vignette_pass(engine, engine.composite_texture, engine.adjustments.vignette).draw(scratch_a) {
            return;
        }
        copy_doc(engine, engine.scratch_texture_a, engine.composite_fbo, Scissor::Off);
    }
}

/// Apply `adj` to a document-sized target in place: its texture → scratch_a
/// via the adjustments shader (→ scratch_b via the vignette when there is
/// one), then copied back. Used for per-group adjustments, where the source
/// is the group scratch (transparent background) rather than the composite.
fn apply_adjustments_to_texture(engine: &EngineInner, target: DocTarget, adj: &ImageAdjustmentState) {
    let (pass, units) = adjustments_pass(engine, target.tex, adj);
    if !pass.draw(Target::Framebuffer(engine.scratch_fbo_a)) {
        return;
    }
    engine.gpu().unbind_textures(units);

    let result = if adj.vignette.abs() > 1e-6 {
        vignette_pass(engine, engine.scratch_texture_a, adj.vignette).draw(Target::Framebuffer(engine.scratch_fbo_b));
        engine.scratch_texture_b
    } else {
        engine.scratch_texture_a
    };
    copy_doc(engine, result, target.fbo, Scissor::Off);
}
