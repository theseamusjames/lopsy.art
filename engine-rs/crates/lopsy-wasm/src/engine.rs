use std::collections::{HashMap, HashSet};
use web_sys::WebGl2RenderingContext;

use lopsy_core::geometry::ViewportState;
use lopsy_core::layer::LayerDesc;

use crate::gpu::context::GpuContext;
use crate::gpu::framebuffer::{FramebufferHandle, FramebufferPool};
use crate::gpu::shader::ShaderPrograms;
use crate::gpu::texture_pool::{TextureHandle, TexturePool};

/// Magnetic-lasso state: a precomputed Sobel edge field that the snap
/// routine reads to pull candidate segments toward strong edges. Lifetime
/// is bracketed by `magneticLassoBegin` / `magneticLassoEnd`; in between
/// it lives here so repeated snaps don't recompute the field.
#[derive(Default)]
pub struct MagneticLassoState {
    pub edges: Option<Vec<u8>>,
    pub width: u32,
    pub height: u32,
}

impl MagneticLassoState {
    pub fn clear(&mut self) {
        self.edges = None;
        self.width = 0;
        self.height = 0;
    }
}

/// Per-document image adjustments applied on the compositor's final pass.
/// Scalars plus optional LUT textures for curves and levels. Values here
/// don't touch pixel data — they're read by the compositor each frame.
pub struct ImageAdjustmentState {
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub vignette: f32,
    pub saturation: f32,
    pub vibrance: f32,
    pub curves_texture: Option<TextureHandle>,
    pub has_curves: bool,
    pub levels_rgb: [f32; 5],
    pub levels_r: [f32; 5],
    pub levels_g: [f32; 5],
    pub levels_b: [f32; 5],
    pub levels_texture: Option<TextureHandle>,
    pub has_levels: bool,
}

impl Default for ImageAdjustmentState {
    fn default() -> Self {
        Self {
            exposure: 0.0,
            contrast: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            whites: 0.0,
            blacks: 0.0,
            vignette: 0.0,
            saturation: 0.0,
            vibrance: 0.0,
            curves_texture: None,
            has_curves: false,
            levels_rgb: [0.0, 1.0, 1.0, 0.0, 1.0],
            levels_r: [0.0, 1.0, 1.0, 0.0, 1.0],
            levels_g: [0.0, 1.0, 1.0, 0.0, 1.0],
            levels_b: [0.0, 1.0, 1.0, 0.0, 1.0],
            levels_texture: None,
            has_levels: false,
        }
    }
}

pub struct EngineInner {
    pub gl: WebGl2RenderingContext,
    pub gpu_ctx: GpuContext,
    pub shaders: ShaderPrograms,
    pub texture_pool: TexturePool,
    pub fbo_pool: FramebufferPool,
    pub layer_textures: HashMap<String, TextureHandle>,
    pub layer_masks: HashMap<String, TextureHandle>,
    pub layer_stack: Vec<LayerDesc>,
    pub composite_fbo: FramebufferHandle,
    pub scratch_fbo_a: FramebufferHandle,
    pub scratch_fbo_b: FramebufferHandle,
    pub composite_texture: TextureHandle,
    pub scratch_texture_a: TextureHandle,
    pub scratch_texture_b: TextureHandle,
    pub viewport: ViewportState,
    pub doc_width: u32,
    pub doc_height: u32,
    pub bg_color: [f32; 4],
    pub dirty_layers: HashSet<String>,
    pub needs_recomposite: bool,
    // Brush state
    pub stroke_textures: HashMap<String, TextureHandle>,
    pub stroke_opacity: HashMap<String, f32>,
    pub stroke_fbo: Option<FramebufferHandle>,
    // Custom brush tip
    pub brush_tip_texture: Option<TextureHandle>,
    pub brush_tip_width: u32,
    pub brush_tip_height: u32,
    pub brush_has_tip: bool,
    pub brush_angle: f32,
    // Selection
    pub selection_mask_texture: Option<TextureHandle>,
    // Shape preview (stores pre-drag layer content for live preview)
    pub shape_preview_texture: Option<TextureHandle>,
    pub shape_preview_layer_id: Option<String>,
    // Filter preview (stores pre-filter layer content for live preview)
    pub filter_preview_texture: Option<TextureHandle>,
    pub filter_preview_layer_id: Option<String>,
    // Clipboard
    pub clipboard_texture: Option<TextureHandle>,
    pub clipboard_width: u32,
    pub clipboard_height: u32,
    pub clipboard_offset_x: i32,
    pub clipboard_offset_y: i32,
    // Floating selection (for move-with-selection)
    pub float_texture: Option<TextureHandle>,
    pub float_base_texture: Option<TextureHandle>,
    pub float_layer_id: Option<String>,
    pub float_width: u32,
    pub float_height: u32,
    pub float_layer_x: i32,
    pub float_layer_y: i32,
    // Float transform state (GPU-side affine/perspective)
    pub float_transform_mode: u8, // 0=none, 1=affine, 2=perspective
    pub float_transform_inv_matrix: [f32; 9],
    pub float_transform_center: [f32; 2],
    pub float_transform_corners: [f32; 8],
    pub float_transform_orig_rect: [f32; 4],
    // Overlays
    pub grid_visible: bool,
    pub grid_size: f32,
    pub rulers_visible: bool,
    pub transform_overlay: Option<String>,
    pub gradient_guide: Option<[f64; 4]>,
    pub lasso_points: Option<Vec<f64>>,
    pub crop_rect: Option<[f64; 4]>,
    pub brush_cursor: Option<[f64; 3]>,
    pub path_overlay: Option<String>,
    pub selection_time: f64,
    /// Per-document image adjustments — exposure/contrast/highlights/
    /// shadows/whites/blacks/vignette/saturation/vibrance plus curves and
    /// levels LUTs. Applied on the compositor's final pass, not baked into
    /// pixels.
    pub adjustments: ImageAdjustmentState,
    /// Mask editing — skip mask clipping, show blue overlay instead.
    pub mask_edit_layer_id: Option<String>,
    /// Magnetic lasso session (doc-sized Sobel edge field; present only
    /// while the tool is actively tracing).
    pub mlasso: MagneticLassoState,
}

impl EngineInner {
    pub fn new(gpu_ctx: GpuContext, shaders: ShaderPrograms) -> Result<Self, String> {
        let gl = gpu_ctx.gl.clone();
        let mut texture_pool = TexturePool::new(gpu_ctx.has_half_float);
        let mut fbo_pool = FramebufferPool::new();

        // Default document size — will be resized
        let doc_w = 1u32;
        let doc_h = 1u32;

        let composite_texture = texture_pool.acquire(&gl, doc_w, doc_h)?;
        let scratch_texture_a = texture_pool.acquire(&gl, doc_w, doc_h)?;
        let scratch_texture_b = texture_pool.acquire(&gl, doc_w, doc_h)?;

        // System textures use NEAREST — they are always sampled 1:1 at exact texel centers
        texture_pool.set_nearest_filter(&gl, composite_texture);
        texture_pool.set_nearest_filter(&gl, scratch_texture_a);
        texture_pool.set_nearest_filter(&gl, scratch_texture_b);

        let composite_fbo = fbo_pool.create(&gl)?;
        let scratch_fbo_a = fbo_pool.create(&gl)?;
        let scratch_fbo_b = fbo_pool.create(&gl)?;

        fbo_pool.attach_texture(&gl, composite_fbo, texture_pool.get(composite_texture).unwrap());
        fbo_pool.attach_texture(&gl, scratch_fbo_a, texture_pool.get(scratch_texture_a).unwrap());
        fbo_pool.attach_texture(&gl, scratch_fbo_b, texture_pool.get(scratch_texture_b).unwrap());

        Ok(Self {
            gl,
            gpu_ctx,
            shaders,
            texture_pool,
            fbo_pool,
            layer_textures: HashMap::new(),
            layer_masks: HashMap::new(),
            layer_stack: Vec::new(),
            composite_fbo,
            scratch_fbo_a,
            scratch_fbo_b,
            composite_texture,
            scratch_texture_a,
            scratch_texture_b,
            viewport: ViewportState::new(1.0, 0.0, 0.0, 1.0, 1.0),
            doc_width: doc_w,
            doc_height: doc_h,
            bg_color: [1.0, 1.0, 1.0, 1.0],
            dirty_layers: HashSet::new(),
            needs_recomposite: true,
            stroke_textures: HashMap::new(),
            stroke_opacity: HashMap::new(),
            stroke_fbo: None,
            brush_tip_texture: None,
            brush_tip_width: 0,
            brush_tip_height: 0,
            brush_has_tip: false,
            brush_angle: 0.0,
            selection_mask_texture: None,
            shape_preview_texture: None,
            shape_preview_layer_id: None,
            filter_preview_texture: None,
            filter_preview_layer_id: None,
            clipboard_texture: None,
            clipboard_width: 0,
            clipboard_height: 0,
            clipboard_offset_x: 0,
            clipboard_offset_y: 0,
            float_texture: None,
            float_base_texture: None,
            float_layer_id: None,
            float_width: 0,
            float_height: 0,
            float_layer_x: 0,
            float_layer_y: 0,
            float_transform_mode: 0,
            float_transform_inv_matrix: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
            float_transform_center: [0.0, 0.0],
            float_transform_corners: [0.0; 8],
            float_transform_orig_rect: [0.0; 4],
            grid_visible: false,
            grid_size: 1.0,
            rulers_visible: false,
            transform_overlay: None,
            gradient_guide: None,
            lasso_points: None,
            crop_rect: None,
            brush_cursor: None,
            path_overlay: None,
            selection_time: 0.0,
            adjustments: ImageAdjustmentState::default(),
            mask_edit_layer_id: None,
            mlasso: MagneticLassoState::default(),
        })
    }

    pub fn set_document_size(&mut self, width: u32, height: u32) -> Result<(), String> {
        self.doc_width = width;
        self.doc_height = height;

        // Reallocate composite and scratch textures
        self.texture_pool.release(self.composite_texture);
        self.texture_pool.release(self.scratch_texture_a);
        self.texture_pool.release(self.scratch_texture_b);

        self.composite_texture = self.texture_pool.acquire(&self.gl, width, height)?;
        self.scratch_texture_a = self.texture_pool.acquire(&self.gl, width, height)?;
        self.scratch_texture_b = self.texture_pool.acquire(&self.gl, width, height)?;

        // System textures use NEAREST — always sampled 1:1
        self.texture_pool.set_nearest_filter(&self.gl, self.composite_texture);
        self.texture_pool.set_nearest_filter(&self.gl, self.scratch_texture_a);
        self.texture_pool.set_nearest_filter(&self.gl, self.scratch_texture_b);

        self.fbo_pool.attach_texture(
            &self.gl, self.composite_fbo,
            self.texture_pool.get(self.composite_texture).unwrap(),
        );
        self.fbo_pool.attach_texture(
            &self.gl, self.scratch_fbo_a,
            self.texture_pool.get(self.scratch_texture_a).unwrap(),
        );
        self.fbo_pool.attach_texture(
            &self.gl, self.scratch_fbo_b,
            self.texture_pool.get(self.scratch_texture_b).unwrap(),
        );

        self.needs_recomposite = true;
        Ok(())
    }

    pub fn set_viewport(&mut self, zoom: f64, pan_x: f64, pan_y: f64, screen_w: f64, screen_h: f64) {
        self.viewport = ViewportState::new(zoom, pan_x, pan_y, screen_w, screen_h);
        self.needs_recomposite = true;
    }

    pub fn set_background_color(&mut self, r: f32, g: f32, b: f32, a: f32) {
        self.bg_color = [r, g, b, a];
        self.needs_recomposite = true;
    }

    pub fn mark_layer_dirty(&mut self, layer_id: &str) {
        self.dirty_layers.insert(layer_id.to_string());
        self.needs_recomposite = true;
    }

    /// Expand a lazy 1x1 layer texture to full document size.
    /// Called before any GPU operation that writes to the layer texture
    /// (gradient, shape, brush stroke). No-op if already full size.
    pub fn ensure_layer_full_size(&mut self, layer_id: &str) -> Result<(), String> {
        let layer_tex = match self.layer_textures.get(layer_id) {
            Some(&t) => t,
            None => return Ok(()),
        };
        let (lw, lh) = self.texture_pool.get_size(layer_tex).unwrap_or((1, 1));
        if lw >= self.doc_width && lh >= self.doc_height {
            return Ok(());
        }

        // Get the layer's current position so we can place the old content
        // correctly in the new full-size texture.
        let (layer_x, layer_y) = self.layer_stack.iter()
            .find(|l| l.id == layer_id)
            .map(|l| (l.x, l.y))
            .unwrap_or((0, 0));

        // Read old texture pixels via CPU readback (handles float textures).
        let old_tex_gl = self.texture_pool.get(layer_tex).cloned();
        let old_pixels = if let Some(ref tex) = old_tex_gl {
            let fbo = self.gl.create_framebuffer();
            if let Some(ref fbo) = fbo {
                self.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(fbo));
                self.gl.framebuffer_texture_2d(
                    WebGl2RenderingContext::FRAMEBUFFER,
                    WebGl2RenderingContext::COLOR_ATTACHMENT0,
                    WebGl2RenderingContext::TEXTURE_2D,
                    Some(tex),
                    0,
                );
                let result = self.texture_pool.read_rgba(&self.gl, 0, 0, lw, lh);
                self.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
                self.gl.delete_framebuffer(Some(fbo));
                result.ok()
            } else {
                None
            }
        } else {
            None
        };

        // Compute the union of the document area and the layer content area
        // so that offscreen content is preserved.
        let min_x = 0i32.min(layer_x);
        let min_y = 0i32.min(layer_y);
        let max_x = (self.doc_width as i32).max(layer_x + lw as i32);
        let max_y = (self.doc_height as i32).max(layer_y + lh as i32);
        let new_w = (max_x - min_x) as u32;
        let new_h = (max_y - min_y) as u32;

        let new_tex = self.texture_pool.acquire(&self.gl, new_w, new_h)?;

        // Re-upload old content at the correct position in the new texture.
        if let Some(pixels) = old_pixels {
            let dst_x = layer_x - min_x;
            let dst_y = layer_y - min_y;

            if lw > 0 && lh > 0 {
                let _ = self.texture_pool.upload_rgba(
                    &self.gl, new_tex,
                    dst_x, dst_y, lw, lh, &pixels,
                );
            }
        }

        let old = self.layer_textures.insert(layer_id.to_string(), new_tex);
        if let Some(old_tex) = old {
            self.texture_pool.release(old_tex);
        }
        if let Some(layer) = self.layer_stack.iter_mut().find(|l| l.id == layer_id) {
            layer.x = min_x;
            layer.y = min_y;
            layer.width = new_w;
            layer.height = new_h;
        }
        self.mark_layer_dirty(layer_id);
        Ok(())
    }

    /// Release all layer textures, masks, stroke textures, selection,
    /// clipboard, float, brush tip, and shape preview. Resets the engine
    /// to a clean state without destroying the WebGL context.
    pub fn clear_all_layers(&mut self) {
        // Layer textures
        for (_, tex) in self.layer_textures.drain() {
            self.texture_pool.release(tex);
        }
        // Layer masks
        for (_, tex) in self.layer_masks.drain() {
            self.texture_pool.release(tex);
        }
        // Stroke textures
        for (_, tex) in self.stroke_textures.drain() {
            self.texture_pool.release(tex);
        }
        self.stroke_opacity.clear();
        if let Some(fbo) = self.stroke_fbo.take() {
            self.fbo_pool.release(&self.gl, fbo);
        }
        // Brush tip
        if let Some(tex) = self.brush_tip_texture.take() {
            self.texture_pool.release(tex);
        }
        self.brush_has_tip = false;
        // Selection mask
        if let Some(tex) = self.selection_mask_texture.take() {
            self.texture_pool.release(tex);
        }
        // Shape preview
        if let Some(tex) = self.shape_preview_texture.take() {
            self.texture_pool.release(tex);
        }
        self.shape_preview_layer_id = None;
        // Filter preview
        if let Some(tex) = self.filter_preview_texture.take() {
            self.texture_pool.release(tex);
        }
        self.filter_preview_layer_id = None;
        // Clipboard
        if let Some(tex) = self.clipboard_texture.take() {
            self.texture_pool.release(tex);
        }
        self.clipboard_width = 0;
        self.clipboard_height = 0;
        self.clipboard_offset_x = 0;
        self.clipboard_offset_y = 0;
        // Float
        if let Some(tex) = self.float_texture.take() {
            self.texture_pool.release(tex);
        }
        if let Some(tex) = self.float_base_texture.take() {
            self.texture_pool.release(tex);
        }
        self.float_layer_id = None;
        self.float_width = 0;
        self.float_height = 0;
        self.float_layer_x = 0;
        self.float_layer_y = 0;
        self.float_transform_mode = 0;
        // Layer stack and overlays
        self.layer_stack.clear();
        self.dirty_layers.clear();
        self.transform_overlay = None;
        self.gradient_guide = None;
        self.lasso_points = None;
        self.crop_rect = None;
        self.brush_cursor = None;
        self.path_overlay = None;
        self.mask_edit_layer_id = None;
        self.mlasso.edges = None;
        self.mlasso.width = 0;
        self.mlasso.height = 0;
        // Image adjustments
        self.adjustments.exposure = 0.0;
        self.adjustments.contrast = 0.0;
        self.adjustments.highlights = 0.0;
        self.adjustments.shadows = 0.0;
        self.adjustments.whites = 0.0;
        self.adjustments.blacks = 0.0;
        self.adjustments.vignette = 0.0;
        self.adjustments.saturation = 0.0;
        self.adjustments.vibrance = 0.0;
        if let Some(tex) = self.adjustments.curves_texture.take() {
            self.texture_pool.release(tex);
        }
        self.adjustments.has_curves = false;
        self.needs_recomposite = true;
    }

    pub fn mark_all_dirty(&mut self) {
        for layer in &self.layer_stack {
            self.dirty_layers.insert(layer.id.clone());
        }
        self.needs_recomposite = true;
    }

    /// Draw a fullscreen quad (3 vertices, no VBO needed)
    pub fn draw_fullscreen_quad(&self) {
        self.gl.draw_arrays(WebGl2RenderingContext::TRIANGLES, 0, 3);
    }
}

impl Drop for EngineInner {
    /// Release every WebGL texture and FBO held by the pools. Without this,
    /// the JS-side `engine.free()` would drop the Rust struct but leave the
    /// underlying GL objects alive in the WebGL context until that context
    /// itself is destroyed (which, for an SPA, may be never).
    fn drop(&mut self) {
        self.texture_pool.destroy(&self.gl);
        self.fbo_pool.destroy(&self.gl);
    }
}
