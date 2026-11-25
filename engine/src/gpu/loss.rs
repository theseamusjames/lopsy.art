//! Which engine a lost GPU device belongs to, and whether to say so.
//!
//! A page can hold several engines: Photonamous keeps one for its Edit
//! view and creates and frees another for exports, and Lopsy rebuilds its
//! engine at times. The host's announcement of a lost device is the same
//! for all of them, so it carries the engine's id. An engine that is being
//! freed has nothing to recover: its device going away is the point, and
//! announcing it would make every other engine in the page rebuild itself.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

/// Ids start at 1, so a listener can treat 0 as "no engine named".
static NEXT_ENGINE_ID: AtomicU32 = AtomicU32::new(1);

/// One engine's id, and whether it has been freed. The backend's
/// device-lost callback holds it beside the context, so the flag outlives
/// the context: a browser may settle `device.lost` after the engine that
/// owned the device is gone.
#[derive(Debug)]
pub struct LossWatch {
    engine_id: u32,
    freed: AtomicBool,
}

impl LossWatch {
    /// A watch with the next unused id.
    pub fn new() -> Self {
        Self { engine_id: NEXT_ENGINE_ID.fetch_add(1, Ordering::Relaxed), freed: AtomicBool::new(false) }
    }

    pub fn engine_id(&self) -> u32 {
        self.engine_id
    }

    /// The engine is being freed: from now on its device's loss is not
    /// announced.
    pub fn mark_freed(&self) {
        self.freed.store(true, Ordering::Release);
    }

    /// The engine id to announce a lost device for, or `None` when the
    /// engine was freed and the loss is its own doing.
    pub fn to_announce(&self) -> Option<u32> {
        if self.freed.load(Ordering::Acquire) { None } else { Some(self.engine_id) }
    }
}

impl Default for LossWatch {
    fn default() -> Self {
        Self::new()
    }
}

/// WebGPU's name for why a device was lost (`GPUDeviceLostReason`):
/// `"destroyed"` when `destroy()` was called on it, which is also what
/// rehearsing a loss does, and `"unknown"` for anything else.
pub fn reason_name(was_destroyed: bool) -> &'static str {
    if was_destroyed { "destroyed" } else { "unknown" }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_live_engine_announces_its_own_id() {
        let watch = LossWatch::new();
        assert_eq!(watch.to_announce(), Some(watch.engine_id()));
    }

    #[test]
    fn a_freed_engine_stays_silent() {
        let watch = LossWatch::new();
        watch.mark_freed();
        assert_eq!(watch.to_announce(), None);
        assert_eq!(watch.to_announce(), None);
    }

    #[test]
    fn freeing_one_engine_leaves_another_announcing() {
        let edit = LossWatch::new();
        let export = LossWatch::new();
        export.mark_freed();
        assert_eq!(edit.to_announce(), Some(edit.engine_id()));
        assert_eq!(export.to_announce(), None);
    }

    #[test]
    fn every_engine_has_its_own_nonzero_id() {
        let ids: Vec<u32> = (0..4).map(|_| LossWatch::new().engine_id()).collect();
        assert!(ids.iter().all(|&id| id != 0));
        assert!(ids.windows(2).all(|pair| pair[0] != pair[1]));
    }

    #[test]
    fn reasons_use_webgpu_names() {
        assert_eq!(reason_name(true), "destroyed");
        assert_eq!(reason_name(false), "unknown");
    }
}
