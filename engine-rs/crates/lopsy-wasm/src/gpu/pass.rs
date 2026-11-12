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

use lopsy_core::geometry::Rect;
use web_sys::WebGl2RenderingContext as GL;

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

    /// Run the pass. Returns `false`, having drawn nothing, if the target
    /// or one of the input textures no longer exists.
    pub fn draw(self, target: Target) -> bool {
        if self.has_missing_texture {
            return false;
        }
        let GpuRef { gl, textures, fbos, render_fbo } = self.gpu;

        let default_viewport = match target {
            Target::Texture(handle) => {
                let (Some(tex), Some((w, h))) = (textures.get(handle), textures.get_size(handle)) else {
                    return false;
                };
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

        match self.scissor {
            Scissor::Inherit => {}
            Scissor::Off => gl.disable(GL::SCISSOR_TEST),
            Scissor::Rect(rect) => {
                gl.enable(GL::SCISSOR_TEST);
                gl.scissor(rect.x, rect.y, rect.width as i32, rect.height as i32);
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

        gl.draw_arrays(GL::TRIANGLES, 0, 3);

        if self.blend.enables_blending() {
            gl.disable(GL::BLEND);
            gl.blend_equation(GL::FUNC_ADD);
            gl.blend_func(GL::ONE, GL::ZERO);
        }
        if matches!(self.scissor, Scissor::Rect(_)) {
            gl.disable(GL::SCISSOR_TEST);
        }
        if matches!(target, Target::Texture(_)) {
            fbos.unbind(gl);
        }
        true
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
