//! Image operations that know nothing about documents or layers.
//!
//! Each takes what it draws with ([`Imaging`]), a source texture and its
//! parameters, and returns the pass that applies it. The caller says where
//! the pass draws. The compositor and the filter commands are two callers;
//! a raw developer with no layer stack would be a third.

pub mod adjustments;
pub mod filters;

use crate::gpu::pass::GpuRef;
use crate::gpu::shader::ShaderPrograms;

/// The GPU and the shader set: all an imaging operation needs.
#[derive(Clone, Copy)]
pub struct Imaging<'a> {
    pub gpu: GpuRef<'a>,
    pub shaders: &'a ShaderPrograms,
}
