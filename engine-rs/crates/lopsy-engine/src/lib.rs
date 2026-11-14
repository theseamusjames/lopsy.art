//! The Lopsy rendering engine, without a host.
//!
//! Nothing here exports to JavaScript. `lopsy-wasm` is the browser host: it
//! owns the wasm-bindgen exports and calls into this crate. See
//! docs/engine-migration-plan.md, Phase 3.

pub mod gpu;
pub mod host;
pub mod imaging;
pub mod engine;
pub mod compositor;
pub mod effect_cache_gpu;
pub mod layer_manager;
pub mod layer_transform_gpu;
pub mod content_bounds_gpu;
pub mod brush_gpu;
pub mod filter_gpu;
pub mod thumbnail_gpu;
pub mod gradient_gpu;
pub mod shape_gpu;
pub mod selection_gpu;
pub mod quick_mask_gpu;
pub mod mask_paint_gpu;
pub mod dab_pass_gpu;
pub mod coverage_stroke_gpu;
pub mod stamp_preview_gpu;
pub mod dodge_burn_gpu;
pub mod sponge_gpu;
pub mod smudge_gpu;
pub mod clone_stamp_gpu;
pub mod healing_brush_gpu;
pub mod overlay_renderer;
pub mod glyph_atlas;
pub mod text_gpu;
pub mod ligature_split;
pub mod vertical_forms;
pub mod text_transform_gpu;
pub mod woff2;
pub mod variable_instance;
pub mod commands;
