//! Image operations that know nothing about documents or layers.
//!
//! Each takes what it draws with ([`Imaging`]), a source texture and its
//! parameters, and returns the pass that applies it. The caller says where
//! the pass draws. The compositor and the filter commands are two callers;
//! a raw developer with no layer stack would be a third.

pub mod adjustments;
pub mod filters;

use crate::gpu::framebuffer::FramebufferHandle;
use crate::gpu::pass::{GpuRef, Target};
use crate::gpu::shader::ShaderPrograms;
use crate::gpu::texture_pool::TextureHandle;

/// The GPU and the shader set: all an imaging operation needs.
#[derive(Clone, Copy)]
pub struct Imaging<'a> {
    pub gpu: GpuRef<'a>,
    pub shaders: &'a ShaderPrograms,
}

/// One target that an operation of several passes draws into and then
/// reads from.
#[derive(Clone, Copy)]
pub struct ScratchTarget {
    pub texture: TextureHandle,
    pub framebuffer: FramebufferHandle,
}

impl ScratchTarget {
    pub fn target(self) -> Target {
        Target::Framebuffer(self.framebuffer)
    }
}

/// Two targets at least as large as the source, lent by the caller to an
/// operation that needs more than one pass. The operation says which one
/// holds its result ([`Staged`]); the other is the caller's to overwrite.
#[derive(Clone, Copy)]
pub struct Scratch {
    pub a: ScratchTarget,
    pub b: ScratchTarget,
}

/// Which scratch target a staged operation left its result in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Staged {
    A,
    B,
}
