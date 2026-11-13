//! The Lopsy rendering engine, without a host.
//!
//! Nothing here exports to JavaScript. `lopsy-wasm` is the browser host: it
//! owns the wasm-bindgen exports and calls into this crate. See
//! docs/engine-migration-plan.md, Phase 3.

pub mod gpu;
pub mod host;
