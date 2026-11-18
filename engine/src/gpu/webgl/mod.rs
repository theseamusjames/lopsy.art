//! The WebGL2 backend, written against `web-sys`. Everything that names a
//! WebGL type or call lives in this directory.

pub mod context;
pub mod framebuffer;
pub mod pass;
pub(in crate::gpu) mod program;
pub mod read;
pub mod texture_pool;

/// An image the host owns that a texture can be filled from: a canvas.
pub type ExternalImage = web_sys::HtmlCanvasElement;
