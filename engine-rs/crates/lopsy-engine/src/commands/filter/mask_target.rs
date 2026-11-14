//! Run Filter menu commands on a layer mask instead of the layer (#1150).


use crate::engine::EngineInner;
use crate::filter_gpu;

/// Until `endMaskFilterTarget`, filter calls for `layer_id` read and write
/// its mask. Returns false when the layer has no mask on the engine.
pub fn begin_mask_filter_target(engine: &mut EngineInner, layer_id: &str) -> bool {
    filter_gpu::begin_mask_filter_target(&mut *engine, layer_id)
}

/// Return the (filtered) mask to the layer and restore the layer's own
/// texture. `layer_id` is unused by the engine; it names the mask written
/// so the JS wrapper can mark it dirty for history.
pub fn end_mask_filter_target(engine: &mut EngineInner, _layer_id: &str) {
    filter_gpu::end_mask_filter_target(&mut *engine);
}
