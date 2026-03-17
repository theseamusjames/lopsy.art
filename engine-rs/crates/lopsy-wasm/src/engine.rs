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
    pub stroke_fbo: Option<FramebufferHandle>,
    // Selection
    pub selection_mask_texture: Option<TextureHandle>,
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
}

impl EngineInner {
    pub fn new(gpu_ctx: GpuContext, shaders: ShaderPrograms) -> Result<Self, String> {
        let gl = gpu_ctx.gl.clone();
        let mut texture_pool = TexturePool::new();
        let mut fbo_pool = FramebufferPool::new();

        // Default document size — will be resized
        let doc_w = 1u32;
        let doc_h = 1u32;

        let composite_texture = texture_pool.acquire(&gl, doc_w, doc_h)?;
        let scratch_texture_a = texture_pool.acquire(&gl, doc_w, doc_h)?;
        let scratch_texture_b = texture_pool.acquire(&gl, doc_w, doc_h)?;

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
            stroke_fbo: None,
            selection_mask_texture: None,
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
