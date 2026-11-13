//! Filters as passes over a source texture, grouped the way the Filter
//! menu is. Each clamps its own parameters; the caller decides when a
//! filter is a no-op and where its pass draws.

pub mod adjust;
pub mod blur;
pub mod noise;
pub mod stylize;
