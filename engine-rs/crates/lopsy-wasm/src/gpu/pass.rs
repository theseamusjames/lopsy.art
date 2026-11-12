//! The pass layer: the one place feature code describes a draw.
//!
//! Every GPU operation in the engine has the same shape — run one fragment
//! shader over a full-screen triangle, with some uniforms and input
//! textures, into a target, optionally scissored and blended. A [`Pass`]
//! states exactly that and nothing else, so feature modules never touch
//! WebGL state themselves (docs/engine-migration-plan.md, Phase 1).
//!
//! ```ignore
//! engine.pass(&engine.shaders.blit)
//!     .texture("u_tex", src)
//!     .blend(Blend::Off)
//!     .draw(Target::Texture(dst));
//! ```
//!
//! While modules are still being moved onto this layer, converted and
//! unconverted code run side by side on one GL context. To keep that safe a
//! pass only changes the state it is told to set, and puts that state back
//! afterwards:
//!
//! - [`Blend::Inherit`] and [`Scissor::Inherit`] (the defaults) leave the
//!   context as found, exactly like the hand-written code they replace.
//! - A blend mode that enables blending is switched off again after the
//!   draw, and a scissor rect is disabled again.
//! - [`Target::Texture`] unbinds the framebuffer afterwards;
//!   [`Target::Framebuffer`] leaves it bound, as the code it replaces did.
//!
//! The `Inherit` variants exist only for that transition and go away once
//! every module is converted.
//!
//! Build and draw one pass before starting the next: a pass makes its
//! program current when it is created and sets uniforms as it is built.
//!
//! A tool that stamps many dabs with one shader uses [`Pass::begin`]
//! instead of [`Pass::draw`]. That sets the pass up once and returns an
//! [`ActivePass`], which redraws with only a uniform or two and the scissor
//! rect changing between draws.

use lopsy_core::geometry::Rect;
use web_sys::{WebGl2RenderingContext as GL, WebGlUniformLocation};

use crate::gpu::framebuffer::{FramebufferHandle, FramebufferPool};
use crate::gpu::shader::ShaderProgram;
use crate::gpu::texture_pool::{TextureHandle, TexturePool};

/// The GPU objects a pass draws with, borrowed from the engine.
#[derive(Clone, Copy)]
pub struct GpuRef<'a> {
    pub gl: &'a GL,
    pub textures: &'a TexturePool,
    pub fbos: &'a FramebufferPool,
    /// Reusable framebuffer that [`Target::Texture`] attaches its
    /// destination to.
    pub render_fbo: FramebufferHandle,
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
    /// Leave the context's blend state as found.
    #[default]
    Inherit,
    /// Replace the destination.
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
    /// Leave the context's scissor state as found.
    #[default]
    Inherit,
    /// The whole viewport.
    Off,
    /// Only `Rect`, in target texels.
    Rect(Rect),
}

impl<'a> GpuRef<'a> {
    /// Start a pass that runs `program`.
    pub fn pass(self, program: &'a ShaderProgram) -> Pass<'a> {
        self.gl.use_program(Some(&program.program));
        Pass {
            gpu: self,
            program,
            next_unit: 0,
            has_missing_texture: false,
            viewport: None,
            scissor: Scissor::Inherit,
            blend: Blend::Inherit,
            clear: None,
        }
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

    /// Fill `texture` with `color`. The context's scissor state still
    /// applies. Returns `false` if the texture no longer exists.
    pub fn clear(self, texture: TextureHandle, color: [f32; 4]) -> bool {
        let (Some(tex), Some((w, h))) = (self.textures.get(texture), self.textures.get_size(texture)) else {
            return false;
        };
        self.fbos.attach_texture(self.gl, self.render_fbo, tex);
        self.fbos.bind(self.gl, self.render_fbo);
        self.gl.viewport(0, 0, w as i32, h as i32);
        self.gl.clear_color(color[0], color[1], color[2], color[3]);
        self.gl.clear(GL::COLOR_BUFFER_BIT);
        self.fbos.unbind(self.gl);
        true
    }

    /// Read back `w × h` texels of `texture` starting at `(x, y)` as 16-bit
    /// RGBA.
    pub fn read_rgba_u16(self, texture: TextureHandle, x: i32, y: i32, w: u32, h: u32) -> Result<Vec<u16>, String> {
        let tex = self.textures.get(texture).ok_or("Texture not found")?;
        self.fbos.attach_texture(self.gl, self.render_fbo, tex);
        self.fbos.bind(self.gl, self.render_fbo);
        let result = self.textures.read_rgba_u16(self.gl, x, y, w, h);
        self.fbos.unbind(self.gl);
        result
    }

    /// Upload `w * h` single-byte values as a temporary R8 texture and run
    /// `program` over it into `dst`, with the bytes bound to `sampler` and
    /// blending off. This is how one-byte-per-texel data reaches a pooled
    /// texture without a CPU expansion to the pool's format.
    pub fn draw_r8_bytes(
        self,
        program: &ShaderProgram,
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

        gl.disable(GL::BLEND);
        self.fbos.attach_texture(gl, self.render_fbo, dst_tex);
        self.fbos.bind(gl, self.render_fbo);
        gl.viewport(0, 0, w as i32, h as i32);
        gl.use_program(Some(&program.program));
        gl.active_texture(GL::TEXTURE0);
        gl.bind_texture(GL::TEXTURE_2D, Some(&staging));
        if let Some(loc) = program.location(gl, sampler) {
            gl.uniform1i(Some(&loc), 0);
        }
        gl.draw_arrays(GL::TRIANGLES, 0, 3);
        self.fbos.unbind(gl);
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
        self.fbos.attach_texture(gl, self.render_fbo, tex);
        self.fbos.bind(gl, self.render_fbo);
        gl.viewport(0, 0, w as i32, h as i32);
        gl.enable(GL::SCISSOR_TEST);
        gl.scissor(rect.x, rect.y, rect.width as i32, rect.height as i32);
        gl.clear_color(color[0], color[1], color[2], color[3]);
        gl.clear(GL::COLOR_BUFFER_BIT);
        gl.disable(GL::SCISSOR_TEST);
        self.fbos.unbind(gl);
        true
    }

    /// Read back `w × h` texels of `texture` starting at `(x, y)` as RGBA8.
    pub fn read_rgba(self, texture: TextureHandle, x: i32, y: i32, w: u32, h: u32) -> Result<Vec<u8>, String> {
        let tex = self.textures.get(texture).ok_or("Texture not found")?;
        self.fbos.attach_texture(self.gl, self.render_fbo, tex);
        self.fbos.bind(self.gl, self.render_fbo);
        let result = self.textures.read_rgba(self.gl, x, y, w, h);
        self.fbos.unbind(self.gl);
        result
    }
}

/// One draw: a fragment shader, its inputs, and where the output goes.
/// Build it with the setters, then call [`Pass::draw`].
#[must_use = "a pass does nothing until `draw` is called"]
pub struct Pass<'a> {
    gpu: GpuRef<'a>,
    program: &'a ShaderProgram,
    next_unit: u32,
    has_missing_texture: bool,
    viewport: Option<[i32; 4]>,
    scissor: Scissor,
    blend: Blend,
    clear: Option<[f32; 4]>,
}

impl<'a> Pass<'a> {
    /// Bind `texture` to the sampler uniform `name`. Textures take texture
    /// units in the order they are added. If the handle is stale the pass
    /// is not drawn and [`Pass::draw`] returns `false`.
    pub fn texture(mut self, name: &str, texture: TextureHandle) -> Self {
        let unit = self.next_unit;
        self.next_unit += 1;
        let gl = self.gpu.gl;
        match self.gpu.textures.get(texture) {
            Some(tex) => {
                gl.active_texture(GL::TEXTURE0 + unit);
                gl.bind_texture(GL::TEXTURE_2D, Some(tex));
                if let Some(loc) = self.program.location(gl, name) {
                    gl.uniform1i(Some(&loc), unit as i32);
                }
            }
            None => self.has_missing_texture = true,
        }
        self
    }

    pub fn i32(self, name: &str, value: i32) -> Self {
        if let Some(loc) = self.program.location(self.gpu.gl, name) {
            self.gpu.gl.uniform1i(Some(&loc), value);
        }
        self
    }

    pub fn u32(self, name: &str, value: u32) -> Self {
        if let Some(loc) = self.program.location(self.gpu.gl, name) {
            self.gpu.gl.uniform1ui(Some(&loc), value);
        }
        self
    }

    pub fn ivec2(self, name: &str, x: i32, y: i32) -> Self {
        if let Some(loc) = self.program.location(self.gpu.gl, name) {
            self.gpu.gl.uniform2i(Some(&loc), x, y);
        }
        self
    }

    pub fn f32(self, name: &str, value: f32) -> Self {
        if let Some(loc) = self.program.location(self.gpu.gl, name) {
            self.gpu.gl.uniform1f(Some(&loc), value);
        }
        self
    }

    pub fn vec2(self, name: &str, x: f32, y: f32) -> Self {
        if let Some(loc) = self.program.location(self.gpu.gl, name) {
            self.gpu.gl.uniform2f(Some(&loc), x, y);
        }
        self
    }

    pub fn vec3(self, name: &str, x: f32, y: f32, z: f32) -> Self {
        if let Some(loc) = self.program.location(self.gpu.gl, name) {
            self.gpu.gl.uniform3f(Some(&loc), x, y, z);
        }
        self
    }

    pub fn vec4(self, name: &str, x: f32, y: f32, z: f32, w: f32) -> Self {
        if let Some(loc) = self.program.location(self.gpu.gl, name) {
            self.gpu.gl.uniform4f(Some(&loc), x, y, z, w);
        }
        self
    }

    pub fn f32_array(self, name: &str, values: &[f32]) -> Self {
        if let Some(loc) = self.program.location(self.gpu.gl, name) {
            self.gpu.gl.uniform1fv_with_f32_array(Some(&loc), values);
        }
        self
    }

    /// Column-major 2×2 matrix.
    pub fn mat2(self, name: &str, value: &[f32; 4]) -> Self {
        if let Some(loc) = self.program.location(self.gpu.gl, name) {
            self.gpu.gl.uniform_matrix2fv_with_f32_array(Some(&loc), false, value);
        }
        self
    }

    /// Column-major 3×3 matrix.
    pub fn mat3(self, name: &str, value: &[f32; 9]) -> Self {
        if let Some(loc) = self.program.location(self.gpu.gl, name) {
            self.gpu.gl.uniform_matrix3fv_with_f32_array(Some(&loc), false, value);
        }
        self
    }

    /// Set uniforms with a helper that still takes the raw GL context and
    /// program. Only for helpers in modules that have not moved onto the
    /// pass layer yet; it goes away with them.
    pub fn raw_uniforms(self, set: impl FnOnce(&GL, &ShaderProgram)) -> Self {
        set(self.gpu.gl, self.program);
        self
    }

    /// Draw into this part of the target instead of the default.
    pub fn viewport(mut self, x: i32, y: i32, width: i32, height: i32) -> Self {
        self.viewport = Some([x, y, width, height]);
        self
    }

    pub fn scissor(mut self, scissor: Scissor) -> Self {
        self.scissor = scissor;
        self
    }

    pub fn blend(mut self, blend: Blend) -> Self {
        self.blend = blend;
        self
    }

    /// Clear the target to `color` before drawing. Like the draw itself,
    /// the clear is limited by the scissor.
    pub fn clear(mut self, color: [f32; 4]) -> Self {
        self.clear = Some(color);
        self
    }

    /// Draw the pass into a temporary `w`×`h` 8-bit target and read that
    /// back. Reading an 8-bit target is fast on every driver, where reading
    /// a float one is not, and an R8 target moves a quarter of the bytes.
    /// Returns `None` if an input texture no longer exists, the staging
    /// objects cannot be created or the read fails.
    pub fn read_back(self, format: ReadFormat, w: u32, h: u32) -> Option<Vec<u8>> {
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
        match self.blend {
            Blend::Inherit => {}
            _ => gl.disable(GL::BLEND),
        }

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

    /// Run the pass. Returns `false`, having drawn nothing, if the target
    /// or one of the input textures no longer exists.
    pub fn draw(self, target: Target) -> bool {
        match self.begin(target) {
            Some(active) => {
                active.draw();
                active.end();
                true
            }
            None => false,
        }
    }

    /// Set the pass up for several draws. Returns `None`, having changed
    /// no target or blend state, if the target or one of the input textures
    /// no longer exists. Call [`ActivePass::end`] when done.
    pub fn begin(self, target: Target) -> Option<ActivePass<'a>> {
        if self.has_missing_texture {
            return None;
        }
        let GpuRef { gl, textures, fbos, render_fbo } = self.gpu;

        let default_viewport = match target {
            Target::Texture(handle) => {
                let (tex, (w, h)) = (textures.get(handle)?, textures.get_size(handle)?);
                fbos.attach_texture(gl, render_fbo, tex);
                fbos.bind(gl, render_fbo);
                Some([0, 0, w as i32, h as i32])
            }
            Target::Framebuffer(fbo) => {
                fbos.bind(gl, fbo);
                None
            }
            Target::Screen => {
                fbos.unbind(gl);
                None
            }
        };
        if let Some([x, y, w, h]) = self.viewport.or(default_viewport) {
            gl.viewport(x, y, w, h);
        }

        let mut is_scissor_enabled = false;
        match self.scissor {
            Scissor::Inherit => {}
            Scissor::Off => gl.disable(GL::SCISSOR_TEST),
            Scissor::Rect(rect) => {
                gl.enable(GL::SCISSOR_TEST);
                gl.scissor(rect.x, rect.y, rect.width as i32, rect.height as i32);
                is_scissor_enabled = true;
            }
        }

        match self.blend {
            Blend::Inherit => {}
            Blend::Off => gl.disable(GL::BLEND),
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

        Some(ActivePass {
            gpu: self.gpu,
            program: self.program,
            target,
            blend: self.blend,
            is_scissor_enabled,
        })
    }
}

/// A uniform of the pass's program, looked up once so a loop of draws can
/// set it without a name lookup each time.
pub struct UniformSlot(Option<WebGlUniformLocation>);

/// A pass that has been set up and can draw repeatedly. Made by
/// [`Pass::begin`]; finish with [`ActivePass::end`].
#[must_use = "call `end` to put the pass's blend, scissor and target state back"]
pub struct ActivePass<'a> {
    gpu: GpuRef<'a>,
    program: &'a ShaderProgram,
    target: Target,
    blend: Blend,
    is_scissor_enabled: bool,
}

impl ActivePass<'_> {
    pub fn slot(&self, name: &str) -> UniformSlot {
        UniformSlot(self.program.location(self.gpu.gl, name))
    }

    pub fn set_i32(&self, slot: &UniformSlot, value: i32) {
        if let Some(loc) = &slot.0 {
            self.gpu.gl.uniform1i(Some(loc), value);
        }
    }

    pub fn set_f32(&self, slot: &UniformSlot, value: f32) {
        if let Some(loc) = &slot.0 {
            self.gpu.gl.uniform1f(Some(loc), value);
        }
    }

    pub fn set_vec2(&self, slot: &UniformSlot, x: f32, y: f32) {
        if let Some(loc) = &slot.0 {
            self.gpu.gl.uniform2f(Some(loc), x, y);
        }
    }

    pub fn set_vec4(&self, slot: &UniformSlot, x: f32, y: f32, z: f32, w: f32) {
        if let Some(loc) = &slot.0 {
            self.gpu.gl.uniform4f(Some(loc), x, y, z, w);
        }
    }

    /// Draw with the scissor state the pass began with.
    pub fn draw(&self) {
        self.gpu.gl.draw_arrays(GL::TRIANGLES, 0, 3);
    }

    /// Draw limited to `rect`, in target texels. The scissor test stays on
    /// for the pass's later draws, so each one names its own rect.
    pub fn draw_in(&mut self, rect: Rect) {
        let gl = self.gpu.gl;
        if !self.is_scissor_enabled {
            gl.enable(GL::SCISSOR_TEST);
            self.is_scissor_enabled = true;
        }
        gl.scissor(rect.x, rect.y, rect.width as i32, rect.height as i32);
        gl.draw_arrays(GL::TRIANGLES, 0, 3);
    }

    /// Put back the state the pass changed.
    pub fn end(self) {
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
            self.gpu.fbos.unbind(gl);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_compositing_modes_enable_blending() {
        assert!(!Blend::Inherit.enables_blending());
        assert!(!Blend::Off.enables_blending());
        assert!(Blend::PremulOver.enables_blending());
        assert!(Blend::Max.enables_blending());
        assert!(Blend::OverKeepAlpha.enables_blending());
    }

    #[test]
    fn a_pass_inherits_blend_and_scissor_unless_told_otherwise() {
        assert_eq!(Blend::default(), Blend::Inherit);
        assert_eq!(Scissor::default(), Scissor::Inherit);
    }
}
