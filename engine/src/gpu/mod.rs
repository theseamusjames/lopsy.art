//! The engine's GPU layer. Feature code draws through [`pass`] and
//! allocates through the pools; which graphics API that reaches is the
//! backend's business.

pub mod params;
pub mod pass;
pub mod read;
pub mod shader;
pub mod uniforms;

// One backend is compiled in, chosen by the `wgpu` cargo feature, so no
// type or signature in the engine carries a backend parameter.
#[cfg_attr(not(feature = "wgpu"), path = "webgl/mod.rs")]
#[cfg_attr(feature = "wgpu", path = "wgpu/mod.rs")]
mod backend;

pub use backend::{context, framebuffer, texture_pool, ExternalImage};

/// What a task on the wgpu backend is waiting for, for the host that
/// resumes it (see `task`).
#[cfg(all(feature = "wgpu", target_arch = "wasm32"))]
pub use backend::read::take_waiting_on;

/// Whether a pool of `use_float` textures can hold unclamped linear data:
/// an error naming `what` for an 8-bit pool (WebGL without
/// `EXT_color_buffer_float`), which clips every value to 0..1 in 1/255
/// steps. The develop working space and the float reads check it, so a
/// file is never written from such values.
pub fn require_float_pool(use_float: bool, what: &str) -> Result<(), String> {
    if use_float {
        Ok(())
    } else {
        Err(format!("{what} needs float textures, which this GPU cannot render to"))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn an_8bit_pool_is_refused_by_name() {
        assert_eq!(super::require_float_pool(true, "x"), Ok(()));
        let e = super::require_float_pool(false, "The develop working space").unwrap_err();
        assert!(e.starts_with("The develop working space needs float textures"), "{e}");
    }
}
