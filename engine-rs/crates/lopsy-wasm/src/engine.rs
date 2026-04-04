use std::collections::{HashMap, HashSet};
use web_sys::WebGl2RenderingContext;

use lopsy_core::geometry::ViewportState;
use lopsy_core::layer::LayerDesc;

use crate::gpu::context::GpuContext;
use crate::gpu::framebuffer::{FramebufferHandle, FramebufferPool};
use crate::gpu::shader::ShaderPrograms;
use crate::gpu::texture_pool::{TextureHandle, TexturePool};

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
    // Image adjustments
    pub image_exposure: f32,
    pub image_contrast: f32,
    pub image_highlights: f32,
    pub image_shadows: f32,
    pub image_whites: f32,
    pub image_blacks: f32,
    pub image_vignette: f32,
    // Mask editing — skip mask clipping, show blue overlay instead
    pub mask_edit_layer_id: Option<String>,
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
            image_exposure: 0.0,
            image_contrast: 0.0,
            image_highlights: 0.0,
            image_shadows: 0.0,
            image_whites: 0.0,
            image_blacks: 0.0,
            image_vignette: 0.0,
            mask_edit_layer_id: None,
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
        let new_tex = self.texture_pool.acquire(&self.gl, self.doc_width, self.doc_height)?;
        let old = self.layer_textures.insert(layer_id.to_string(), new_tex);
        if let Some(old_tex) = old {
            self.texture_pool.release(old_tex);
        }
        if let Some(layer) = self.layer_stack.iter_mut().find(|l| l.id == layer_id) {
            layer.x = 0;
            layer.y = 0;
            layer.width = self.doc_width;
            layer.height = self.doc_height;
        }
        self.mark_layer_dirty(layer_id);
        Ok(())
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
