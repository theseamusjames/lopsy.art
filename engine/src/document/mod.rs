//! What makes an image a document: layers and their masks and effects,
//! the compositor that draws them, selections, and the tools that paint
//! and set type on them.
//!
//! Everything here works on the engine's layer stack. What needs no
//! layers is elsewhere: `gpu` draws, and `imaging` holds the filters and
//! adjustments these apply to a layer or to the composite.

pub mod paint;
pub mod text;

pub mod compositor;
pub mod effect_cache_gpu;
pub mod layer_manager;
pub mod layer_transform_gpu;
pub mod content_bounds_gpu;
pub mod thumbnail_gpu;
pub mod filter_gpu;
pub mod selection_gpu;
pub mod quick_mask_gpu;
pub mod mask_paint_gpu;
pub mod overlay_renderer;
