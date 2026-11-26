//! WASM API surface — one submodule per domain.
//!
//! Every `#[wasm_bindgen]` function that JS calls lives here, grouped by
//! what it does (filter, brush, layer, adjustment, …). lib.rs is reserved
//! for the `Engine` wrapper struct and module declarations.

pub mod adjustment;
pub mod arw;
pub mod color_mode;
pub mod develop;
pub mod dng;
pub mod drawing;
pub mod fill;
pub mod filter;
pub mod hdr_export;
pub mod layer;
pub mod magnetic_lasso;
pub mod overlay;
pub mod paint;
pub mod psd;
pub mod raf;
pub mod raw;
pub mod selection;
pub mod text;
