//! The pass layer on wgpu: what a [`Pass`](crate::gpu::pass::Pass) does to
//! the device.
//!
//! Each pass is one render pass in its own command buffer, submitted when
//! the pass ends, so passes, uploads and copies take effect in the order
//! the engine issues them, as they do on WebGL.
//!
//! Coordinates. The engine speaks WebGL's: texel (0, 0) of a texture is the
//! first row uploaded, a viewport or scissor rect names texels, and on the
//! screen y runs up. A texture target needs no conversion, because the
//! vertex stage flips the triangle (`program.rs`) and so fragment (x, y)
//! is texel (x, y) on both backends. Rects on the screen are flipped here.

use std::cell::RefCell;

use lopsy_core::geometry::Rect;

use super::context::{quad_bytes, GpuContext};
use super::framebuffer::{FramebufferHandle, FramebufferPool};
use super::program::{BindingKind, LinkedProgram, ParamSink};
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

/// A render target, resolved to what a render pass needs.
struct Resolved {
    view: wgpu::TextureView,
    format: wgpu::TextureFormat,
    width: u32,
    height: u32,
    is_screen: bool,
    /// The screen's texture is new each frame: its first pass clears it.
    is_fresh: bool,
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
        let mut params = Vec::new();
        ParamSink::pack(&mut params, put);
        RawPass::new(self, program, params)
    }

    /// Whether `texture` still names a live texture.
    pub fn has_texture(self, texture: TextureHandle) -> bool {
        self.textures.get(texture).is_some()
    }

    /// A WebGPU pass binds its textures for that pass only, so there is
    /// nothing left bound to undo.
    pub fn unbind_textures(self, _count: u32) {}

    fn resolve(self, target: Target) -> Option<Resolved> {
        match target {
            Target::Texture(handle) => {
                let texture = self.textures.get(handle)?;
                Some(Resolved {
                    view: self.textures.view(handle)?.clone(),
                    format: texture.format(),
                    width: texture.width(),
                    height: texture.height(),
                    is_screen: false,
                    is_fresh: false,
                })
            }
            Target::Framebuffer(fbo) => {
                let attachment = self.fbos.attachment(fbo)?;
                Some(Resolved {
                    format: attachment.texture.format(),
                    width: attachment.texture.width(),
                    height: attachment.texture.height(),
                    view: attachment.view,
                    is_screen: false,
                    is_fresh: false,
                })
            }
            Target::Screen => {
                let screen = self.ctx.screen_target()?;
                Some(Resolved {
                    view: screen.view,
                    format: screen.format,
                    width: screen.width,
                    height: screen.height,
                    is_screen: true,
                    is_fresh: screen.is_first_pass,
                })
            }
        }
    }

    fn encoder(self) -> wgpu::CommandEncoder {
        self.ctx.device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default())
    }

    /// Run what `encoder` recorded. Everything staged for it is then dead.
    fn submit(self, encoder: wgpu::CommandEncoder) {
        self.ctx.queue.submit([encoder.finish()]);
        self.ctx.draw.reset();
    }

    /// Fill `texture` with `color`. Returns `false` if the texture no longer
    /// exists.
    pub fn clear(self, texture: TextureHandle, color: [f32; 4]) -> bool {
        let Some(view) = self.textures.view(texture) else {
            return false;
        };
        let mut encoder = self.encoder();
        begin_render_pass(&mut encoder, view, wgpu::LoadOp::Clear(to_color(color)));
        self.submit(encoder);
        true
    }

    /// Fill `rect` of `texture` (in texels) with `color`, leaving the rest
    /// untouched. Returns `false` if the texture no longer exists.
    pub fn clear_rect(self, texture: TextureHandle, rect: Rect, color: [f32; 4]) -> bool {
        let Some(target) = self.resolve(Target::Texture(texture)) else {
            return false;
        };
        let Some(area) = Area::from(rect).intersect(Area::of_target(&target)) else {
            return true;
        };
        let mut encoder = self.encoder();
        {
            let mut pass = begin_render_pass(&mut encoder, &target.view, wgpu::LoadOp::Load);
            self.fill(&mut pass, &target, area, color);
        }
        self.submit(encoder);
        true
    }

    /// Draw `color` over `area` of the pass's target, leaving the pass's
    /// scissor at `area`. A full arena cannot happen here: the fill is the
    /// first thing a submit stages.
    fn fill(self, pass: &mut wgpu::RenderPass<'_>, target: &Resolved, area: Area, color: [f32; 4]) {
        let draw = &self.ctx.draw;
        let mut bytes = [0u8; 16];
        for (slot, value) in bytes.chunks_exact_mut(4).zip(color) {
            slot.copy_from_slice(&value.to_le_bytes());
        }
        let Some(offset) = draw.stage(&self.ctx.queue, &bytes) else { return };
        pass.set_pipeline(&draw.fill.pipeline(Blend::Off, target.format));
        pass.set_bind_group(0, &draw.fill_group, &[offset]);
        pass.set_bind_group(1, &draw.quad_group, &[draw.identity_quad_offset(target.is_screen)]);
        pass.set_scissor_rect(area.x as u32, area.y as u32, area.w as u32, area.h as u32);
        pass.draw(0..3, 0..1);
    }

    /// Copy `region` of `src`'s colour attachment to the origin of `dst`,
    /// texel for texel. Returns `false` if `dst` no longer exists.
    pub fn copy_region(self, src: FramebufferHandle, region: Rect, dst: TextureHandle) -> bool {
        let Some(dst_texture) = self.textures.get(dst) else {
            return false;
        };
        let Some(source) = self.fbos.attachment(src) else {
            return true;
        };
        // WebGL clips a blit to both textures; WebGPU rejects a copy that
        // leaves either.
        let wanted = Area::from(region);
        let within_source = Area { x: 0, y: 0, w: source.texture.width() as i32, h: source.texture.height() as i32 };
        let within_dest = Area { x: wanted.x, y: wanted.y, w: dst_texture.width() as i32, h: dst_texture.height() as i32 };
        let Some(area) = wanted.intersect(within_source).and_then(|a| a.intersect(within_dest)) else {
            return true;
        };
        let mut encoder = self.encoder();
        encoder.copy_texture_to_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &source.texture,
                mip_level: 0,
                origin: wgpu::Origin3d { x: area.x as u32, y: area.y as u32, z: 0 },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyTextureInfo {
                texture: dst_texture,
                mip_level: 0,
                origin: wgpu::Origin3d { x: (area.x - wanted.x) as u32, y: (area.y - wanted.y) as u32, z: 0 },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::Extent3d { width: area.w as u32, height: area.h as u32, depth_or_array_layers: 1 },
        );
        self.submit(encoder);
        true
    }

    /// Upload `w * h` single-byte values as a temporary `r8unorm` texture
    /// and run `program` over it into `dst`, with the bytes bound to
    /// `sampler` and blending off. This is how one-byte-per-texel data
    /// reaches a pooled texture without a CPU expansion to the pool's
    /// format.
    pub fn draw_r8_bytes<P>(
        self,
        program: &ShaderProgram<P>,
        sampler: &str,
        bytes: &[u8],
        w: u32,
        h: u32,
        dst: TextureHandle,
    ) -> Result<(), String> {
        if self.textures.get(dst).is_none() {
            return Err("Destination texture not found".into());
        }
        if w == 0 || h == 0 || bytes.len() < (w * h) as usize {
            return Err("Failed to upload mask bytes".into());
        }
        let size = wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 };
        let staging = self.ctx.device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        self.ctx.queue.write_texture(
            staging.as_image_copy(),
            &bytes[..(w * h) as usize],
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(w), rows_per_image: None },
            size,
        );

        let program = program.linked();
        let mut pass = RawPass::new(self, program, Vec::new());
        pass.viewport(0, 0, w as i32, h as i32);
        if let Some(binding) = program.reflection.texture_binding(sampler) {
            pass.staged = Some((binding, staging.create_view(&wgpu::TextureViewDescriptor::default())));
        }
        pass.draw(Target::Texture(dst));
        staging.destroy();
        Ok(())
    }

    /// Show what the frame's screen passes drew.
    pub fn finish_frame(self) {
        self.ctx.present();
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

/// A [`Pass`](crate::gpu::pass::Pass) without its uniform struct's type, so
/// this code is compiled once and not once per shader.
pub(in crate::gpu) struct RawPass<'a> {
    gpu: GpuRef<'a>,
    program: &'a LinkedProgram,
    /// The uniform struct, packed as the shader's `Params`.
    params: Vec<u8>,
    /// Every texture the pass was given, in the order given: the position
    /// is the texture unit a WebGL pass would have bound it to.
    units: Vec<TextureHandle>,
    /// Texture binding -> the unit whose texture it samples.
    bound: RefCell<Vec<(u32, usize)>>,
    /// A texture outside the pool, for one binding.
    staged: Option<(u32, wgpu::TextureView)>,
    has_missing_texture: bool,
    viewport: Option<[i32; 4]>,
    scissor: Scissor,
    blend: Blend,
    clear: Option<[f32; 4]>,
}

impl<'a> RawPass<'a> {
    fn new(gpu: GpuRef<'a>, program: &'a LinkedProgram, params: Vec<u8>) -> Self {
        RawPass {
            gpu,
            program,
            params,
            units: Vec::new(),
            bound: RefCell::new(Vec::new()),
            staged: None,
            has_missing_texture: false,
            viewport: None,
            scissor: Scissor::Off,
            blend: Blend::Off,
            clear: None,
        }
    }

    pub(in crate::gpu) fn viewport(&mut self, x: i32, y: i32, width: i32, height: i32) {
        self.viewport = Some([x, y, width, height]);
    }

    pub(in crate::gpu) fn scissor(&mut self, scissor: Scissor) {
        self.scissor = scissor;
    }

    pub(in crate::gpu) fn blend(&mut self, blend: Blend) {
        self.blend = blend;
    }

    pub(in crate::gpu) fn clear(&mut self, color: [f32; 4]) {
        self.clear = Some(color);
    }

    pub(in crate::gpu) fn texture(&mut self, name: &str, texture: TextureHandle) {
        let unit = self.units.len();
        self.units.push(texture);
        if self.gpu.textures.get(texture).is_none() {
            self.has_missing_texture = true;
        }
        self.sampler_unit(name, unit as i32);
    }

    /// Make the texture `name` read whatever was bound as texture `unit`
    /// of this pass. WebGL points samplers at numbered units; this keeps
    /// the same meaning without them.
    pub(in crate::gpu) fn sampler_unit(&self, name: &str, unit: i32) {
        let Some(binding) = self.program.reflection.texture_binding(name) else { return };
        let mut bound = self.bound.borrow_mut();
        bound.retain(|(index, _)| *index != binding);
        bound.push((binding, unit.max(0) as usize));
    }

    pub(in crate::gpu) fn read_back(self, _format: ReadFormat, _w: u32, _h: u32) -> Option<Vec<u8>> {
        None
    }

    pub(in crate::gpu) fn draw(self, target: Target) -> bool {
        match self.begin(target) {
            Some(active) => {
                active.draw();
                true
            }
            None => false,
        }
    }

    /// The pooled texture a texture binding reads, if the pass gave one.
    fn texture_for(&self, binding: u32) -> Option<TextureHandle> {
        let bound = self.bound.borrow();
        let (_, unit) = bound.iter().find(|(index, _)| *index == binding)?;
        self.units.get(*unit).copied()
    }

    /// One entry for everything the shader declares: the uniform struct,
    /// each texture the pass supplied or a blank one, and for each sampler
    /// the one its texture's filter and wrap call for.
    fn bind_group(&self) -> wgpu::BindGroup {
        let GpuRef { ctx, textures, .. } = self.gpu;
        let reflection = &self.program.reflection;
        let mut entries = Vec::with_capacity(reflection.bindings.len() + 1);
        if reflection.params_size > 0 {
            entries.push(wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: ctx.draw.arena(),
                    offset: 0,
                    size: std::num::NonZeroU64::new(u64::from(reflection.params_size)),
                }),
            });
        }
        let staged = |binding: u32| self.staged.as_ref().filter(|(index, _)| *index == binding).map(|(_, view)| view);
        for binding in &reflection.bindings {
            let resource = match binding.kind {
                BindingKind::Texture => {
                    let view = staged(binding.index)
                        .or_else(|| self.texture_for(binding.index).and_then(|handle| textures.view(handle)))
                        .unwrap_or(&ctx.draw.blank);
                    wgpu::BindingResource::TextureView(view)
                }
                BindingKind::Sampler { texture } => {
                    let pooled = texture
                        .filter(|index| staged(*index).is_none())
                        .and_then(|index| self.texture_for(index));
                    let sampler = match pooled {
                        Some(handle) => textures.sampler(handle),
                        None => textures.nearest_sampler(),
                    };
                    wgpu::BindingResource::Sampler(sampler)
                }
            };
            entries.push(wgpu::BindGroupEntry { binding: binding.index, resource });
        }
        ctx.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.program.layout,
            entries: &entries,
        })
    }

    pub(in crate::gpu) fn begin(mut self, target: Target) -> Option<RawActivePass<'a>> {
        if self.has_missing_texture {
            return None;
        }
        let target = self.gpu.resolve(target)?;
        let placement = Placement::of(&target, self.viewport, self.scissor);

        // A shader's `Params` is never shorter than what was packed for it,
        // but a pass without a uniform struct packs nothing.
        self.params.resize(self.program.reflection.params_size as usize, 0);

        let mut active = RawActivePass {
            gpu: self.gpu,
            state: RefCell::new(Active {
                recording: None,
                pipeline: self.program.pipeline(self.blend, target.format),
                bind_group: self.bind_group(),
                has_params: self.program.reflection.params_size > 0,
                params: std::mem::take(&mut self.params),
                is_params_staged: false,
                clip: placement.clip,
                placement,
                target,
            }),
        };
        active.state.get_mut().open(self.gpu, self.clear, self.scissor);
        Some(active)
    }
}

/// A render pass being recorded, with the encoder it belongs to. The pass
/// is declared first so it is dropped, and so ended, before the encoder.
struct Recording {
    pass: wgpu::RenderPass<'static>,
    encoder: wgpu::CommandEncoder,
}

struct Active {
    /// `None` when the pass can draw nothing: its viewport or scissor
    /// leaves the target.
    recording: Option<Recording>,
    target: Resolved,
    pipeline: wgpu::RenderPipeline,
    bind_group: wgpu::BindGroup,
    has_params: bool,
    /// The uniform struct the next draw uses.
    params: Vec<u8>,
    /// Whether `params` is in the arena and bound.
    is_params_staged: bool,
    placement: Placement,
    /// What draws are limited to now; `None` when nothing can be drawn.
    clip: Option<Area>,
}

impl Active {
    /// Begin the render pass. `clear` is the pass's own clear; `scissor`
    /// limits it to a rect, as it does a WebGL clear.
    fn open(&mut self, gpu: GpuRef<'_>, clear: Option<[f32; 4]>, scissor: Scissor) {
        let whole = Area::of_target(&self.target);
        let partial_clear = match (clear, scissor) {
            (Some(color), Scissor::Rect(rect)) => Some((color, self.placement.in_target(rect).intersect(whole))),
            _ => None,
        };
        let load = match clear {
            Some(color) if partial_clear.is_none() => wgpu::LoadOp::Clear(to_color(color)),
            _ if self.target.is_fresh => wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
            _ => wgpu::LoadOp::Load,
        };
        self.target.is_fresh = false;

        let is_drawing = self.clip.is_some();
        let has_fill = matches!(partial_clear, Some((_, Some(_))));
        if !is_drawing && !has_fill && matches!(load, wgpu::LoadOp::Load) {
            return;
        }
        let mut encoder = gpu.encoder();
        let mut pass = begin_render_pass(&mut encoder, &self.target.view, load).forget_lifetime();
        if let Some((color, Some(area))) = partial_clear {
            gpu.fill(&mut pass, &self.target, area, color);
        }
        if !is_drawing {
            // Nothing can be drawn, but the clear still happens.
            drop(pass);
            gpu.submit(encoder);
            return;
        }
        self.recording = Some(Recording { pass, encoder });
        self.is_params_staged = false;
        self.apply_state(gpu);
    }

    /// Set everything a draw depends on except the uniform struct.
    fn apply_state(&mut self, gpu: GpuRef<'_>) {
        let draw = &gpu.ctx.draw;
        let quad_offset = match self.placement.quad {
            None => Some(draw.identity_quad_offset(self.target.is_screen)),
            Some(quad) => draw.stage(&gpu.ctx.queue, &quad_bytes(quad)),
        };
        let (Some(recording), Some(clip)) = (&mut self.recording, self.clip) else { return };
        let pass = &mut recording.pass;
        pass.set_pipeline(&self.pipeline);
        if let Some(offset) = quad_offset {
            pass.set_bind_group(1, &draw.quad_group, &[offset]);
        }
        let [x, y, w, h] = self.placement.viewport;
        pass.set_viewport(x, y, w, h, 0.0, 1.0);
        pass.set_scissor_rect(clip.x as u32, clip.y as u32, clip.w as u32, clip.h as u32);
    }

    /// Submit what has been recorded and start a new render pass that
    /// keeps the target's contents, with the arena empty again.
    fn restart(&mut self, gpu: GpuRef<'_>) {
        let Some(Recording { pass, encoder }) = self.recording.take() else { return };
        drop(pass);
        gpu.submit(encoder);
        self.open(gpu, None, Scissor::Off);
    }

    /// Put the current uniform struct in the arena and bind it, unless it
    /// already is. A full arena is emptied by submitting what the pass has
    /// drawn so far.
    fn stage_params(&mut self, gpu: GpuRef<'_>) {
        if self.is_params_staged || self.recording.is_none() {
            return;
        }
        let draw = &gpu.ctx.draw;
        let mut offset = None;
        if self.has_params {
            offset = draw.stage(&gpu.ctx.queue, &self.params);
            if offset.is_none() {
                self.restart(gpu);
                offset = draw.stage(&gpu.ctx.queue, &self.params);
            }
        }
        if let Some(recording) = &mut self.recording {
            match offset {
                Some(offset) => recording.pass.set_bind_group(0, &self.bind_group, &[offset]),
                None => recording.pass.set_bind_group(0, &self.bind_group, &[]),
            }
        }
        self.is_params_staged = true;
    }

    fn draw(&mut self, gpu: GpuRef<'_>) {
        self.stage_params(gpu);
        if let Some(recording) = &mut self.recording {
            recording.pass.draw(0..3, 0..1);
        }
    }
}

/// A pass that has been set up and can draw repeatedly.
pub(in crate::gpu) struct RawActivePass<'a> {
    gpu: GpuRef<'a>,
    state: RefCell<Active>,
}

impl RawActivePass<'_> {
    /// Change the pass's uniforms for its next draws.
    pub(in crate::gpu) fn set(&self, _fields: &'static [Field], put: &dyn Fn(&mut ParamSink)) {
        let mut state = self.state.borrow_mut();
        let size = state.params.len();
        ParamSink::pack(&mut state.params, put);
        state.params.resize(size, 0);
        state.is_params_staged = false;
    }

    pub(in crate::gpu) fn draw(&self) {
        self.state.borrow_mut().draw(self.gpu);
    }

    /// Draw within `rect` only. As on WebGL, the rect stays the pass's
    /// scissor for the draws after it.
    pub(in crate::gpu) fn draw_in(&mut self, rect: Rect) {
        let state = self.state.get_mut();
        let Some(clip) = state.placement.clip_to(rect) else {
            return;
        };
        state.clip = Some(clip);
        state.stage_params(self.gpu);
        if let Some(recording) = &mut state.recording {
            recording.pass.set_scissor_rect(clip.x as u32, clip.y as u32, clip.w as u32, clip.h as u32);
            recording.pass.draw(0..3, 0..1);
        }
    }
}

impl Drop for RawActivePass<'_> {
    fn drop(&mut self) {
        if let Some(Recording { pass, encoder }) = self.state.get_mut().recording.take() {
            drop(pass);
            self.gpu.submit(encoder);
        }
    }
}

/// An integer rect in a target's own coordinates: y down from row 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Area {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

impl Area {
    fn from(rect: Rect) -> Self {
        Area { x: rect.x, y: rect.y, w: rect.width as i32, h: rect.height as i32 }
    }

    fn of_target(target: &Resolved) -> Self {
        Area { x: 0, y: 0, w: target.width as i32, h: target.height as i32 }
    }

    /// The part of both rects, if they overlap.
    fn intersect(self, other: Area) -> Option<Area> {
        let x = self.x.max(other.x);
        let y = self.y.max(other.y);
        let right = (self.x + self.w).min(other.x + other.w);
        let bottom = (self.y + self.h).min(other.y + other.h);
        (right > x && bottom > y).then_some(Area { x, y, w: right - x, h: bottom - y })
    }

    /// A rect given with y up from the bottom of a target `height` tall.
    fn flipped(self, height: i32) -> Self {
        Area { y: height - self.y - self.h, ..self }
    }
}

/// Where a pass's triangle lands on its target.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Placement {
    /// The viewport to set: `[x, y, width, height]`.
    viewport: [f32; 4],
    /// The vertex stage's `Quad` when the wanted viewport reaches outside
    /// the target and the whole target is the viewport instead. `None` is
    /// the identity for the target.
    quad: Option<[f32; 4]>,
    /// Draws are limited to this rect; `None` when nothing can be drawn.
    clip: Option<Area>,
    /// The wanted viewport, clipped to the target: what a scissor is
    /// intersected with.
    bounds: Option<Area>,
    is_screen: bool,
    height: i32,
}

impl Placement {
    fn of(target: &Resolved, viewport: Option<[i32; 4]>, scissor: Scissor) -> Self {
        Self::compute(target.width as i32, target.height as i32, target.is_screen, viewport, scissor)
    }

    fn compute(width: i32, height: i32, is_screen: bool, viewport: Option<[i32; 4]>, scissor: Scissor) -> Self {
        let whole = Area { x: 0, y: 0, w: width, h: height };
        let wanted = match viewport {
            Some([x, y, w, h]) => {
                let area = Area { x, y, w, h };
                if is_screen { area.flipped(height) } else { area }
            }
            None => whole,
        };
        let bounds = wanted.intersect(whole);
        let is_inside = bounds == Some(wanted);
        let (viewport, quad) = if is_inside {
            ([wanted.x as f32, wanted.y as f32, wanted.w as f32, wanted.h as f32], None)
        } else {
            // The triangle's corner p in -1..1 lands on target texel
            // wanted.x + (p.x + 1) / 2 * wanted.w, and likewise down from
            // wanted.y, with the whole target as viewport.
            let (w, h) = (width as f32, height as f32);
            let scale_y = wanted.h as f32 / h;
            let quad = [
                wanted.w as f32 / w,
                if is_screen { scale_y } else { -scale_y },
                (2 * wanted.x + wanted.w) as f32 / w - 1.0,
                1.0 - (2 * wanted.y + wanted.h) as f32 / h,
            ];
            ([0.0, 0.0, w, h], Some(quad))
        };
        let mut placement = Placement { viewport, quad, clip: None, bounds, is_screen, height };
        placement.clip = match scissor {
            Scissor::Off => bounds,
            Scissor::Rect(rect) => placement.clip_to(rect),
        };
        placement
    }

    /// `rect`, given in the engine's coordinates, in the target's own.
    fn in_target(&self, rect: Rect) -> Area {
        let area = Area::from(rect);
        if self.is_screen { area.flipped(self.height) } else { area }
    }

    /// `rect`, given in the engine's coordinates, limited to where this
    /// pass can draw.
    fn clip_to(&self, rect: Rect) -> Option<Area> {
        self.in_target(rect).intersect(self.bounds?)
    }
}

fn begin_render_pass<'e>(
    encoder: &'e mut wgpu::CommandEncoder,
    view: &wgpu::TextureView,
    load: wgpu::LoadOp<wgpu::Color>,
) -> wgpu::RenderPass<'e> {
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
    })
}

fn to_color(color: [f32; 4]) -> wgpu::Color {
    wgpu::Color { r: color[0].into(), g: color[1].into(), b: color[2].into(), a: color[3].into() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect { x, y, width, height }
    }

    #[test]
    fn a_pass_without_a_viewport_covers_its_target() {
        let placement = Placement::compute(100, 50, false, None, Scissor::Off);
        assert_eq!(placement.viewport, [0.0, 0.0, 100.0, 50.0]);
        assert_eq!(placement.quad, None);
        assert_eq!(placement.clip, Some(Area { x: 0, y: 0, w: 100, h: 50 }));
    }

    #[test]
    fn a_viewport_inside_a_texture_is_set_as_given() {
        let placement = Placement::compute(100, 50, false, Some([10, 5, 20, 30]), Scissor::Off);
        assert_eq!(placement.viewport, [10.0, 5.0, 20.0, 30.0]);
        assert_eq!(placement.quad, None);
        assert_eq!(placement.clip, Some(Area { x: 10, y: 5, w: 20, h: 30 }));
    }

    #[test]
    fn screen_rects_are_measured_from_the_bottom() {
        let placement = Placement::compute(100, 50, true, Some([10, 5, 20, 30]), Scissor::Rect(rect(0, 0, 100, 10)));
        // y up 5..35 is y down 15..45; the scissor's rows 0..10 are 40..50.
        assert_eq!(placement.viewport, [10.0, 15.0, 20.0, 30.0]);
        assert_eq!(placement.clip, Some(Area { x: 10, y: 40, w: 20, h: 5 }));
    }

    #[test]
    fn a_viewport_that_leaves_the_target_moves_the_triangle_instead() {
        // 40 wide at x = -10 on a 100-wide target: the triangle spans
        // texels -10..30, so its centre is at clip x = -0.8 and it is 0.4
        // of the target wide. 20 tall at y = 40 of 50: centre at row 50,
        // which is clip y = -1.
        let placement = Placement::compute(100, 50, false, Some([-10, 40, 40, 20]), Scissor::Off);
        assert_eq!(placement.viewport, [0.0, 0.0, 100.0, 50.0]);
        assert_eq!(placement.quad, Some([0.4, -0.4, -0.8, -1.0]));
        assert_eq!(placement.clip, Some(Area { x: 0, y: 40, w: 30, h: 10 }));
    }

    #[test]
    fn the_moved_triangle_puts_each_corner_where_the_viewport_would() {
        let (width, height) = (64, 32);
        let [vx, vy, vw, vh] = [-7, 3, 90, 40];
        let placement = Placement::compute(width, height, false, Some([vx, vy, vw, vh]), Scissor::Off);
        let [sx, sy, ox, oy] = placement.quad.unwrap();
        for (px, py) in [(-1.0f32, -1.0f32), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
            let texel_x = ((px * sx + ox) + 1.0) / 2.0 * width as f32;
            let texel_y = (1.0 - (py * sy + oy)) / 2.0 * height as f32;
            assert!((texel_x - (vx as f32 + (px + 1.0) / 2.0 * vw as f32)).abs() < 1e-3);
            assert!((texel_y - (vy as f32 + (py + 1.0) / 2.0 * vh as f32)).abs() < 1e-3);
        }
    }

    #[test]
    fn nothing_is_drawn_when_the_viewport_or_scissor_misses_the_target() {
        assert_eq!(Placement::compute(100, 50, false, Some([200, 0, 10, 10]), Scissor::Off).clip, None);
        assert_eq!(Placement::compute(100, 50, false, Some([0, 0, 0, 10]), Scissor::Off).clip, None);
        assert_eq!(Placement::compute(100, 50, false, None, Scissor::Rect(rect(100, 0, 5, 5))).clip, None);
    }

    #[test]
    fn a_scissor_is_limited_to_the_viewport_and_the_target() {
        let placement = Placement::compute(100, 50, false, Some([10, 10, 50, 50]), Scissor::Rect(rect(0, 0, 30, 100)));
        assert_eq!(placement.clip, Some(Area { x: 10, y: 10, w: 20, h: 40 }));
        assert_eq!(placement.clip_to(rect(40, 20, 100, 5)), Some(Area { x: 40, y: 20, w: 20, h: 5 }));
    }
}
