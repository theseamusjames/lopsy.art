//! The pass layer: the one place feature code describes a draw.
//!
//! Every GPU operation in the engine has the same shape — run one fragment
//! shader over a full-screen triangle, with some uniforms and input
//! textures, into a target, optionally scissored and blended. A [`Pass`]
//! states exactly that and nothing else, so feature modules never touch
//! graphics API state themselves (docs/engine-migration-plan.md, Phase 1).
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
//! Build and draw one pass before starting the next: a backend may make
//! the pass's program current and upload its uniforms when it is created.
//!
//! A tool that stamps many dabs with one shader uses [`Pass::begin`]
//! instead of [`Pass::draw`]. That sets the pass up once and returns an
//! [`ActivePass`], which redraws with only the changed uniforms and the
//! scissor rect sent between draws.
//!
//! This file is the typed front of the layer and is the same for every
//! backend. What a pass does to the graphics API is in the backend's own
//! `pass` module.

use std::marker::PhantomData;

use lopsy_core::geometry::Rect;

use crate::gpu::backend::pass::{RawActivePass, RawPass};
use crate::gpu::framebuffer::FramebufferHandle;
use crate::gpu::shader::ShaderProgram;
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::uniforms::Uniforms;

pub use crate::gpu::backend::pass::GpuRef;

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

/// Byte layout of a readback through an 8-bit staging target.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadFormat {
    /// The red channel only, one byte per texel.
    R8,
    /// Four bytes per texel.
    Rgba8,
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
    /// Start a pass that runs `program` with `params` as its uniforms.
    pub fn pass<P: Uniforms>(self, program: &'a ShaderProgram<P>, params: P) -> Pass<'a, P> {
        let raw = self.raw_pass(program.linked(), P::FIELDS, &|sink| params.put(sink));
        Pass { raw, marker: PhantomData }
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
        self.raw.viewport(x, y, width, height);
        self
    }

    pub fn scissor(mut self, scissor: Scissor) -> Self {
        self.raw.scissor(scissor);
        self
    }

    pub fn blend(mut self, blend: Blend) -> Self {
        self.raw.blend(blend);
        self
    }

    /// Clear the target to `color` before drawing. Like the draw itself,
    /// the clear is limited by the scissor.
    pub fn clear(mut self, color: [f32; 4]) -> Self {
        self.raw.clear(color);
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
/// A pass that has been set up and can draw repeatedly. Made by
/// [`Pass::begin`]; finish with [`ActivePass::end`].
pub struct ActivePass<'a, P> {
    raw: RawActivePass<'a>,
    marker: PhantomData<fn(P)>,
}
impl<P: Uniforms> ActivePass<'_, P> {
    /// Change the pass's uniforms for its next draws. Only the fields that
    /// differ from the previous values are sent.
    pub fn set(&self, params: &P) {
        self.raw.set(P::FIELDS, &|sink| params.put(sink));
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
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pass_replaces_the_whole_target_unless_told_otherwise() {
        assert_eq!(Blend::default(), Blend::Off);
        assert_eq!(Scissor::default(), Scissor::Off);
    }
}
