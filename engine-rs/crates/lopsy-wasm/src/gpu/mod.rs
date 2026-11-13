pub mod context;
pub mod shader;
pub mod texture_pool;
pub mod framebuffer;
pub mod params;
pub mod pass;
pub mod uniforms;

/// An image the host owns that a texture can be filled from. On the web
/// this is a canvas; each backend names its own.
pub type ExternalImage = web_sys::HtmlCanvasElement;
