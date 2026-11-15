//! What the engine can be asked to do, by any host.
//!
//! Each function takes the engine and plain Rust values and reports failure
//! as a `String`. The wasm host's exports in `api/` convert their arguments
//! and call these; a native or FFI host calls the same functions.

pub mod adjustment;
pub mod color_mode;
pub mod drawing;
pub mod fill;
pub mod filter;
pub mod layer;
pub mod magnetic_lasso;
pub mod overlay;
pub mod paint;
pub mod psd;
pub mod selection;
pub mod text;
