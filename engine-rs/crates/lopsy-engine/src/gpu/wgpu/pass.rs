//! The pass layer on wgpu: what a [`Pass`](crate::gpu::pass::Pass) will do
//! to the device. No pass draws yet; see the module above.

use lopsy_core::geometry::Rect;

use super::context::GpuContext;
use super::framebuffer::{FramebufferHandle, FramebufferPool};
use super::program::{LinkedProgram, ParamSink};
use super::texture_pool::{TextureHandle, TexturePool};
use super::UNAVAILABLE;
use crate::gpu::pass::{Blend, ReadFormat, Scissor, Target};
use crate::gpu::shader::ShaderProgram;
use crate::gpu::uniforms::Field;

/// The GPU objects a pass draws with, borrowed from the engine.
#[derive(Clone, Copy)]
pub struct GpuRef<'a> {
    ctx: &'a GpuContext,
    textures: &'a TexturePool,
    fbos: &'a FramebufferPool,
}

impl<'a> GpuRef<'a> {
    /// `_render_fbo` is the framebuffer a WebGL pass attaches a texture
    /// target to. A wgpu pass names its target directly.
    pub fn new(ctx: &'a GpuContext, textures: &'a TexturePool, fbos: &'a FramebufferPool, _render_fbo: FramebufferHandle) -> Self {
        Self { ctx, textures, fbos }
    }

    /// Start a pass that runs `program`, with the uniform struct whose
    /// fields are `fields` and whose values `put` hands over.
    pub(in crate::gpu) fn raw_pass(
        self,
        program: &'a LinkedProgram,
        _fields: &'static [Field],
        put: &dyn Fn(&mut ParamSink),
    ) -> RawPass<'a> {
        put(&mut ParamSink);
        RawPass { gpu: self, program }
    }

    /// Whether `texture` still names a live texture.
    pub fn has_texture(self, texture: TextureHandle) -> bool {
        self.textures.get(texture).is_some()
    }

    /// A WebGPU pass binds its textures for that pass only, so there is
    /// nothing left bound to undo.
    pub fn unbind_textures(self, _count: u32) {}

    /// Fill `texture` with `color`.
    pub fn clear(self, texture: TextureHandle, color: [f32; 4]) -> bool {
        let Some(texture) = self.textures.get(texture) else {
            return false;
        };
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.run_empty_pass(&view, wgpu::LoadOp::Clear(to_color(color)));
        true
    }

    /// A render pass that draws nothing: what it does is its load
    /// operation.
    fn run_empty_pass(self, view: &wgpu::TextureView, load: wgpu::LoadOp<wgpu::Color>) {
        let mut encoder = self.ctx.device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
        encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load, store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        self.ctx.queue.submit([encoder.finish()]);
    }

    /// Show what the frame's screen passes drew.
    pub fn finish_frame(self) {
        self.ctx.present();
    }

    pub fn clear_rect(self, _texture: TextureHandle, _rect: Rect, _color: [f32; 4]) -> bool {
        false
    }

    pub fn copy_region(self, _src: FramebufferHandle, _region: Rect, _dst: TextureHandle) -> bool {
        false
    }

    pub fn draw_r8_bytes<P>(
        self,
        _program: &ShaderProgram<P>,
        _sampler: &str,
        _bytes: &[u8],
        _w: u32,
        _h: u32,
        _dst: TextureHandle,
    ) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }

    /// Size of the canvas [`Target::Screen`] draws to, in device pixels.
    pub fn screen_size(self) -> Result<(i32, i32), String> {
        let (width, height) = self.ctx.screen_size();
        Ok((width as i32, height as i32))
    }

    pub fn read_rgba(self, _texture: TextureHandle, _x: i32, _y: i32, _w: u32, _h: u32) -> Result<Vec<u8>, String> {
        Err(UNAVAILABLE.into())
    }

    pub fn read_rgba_u16(self, _texture: TextureHandle, _x: i32, _y: i32, _w: u32, _h: u32) -> Result<Vec<u16>, String> {
        Err(UNAVAILABLE.into())
    }
}

/// A [`Pass`](crate::gpu::pass::Pass) without its uniform struct's type.
pub(in crate::gpu) struct RawPass<'a> {
    gpu: GpuRef<'a>,
    program: &'a LinkedProgram,
}

impl<'a> RawPass<'a> {
    pub(in crate::gpu) fn viewport(&mut self, _x: i32, _y: i32, _width: i32, _height: i32) {}

    pub(in crate::gpu) fn scissor(&mut self, _scissor: Scissor) {}

    pub(in crate::gpu) fn blend(&mut self, _blend: Blend) {}

    pub(in crate::gpu) fn clear(&mut self, _color: [f32; 4]) {}

    pub(in crate::gpu) fn texture(&mut self, _name: &str, _texture: TextureHandle) {}

    /// WebGL only: a wgpu pass has no texture units to point a sampler at.
    pub(in crate::gpu) fn sampler_unit(&self, _name: &str, _unit: i32) {}

    pub(in crate::gpu) fn read_back(self, _format: ReadFormat, _w: u32, _h: u32) -> Option<Vec<u8>> {
        None
    }

    /// No pass draws yet. One aimed at the screen still takes the frame's
    /// texture, so the canvas shows a cleared frame.
    pub(in crate::gpu) fn draw(self, target: Target) -> bool {
        if let Target::Screen = target {
            if let Some(screen) = self.gpu.ctx.screen_target() {
                let load = if screen.is_first_pass { wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT) } else { wgpu::LoadOp::Load };
                self.gpu.run_empty_pass(&screen.view, load);
            }
        }
        false
    }

    pub(in crate::gpu) fn begin(self, _target: Target) -> Option<RawActivePass<'a>> {
        None
    }
}

/// A pass that has been set up and can draw repeatedly.
pub(in crate::gpu) struct RawActivePass<'a> {
    pass: RawPass<'a>,
}

impl RawActivePass<'_> {
    pub(in crate::gpu) fn set(&self, _fields: &'static [Field], put: &dyn Fn(&mut ParamSink)) {
        put(&mut ParamSink);
    }

    pub(in crate::gpu) fn draw(&self) {}

    pub(in crate::gpu) fn draw_in(&mut self, _rect: Rect) {}
}

fn to_color(color: [f32; 4]) -> wgpu::Color {
    wgpu::Color { r: color[0].into(), g: color[1].into(), b: color[2].into(), a: color[3].into() }
}
