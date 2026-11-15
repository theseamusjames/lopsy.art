//! The wgpu backend: WebGPU in the browser, and later Metal, Vulkan and
//! DX12 through the same code. Compiled in place of `webgl/` when the
//! `wgpu` cargo feature is on, into a second wasm artifact.
//!
//! So far it creates a device, presents to the canvas, allocates textures
//! and clears them. No pass draws: each operation still to come reports
//! failure the way its WebGL counterpart does for a missing texture.
//! docs/engine-migration-plan.md (Phase 6) lists the order they are filled
//! in.

// What no pass reads yet (shader modules, attachments) is unread.
#![allow(dead_code)]

pub mod context;
pub mod framebuffer;
pub mod pass;
pub(in crate::gpu) mod program;
pub mod texture_pool;

/// An image the host owns that a texture can be filled from: a canvas.
pub type ExternalImage = web_sys::HtmlCanvasElement;

/// What an operation that needs a device reports.
pub(in crate::gpu) const UNAVAILABLE: &str = "The wgpu backend cannot draw yet";
