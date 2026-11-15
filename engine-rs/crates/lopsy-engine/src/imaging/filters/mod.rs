//! Filters over a source texture, grouped the way the Filter menu is.
//! Each clamps its own parameters; the caller decides when a filter is a
//! no-op.
//!
//! A filter of one pass returns the pass, and the caller says where it
//! draws. A filter of several passes takes the source's size and a
//! [`Scratch`](crate::imaging::Scratch) to draw through, and returns which
//! scratch target holds the result. A filter that samples a second texture
//! (a pattern, a LUT, a warp grid) is handed it; without one the sampler
//! reads nothing.

pub mod adjust;
pub mod blur;
pub mod distort;
pub mod noise;
pub mod render;
pub mod stylize;
