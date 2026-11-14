//! The pass layer: the one place feature code describes a draw.
//!
//! Every GPU operation in the engine has the same shape — run one fragment
//! shader over a full-screen triangle, with some uniforms and input
//! textures, into a target, optionally scissored and blended. A [`Pass`]
//! states exactly that and nothing else, so feature modules never touch
//! WebGL state themselves (docs/engine-migration-plan.md, Phase 1).
//!
//! ```ignore
//! engine.pass(&engine.shaders.posterize, PosterizeParams { levels: 4.0 })
//!     .texture("u_tex", src)
//!     .draw(Target::Texture(dst));
//! ```
//!
//! A pass is created with the shader's uniform struct (`gpu::uniforms`),
//! or `()` for a shader that only samples textures, so no uniform can be
//! left holding what an earlier pass set.
//!
//! Between passes the context is in one known state: blending off and the
//! scissor test off. A pass that turns either on turns it off again when it
//! ends, and nothing outside this module can touch them, so a pass that
//! needs them off has nothing to set. [`Target::Texture`] unbinds the
//! framebuffer afterwards; [`Target::Framebuffer`] leaves it bound.
//!
//! Build and draw one pass before starting the next: a pass makes its
//! program current and uploads its uniforms when it is created.
//!
//! A tool that stamps many dabs with one shader uses [`Pass::begin`]
//! instead of [`Pass::draw`]. That sets the pass up once and returns an
//! [`ActivePass`], which redraws with only the changed uniforms and the
//! scissor rect sent between draws.

use std::marker::PhantomData;

use lopsy_core::geometry::Rect;
use wasm_bindgen::JsCast;
use web_sys::WebGl2RenderingContext as GL;

use crate::gpu::context::GpuContext;
use crate::gpu::framebuffer::{FramebufferHandle, FramebufferPool};
use crate::gpu::shader::{upload_params, LinkedProgram, ShaderProgram};
use crate::gpu::texture_pool::{TextureHandle, TexturePool};
use crate::gpu::uniforms::Uniforms;

/// The GPU objects a pass draws with, borrowed from the engine.
#[derive(Clone, Copy)]
pub struct GpuRef<'a> {
    gl: &'a GL,
    textures: &'a TexturePool,
    fbos: &'a FramebufferPool,
    /// Reusable framebuffer that [`Target::Texture`] attaches its
    /// destination to.
    render_fbo: FramebufferHandle,
}

/// Where a pass draws.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    /// A pooled texture. The viewport defaults to the whole texture.
    Texture(TextureHandle),
    /// A persistent framebuffer the engine keeps (composite, scratch,
    /// stroke). Set the viewport explicitly; the framebuffer stays bound.
    Framebuffer(FramebufferHandle),
    /// The canvas. Set the viewport explicitly.
    Screen,
}

/// How a pass combines its output with what the target already holds.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Blend {
    /// Replace the destination.
    #[default]
    Off,
    /// Premultiplied source over destination: `src + dst * (1 - src.a)`.
    PremulOver,
    /// Per-channel maximum of source and destination.
    Max,
    /// Straight-alpha source over destination, keeping destination alpha:
    /// `rgb = src.rgb * src.a + dst.rgb * (1 - src.a)`, `a = dst.a`.
    OverKeepAlpha,
}

impl Blend {
    fn enables_blending(self) -> bool {
        matches!(self, Blend::PremulOver | Blend::Max | Blend::OverKeepAlpha)
    }
}

/// Byte layout of a readback through an 8-bit staging target.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadFormat {
    /// The red channel only, one byte per texel.
    R8,
    /// Four bytes per texel.
    Rgba8,
}

impl ReadFormat {
    fn bytes_per_texel(self) -> u32 {
        match self {
            ReadFormat::R8 => 1,
            ReadFormat::Rgba8 => 4,
        }
    }
}

/// Which texels of the target a pass may write.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Scissor {
    /// The whole viewport.
    #[default]
    Off,
    /// Only `Rect`, in target texels.
    Rect(Rect),
}

impl<'a> GpuRef<'a> {
    pub fn new(ctx: &'a GpuContext, textures: &'a TexturePool, fbos: &'a FramebufferPool, render_fbo: FramebufferHandle) -> Self {
        Self { gl: &ctx.gl, textures, fbos, render_fbo }
    }

    /// Start a pass that runs `program` with `params` as its uniforms.
    pub fn pass<P: Uniforms>(self, program: &'a ShaderProgram<P>, params: P) -> Pass<'a, P> {
        let program = program.linked();
        self.gl.use_program(Some(&program.program));
        upload_params(program, self.gl, &params);
        Pass { raw: RawPass::new(self, program), marker: PhantomData }
    }

    /// Whether `texture` still names a live texture.
    pub fn has_texture(self, texture: TextureHandle) -> bool {
        self.textures.get(texture).is_some()
    }

    /// Unbind the textures on units `0..count`, leaving unit 0 active. A
    /// texture left bound to a sampler unit while it is also a render target
    /// is a feedback loop, and some drivers then discard the draw. Call this
    /// before rendering into a texture an earlier pass sampled.
    pub fn unbind_textures(self, count: u32) {
        for unit in (0..count).rev() {
            self.gl.active_texture(GL::TEXTURE0 + unit);
            self.gl.bind_texture(GL::TEXTURE_2D, None);
        }
    }

    /// Fill `texture` with `color`. Returns `false` if the texture no longer
    /// exists.
    pub fn clear(self, texture: TextureHandle, color: [f32; 4]) -> bool {
        let (Some(tex), Some((w, h))) = (self.textures.get(texture), self.textures.get_size(texture)) else {
            return false;
        };
        self.fbos.attach_texture(self.render_fbo, tex);
        self.fbos.bind(self.render_fbo);
        self.gl.viewport(0, 0, w as i32, h as i32);
        self.gl.clear_color(color[0], color[1], color[2], color[3]);
        self.gl.clear(GL::COLOR_BUFFER_BIT);
        self.fbos.unbind();
        true
    }

    /// Read back `w × h` texels of `texture` starting at `(x, y)` as 16-bit
    /// RGBA.
    pub fn read_rgba_u16(self, texture: TextureHandle, x: i32, y: i32, w: u32, h: u32) -> Result<Vec<u16>, String> {
        let tex = self.textures.get(texture).ok_or("Texture not found")?;
        self.fbos.attach_texture(self.render_fbo, tex);
        self.fbos.bind(self.render_fbo);
        let result = self.textures.read_rgba_u16(x, y, w, h);
        self.fbos.unbind();
        result
    }

    /// Upload `w * h` single-byte values as a temporary R8 texture and run
    /// `program` over it into `dst`, with the bytes bound to `sampler` and
    /// blending off. This is how one-byte-per-texel data reaches a pooled
    /// texture without a CPU expansion to the pool's format.
    pub fn draw_r8_bytes<P>(
        self,
        program: &ShaderProgram<P>,
        sampler: &str,
        bytes: &[u8],
        w: u32,
        h: u32,
        dst: TextureHandle,
    ) -> Result<(), String> {
        let gl = self.gl;
        let Some(dst_tex) = self.textures.get(dst) else {
            return Err("Destination texture not found".into());
        };
        let staging = gl.create_texture().ok_or("Failed to create mask staging texture")?;
        gl.bind_texture(GL::TEXTURE_2D, Some(&staging));
        gl.tex_storage_2d(GL::TEXTURE_2D, 1, GL::R8, w as i32, h as i32);
        gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_MIN_FILTER, GL::NEAREST as i32);
        gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_MAG_FILTER, GL::NEAREST as i32);
        gl.pixel_storei(GL::UNPACK_FLIP_Y_WEBGL, 0);
        // Rows of 1-byte texels are not 4-byte aligned unless w is.
        gl.pixel_storei(GL::UNPACK_ALIGNMENT, 1);
        let uploaded = gl.tex_sub_image_2d_with_i32_and_i32_and_u32_and_type_and_opt_u8_array(
            GL::TEXTURE_2D,
            0, 0, 0,
            w as i32, h as i32,
            GL::RED,
            GL::UNSIGNED_BYTE,
            Some(bytes),
        );
        gl.pixel_storei(GL::UNPACK_ALIGNMENT, 4);
        if uploaded.is_err() {
            gl.delete_texture(Some(&staging));
            return Err("Failed to upload mask bytes".into());
        }

        self.fbos.attach_texture(self.render_fbo, dst_tex);
        self.fbos.bind(self.render_fbo);
        gl.viewport(0, 0, w as i32, h as i32);
        let program = program.linked();
        gl.use_program(Some(&program.program));
        gl.active_texture(GL::TEXTURE0);
        gl.bind_texture(GL::TEXTURE_2D, Some(&staging));
        if let Some(loc) = program.location(gl, sampler) {
            gl.uniform1i(Some(&loc), 0);
        }
        gl.draw_arrays(GL::TRIANGLES, 0, 3);
        self.fbos.unbind();
        gl.delete_texture(Some(&staging));
        Ok(())
    }

    /// Fill `rect` of `texture` (in texels) with `color`, leaving the rest
    /// untouched. Returns `false` if the texture no longer exists.
    pub fn clear_rect(self, texture: TextureHandle, rect: Rect, color: [f32; 4]) -> bool {
        let (Some(tex), Some((w, h))) = (self.textures.get(texture), self.textures.get_size(texture)) else {
            return false;
        };
        let gl = self.gl;
        self.fbos.attach_texture(self.render_fbo, tex);
        self.fbos.bind(self.render_fbo);
        gl.viewport(0, 0, w as i32, h as i32);
        gl.enable(GL::SCISSOR_TEST);
        gl.scissor(rect.x, rect.y, rect.width as i32, rect.height as i32);
        gl.clear_color(color[0], color[1], color[2], color[3]);
        gl.clear(GL::COLOR_BUFFER_BIT);
        gl.disable(GL::SCISSOR_TEST);
        self.fbos.unbind();
        true
    }

    /// Copy `region` of `src`'s colour attachment to the origin of `dst`,
    /// texel for texel. Returns `false` if `dst` no longer exists.
    pub fn copy_region(self, src: FramebufferHandle, region: Rect, dst: TextureHandle) -> bool {
        let Some(tex) = self.textures.get(dst) else {
            return false;
        };
        self.fbos.attach_texture(self.render_fbo, tex);
        self.fbos.blit_region(src,
            self.render_fbo,
            (region.x, region.y, region.width as i32, region.height as i32),
            (0, 0),
        );
        self.fbos.unbind();
        true
    }

    /// Size of the canvas [`Target::Screen`] draws to, in device pixels.
    pub fn screen_size(self) -> Result<(i32, i32), String> {
        let canvas = self.gl.canvas().ok_or("WebGL canvas missing")?;
        let canvas: web_sys::HtmlCanvasElement =
            canvas.dyn_into().map_err(|_| "canvas is not HtmlCanvasElement")?;
        Ok((canvas.width() as i32, canvas.height() as i32))
    }

    /// Read back `w × h` texels of `texture` starting at `(x, y)` as RGBA8.
    pub fn read_rgba(self, texture: TextureHandle, x: i32, y: i32, w: u32, h: u32) -> Result<Vec<u8>, String> {
        let tex = self.textures.get(texture).ok_or("Texture not found")?;
        self.fbos.attach_texture(self.render_fbo, tex);
        self.fbos.bind(self.render_fbo);
        let result = self.textures.read_rgba(x, y, w, h);
        self.fbos.unbind();
        result
    }
}

/// One draw: a fragment shader, its inputs, and where the output goes.
/// Build it with the setters, then call [`Pass::draw`]. `P` is the uniform
/// struct the pass was created with.
#[must_use = "a pass does nothing until `draw` is called"]
pub struct Pass<'a, P> {
    raw: RawPass<'a>,
    marker: PhantomData<fn(P)>,
}

/// A [`Pass`] without its uniform struct's type: what the methods below
/// work on, so their code is compiled once and not once per shader.
struct RawPass<'a> {
    gpu: GpuRef<'a>,
    program: &'a LinkedProgram,
    next_unit: u32,
    has_missing_texture: bool,
    viewport: Option<[i32; 4]>,
    scissor: Scissor,
    blend: Blend,
    clear: Option<[f32; 4]>,
}

impl<'a, P> Pass<'a, P> {
    /// Bind `texture` to the sampler uniform `name`. Textures take texture
    /// units in the order they are added. If the handle is stale the pass
    /// is not drawn and [`Pass::draw`] returns `false`.
    pub fn texture(mut self, name: &str, texture: TextureHandle) -> Self {
        self.raw.texture(name, texture);
        self
    }

    /// Point the sampler uniform `name` at texture unit `unit` without
    /// binding anything to it, for a sampler the shader will not read in
    /// this pass. Left at its default unit it could alias the render target.
    pub fn sampler_unit(self, name: &str, unit: i32) -> Self {
        self.raw.sampler_unit(name, unit);
        self
    }

    /// Draw into this part of the target instead of the default.
    pub fn viewport(mut self, x: i32, y: i32, width: i32, height: i32) -> Self {
        self.raw.viewport = Some([x, y, width, height]);
        self
    }

    pub fn scissor(mut self, scissor: Scissor) -> Self {
        self.raw.scissor = scissor;
        self
    }

    pub fn blend(mut self, blend: Blend) -> Self {
        self.raw.blend = blend;
        self
    }

    /// Clear the target to `color` before drawing. Like the draw itself,
    /// the clear is limited by the scissor.
    pub fn clear(mut self, color: [f32; 4]) -> Self {
        self.raw.clear = Some(color);
        self
    }

    /// Draw the pass into a temporary `w`×`h` 8-bit target and read that
    /// back. Reading an 8-bit target is fast on every driver, where reading
    /// a float one is not, and an R8 target moves a quarter of the bytes.
    /// Returns `None` if an input texture no longer exists, the staging
    /// objects cannot be created or the read fails.
    pub fn read_back(self, format: ReadFormat, w: u32, h: u32) -> Option<Vec<u8>> {
        self.raw.read_back(format, w, h)
    }

    /// Run the pass. Returns `false`, having drawn nothing, if the target
    /// or one of the input textures no longer exists.
    pub fn draw(self, target: Target) -> bool {
        self.raw.draw(target)
    }

    /// Set the pass up for several draws. Returns `None`, having changed
    /// no target or blend state, if the target or one of the input textures
    /// no longer exists. Call [`ActivePass::end`] when done.
    pub fn begin(self, target: Target) -> Option<ActivePass<'a, P>> {
        self.raw.begin(target).map(|raw| ActivePass { raw, marker: PhantomData })
    }
}

impl<'a> RawPass<'a> {
    fn new(gpu: GpuRef<'a>, program: &'a LinkedProgram) -> Self {
        RawPass {
            gpu,
            program,
            next_unit: 0,
            has_missing_texture: false,
            viewport: None,
            scissor: Scissor::Off,
            blend: Blend::Off,
            clear: None,
        }
    }

    fn texture(&mut self, name: &str, texture: TextureHandle) {
        let unit = self.next_unit;
        self.next_unit += 1;
        let gl = self.gpu.gl;
        match self.gpu.textures.get(texture) {
            Some(tex) => {
                gl.active_texture(GL::TEXTURE0 + unit);
                gl.bind_texture(GL::TEXTURE_2D, Some(tex));
                self.program.with_location(gl, name, |loc| gl.uniform1i(Some(loc), unit as i32));
            }
            None => self.has_missing_texture = true,
        }
    }


    fn sampler_unit(&self, name: &str, unit: i32) {
        self.program.with_location(self.gpu.gl, name, |loc| self.gpu.gl.uniform1i(Some(loc), unit));
    }

    fn read_back(self, format: ReadFormat, w: u32, h: u32) -> Option<Vec<u8>> {
        if self.has_missing_texture {
            return None;
        }
        let gl = self.gpu.gl;

        // Set the staging texture up on a unit the pass does not sample
        // from, then unbind it: it must not sit on a sampler unit while it
        // is the render target.
        gl.active_texture(GL::TEXTURE0 + self.next_unit);
        let staging = gl.create_texture()?;
        gl.bind_texture(GL::TEXTURE_2D, Some(&staging));
        let internal = match format {
            ReadFormat::R8 => GL::R8,
            ReadFormat::Rgba8 => GL::RGBA8,
        };
        gl.tex_storage_2d(GL::TEXTURE_2D, 1, internal, w as i32, h as i32);
        gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_MIN_FILTER, GL::NEAREST as i32);
        gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_MAG_FILTER, GL::NEAREST as i32);
        gl.bind_texture(GL::TEXTURE_2D, None);
        gl.active_texture(GL::TEXTURE0);

        let Some(fbo) = gl.create_framebuffer() else {
            gl.delete_texture(Some(&staging));
            return None;
        };
        gl.bind_framebuffer(GL::FRAMEBUFFER, Some(&fbo));
        gl.framebuffer_texture_2d(GL::FRAMEBUFFER, GL::COLOR_ATTACHMENT0, GL::TEXTURE_2D, Some(&staging), 0);
        gl.viewport(0, 0, w as i32, h as i32);
        gl.draw_arrays(GL::TRIANGLES, 0, 3);

        let mut pixels = vec![0u8; (w * h * format.bytes_per_texel()) as usize];
        let is_read = match format {
            ReadFormat::R8 => {
                // With 1-byte texels and a width that is not a multiple of
                // 4, the default PACK_ALIGNMENT of 4 expects padded rows and
                // rejects the tightly sized buffer (#1057).
                gl.pixel_storei(GL::PACK_ALIGNMENT, 1);
                let result = gl.read_pixels_with_opt_u8_array(
                    0, 0, w as i32, h as i32, GL::RED, GL::UNSIGNED_BYTE, Some(&mut pixels),
                );
                gl.pixel_storei(GL::PACK_ALIGNMENT, 4);
                result.is_ok()
            }
            ReadFormat::Rgba8 => gl
                .read_pixels_with_opt_u8_array(
                    0, 0, w as i32, h as i32, GL::RGBA, GL::UNSIGNED_BYTE, Some(&mut pixels),
                )
                .is_ok(),
        };

        gl.bind_framebuffer(GL::FRAMEBUFFER, None);
        gl.delete_framebuffer(Some(&fbo));
        gl.delete_texture(Some(&staging));

        is_read.then_some(pixels)
    }

    fn draw(self, target: Target) -> bool {
        match self.begin(target) {
            Some(active) => {
                active.draw();
                true
            }
            None => false,
        }
    }

    fn begin(self, target: Target) -> Option<RawActivePass<'a>> {
        if self.has_missing_texture {
            return None;
        }
        let GpuRef { gl, textures, fbos, render_fbo } = self.gpu;

        let default_viewport = match target {
            Target::Texture(handle) => {
                let (tex, (w, h)) = (textures.get(handle)?, textures.get_size(handle)?);
                fbos.attach_texture(render_fbo, tex);
                fbos.bind(render_fbo);
                Some([0, 0, w as i32, h as i32])
            }
            Target::Framebuffer(fbo) => {
                fbos.bind(fbo);
                None
            }
            Target::Screen => {
                fbos.unbind();
                None
            }
        };
        if let Some([x, y, w, h]) = self.viewport.or(default_viewport) {
            gl.viewport(x, y, w, h);
        }

        let mut is_scissor_enabled = false;
        match self.scissor {
            Scissor::Off => {}
            Scissor::Rect(rect) => {
                gl.enable(GL::SCISSOR_TEST);
                gl.scissor(rect.x, rect.y, rect.width as i32, rect.height as i32);
                is_scissor_enabled = true;
            }
        }

        match self.blend {
            Blend::Off => {}
            Blend::PremulOver => {
                gl.enable(GL::BLEND);
                gl.blend_equation(GL::FUNC_ADD);
                gl.blend_func(GL::ONE, GL::ONE_MINUS_SRC_ALPHA);
            }
            Blend::Max => {
                gl.enable(GL::BLEND);
                gl.blend_equation(GL::MAX);
            }
            Blend::OverKeepAlpha => {
                gl.enable(GL::BLEND);
                gl.blend_equation(GL::FUNC_ADD);
                gl.blend_func_separate(GL::SRC_ALPHA, GL::ONE_MINUS_SRC_ALPHA, GL::ZERO, GL::ONE);
            }
        }

        if let Some([r, g, b, a]) = self.clear {
            gl.clear_color(r, g, b, a);
            gl.clear(GL::COLOR_BUFFER_BIT);
        }

        Some(RawActivePass {
            gpu: self.gpu,
            program: self.program,
            target,
            blend: self.blend,
            is_scissor_enabled,
        })
    }
}

/// A pass that has been set up and can draw repeatedly. Made by
/// [`Pass::begin`]; finish with [`ActivePass::end`].
pub struct ActivePass<'a, P> {
    raw: RawActivePass<'a>,
    marker: PhantomData<fn(P)>,
}

struct RawActivePass<'a> {
    gpu: GpuRef<'a>,
    program: &'a LinkedProgram,
    target: Target,
    blend: Blend,
    is_scissor_enabled: bool,
}

impl<P: Uniforms> ActivePass<'_, P> {
    /// Change the pass's uniforms for its next draws. Only the fields that
    /// differ from the previous values are sent.
    pub fn set(&self, params: &P) {
        upload_params(self.raw.program, self.raw.gpu.gl, params);
    }
}

impl<P> ActivePass<'_, P> {
    /// Draw with the scissor state the pass began with.
    pub fn draw(&self) {
        self.raw.draw();
    }

    /// Draw limited to `rect`, in target texels. The scissor test stays on
    /// for the pass's later draws, so each one names its own rect.
    pub fn draw_in(&mut self, rect: Rect) {
        self.raw.draw_in(rect);
    }

    /// Finish the pass, putting back the state it changed.
    pub fn end(self) {}
}

impl RawActivePass<'_> {
    fn draw(&self) {
        self.gpu.gl.draw_arrays(GL::TRIANGLES, 0, 3);
    }

    fn draw_in(&mut self, rect: Rect) {
        let gl = self.gpu.gl;
        if !self.is_scissor_enabled {
            gl.enable(GL::SCISSOR_TEST);
            self.is_scissor_enabled = true;
        }
        gl.scissor(rect.x, rect.y, rect.width as i32, rect.height as i32);
        gl.draw_arrays(GL::TRIANGLES, 0, 3);
    }
}

impl Drop for RawActivePass<'_> {
    /// Restores the between-passes state however the pass ends, so an early
    /// return cannot leave blending or the scissor test on.
    fn drop(&mut self) {
        let gl = self.gpu.gl;
        if self.blend.enables_blending() {
            gl.disable(GL::BLEND);
            gl.blend_equation(GL::FUNC_ADD);
            gl.blend_func(GL::ONE, GL::ZERO);
        }
        if self.is_scissor_enabled {
            gl.disable(GL::SCISSOR_TEST);
        }
        if matches!(self.target, Target::Texture(_)) {
            self.gpu.fbos.unbind();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_compositing_modes_enable_blending() {
        assert!(!Blend::Off.enables_blending());
        assert!(Blend::PremulOver.enables_blending());
        assert!(Blend::Max.enables_blending());
        assert!(Blend::OverKeepAlpha.enables_blending());
    }

    #[test]
    fn a_pass_replaces_the_whole_target_unless_told_otherwise() {
        assert_eq!(Blend::default(), Blend::Off);
        assert_eq!(Scissor::default(), Scissor::Off);
    }
}
