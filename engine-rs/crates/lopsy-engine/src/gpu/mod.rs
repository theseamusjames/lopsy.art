//! The engine's GPU layer. Feature code draws through [`pass`] and
//! allocates through the pools; which graphics API that reaches is the
//! backend's business.

pub mod params;
pub mod pass;
pub mod shader;
pub mod uniforms;

// One backend is compiled in, chosen by the `wgpu` cargo feature, so no
// type or signature in the engine carries a backend parameter.
#[cfg_attr(not(feature = "wgpu"), path = "webgl/mod.rs")]
#[cfg_attr(feature = "wgpu", path = "wgpu/mod.rs")]
mod backend;

pub use backend::{context, framebuffer, texture_pool, ExternalImage};
