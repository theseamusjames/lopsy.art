---
name: Transforms must be GPU-side
description: All pixel manipulation including transforms must happen in the Rust/WASM engine, never in JS
type: feedback
---

Transform operations (rotate, scale, skew, distort, perspective) must be implemented in the Rust/WASM GPU engine, not in JS with Canvas 2D. The initial implementation incorrectly did all transform compositing in JS (Canvas 2D transforms + per-pixel alpha composite loop + GPU upload), violating the core architecture rule.

**Why:** The architecture mandates "All pixel data lives in GPU textures managed by the Rust engine. JS never touches raw pixels in the render path." JS-side pixel manipulation causes GPU→JS→GPU roundtrips, anti-aliasing artifacts, mesh seam issues, and poor performance.

**How to apply:** When implementing any new pixel manipulation feature, always add it to the Rust engine (engine-rs/crates/lopsy-wasm/) with a wasm-bindgen API, and call it from JS via wasm-bridge.ts. Never use Canvas 2D or JS pixel loops for rendering.
