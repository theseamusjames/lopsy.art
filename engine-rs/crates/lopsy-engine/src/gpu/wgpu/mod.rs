//! The wgpu backend: WebGPU in the browser, and later Metal, Vulkan and
//! DX12 through the same code. Compiled in place of `webgl/` when the
//! `wgpu` cargo feature is on, into a second wasm artifact.
//!
//! Textures, uploads, passes, copies and readbacks all work. What is left
//! is listed in docs/engine-migration-plan.md (Phase 6).

pub mod context;
pub mod framebuffer;
pub mod pass;
pub(in crate::gpu) mod program;
pub mod read;
pub mod texture_pool;

/// An image the host owns that a texture can be filled from: a canvas.
pub type ExternalImage = web_sys::HtmlCanvasElement;
