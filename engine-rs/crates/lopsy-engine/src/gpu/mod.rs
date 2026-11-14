//! The engine's GPU layer. Feature code draws through [`pass`] and
//! allocates through the pools; which graphics API that reaches is the
//! backend's business.

pub mod params;
pub mod pass;
pub mod shader;
pub mod uniforms;

#[path = "webgl/mod.rs"]
mod backend;

pub use backend::{context, framebuffer, texture_pool, ExternalImage};
