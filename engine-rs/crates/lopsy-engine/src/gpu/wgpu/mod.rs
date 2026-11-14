//! The wgpu backend: WebGPU in the browser, and later Metal, Vulkan and
//! DX12 through the same code. Compiled in place of `webgl/` when the
//! `wgpu` cargo feature is on, into a second wasm artifact.
//!
//! So far this is the outline the engine compiles against: every type and
//! signature the WebGL backend offers, with a device behind none of them.
//! Creating a context fails, so nothing can reach the operations below it,
//! and each of those reports failure the way its WebGL counterpart does for
//! a missing texture. docs/engine-migration-plan.md (Phase 6) lists the
//! order they are filled in.

// Nothing constructs a context yet, so most of what it would own is unread.
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
