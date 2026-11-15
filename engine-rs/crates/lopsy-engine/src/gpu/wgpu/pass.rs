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

    pub fn clear(self, _texture: TextureHandle, _color: [f32; 4]) -> bool {
        false
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

    pub fn screen_size(self) -> Result<(i32, i32), String> {
        Err(UNAVAILABLE.into())
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

    pub(in crate::gpu) fn draw(self, _target: Target) -> bool {
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
