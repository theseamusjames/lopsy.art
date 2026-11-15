//! Blur filters: gaussian, box, unsharp mask, motion, radial.


use crate::engine::EngineInner;
use crate::{filter_gpu, imaging};

pub fn filter_gaussian_blur(engine: &mut EngineInner, layer_id: &str, radius: u32) {
    if radius == 0 { return; }

    if radius <= imaging::filters::blur::MAX_TAP_RADIUS {
        filter_gpu::apply_staged(engine, layer_id, |im, src, size, scratch| {
            imaging::filters::blur::gaussian_blur(im, src, size, scratch, radius)
        });
    } else {
        // Three strided box blurs approximate the Gaussian. Each is written
        // back to the layer, through the selection when there is one,
        // before the next reads it.
        let (sample_radius, step) = imaging::filters::blur::box_blur_for_gaussian(radius);
        for _ in 0..3 {
            filter_gpu::apply_staged(engine, layer_id, |im, src, size, scratch| {
                imaging::filters::blur::box_blur(im, src, size, scratch, sample_radius, step)
            });
        }
    }
}

pub fn filter_box_blur(engine: &mut EngineInner, layer_id: &str, radius: u32) {
    if radius == 0 { return; }
    filter_gpu::apply_staged(engine, layer_id, |im, src, size, scratch| {
        imaging::filters::blur::box_blur(im, src, size, scratch, radius, 1)
    });
}

pub fn filter_unsharp_mask(
    engine: &mut EngineInner, layer_id: &str,
    radius: u32, amount: f32, threshold: u32,
) {
    if radius == 0 { return; }
    filter_gpu::apply_staged(engine, layer_id, |im, src, size, scratch| {
        imaging::filters::blur::unsharp_mask(im, src, size, scratch, radius, amount, threshold)
    });
}

pub fn filter_motion_blur(engine: &mut EngineInner, layer_id: &str, angle: f32, distance: u32) {
    if distance == 0 { return; }
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::blur::motion_blur(im, src, angle, distance));
}

pub fn filter_tilt_shift_blur(
    engine: &mut EngineInner,
    layer_id: &str,
    focus_position: f32,
    focus_width: f32,
    blur_radius: f32,
    angle: f32,
) {
    if blur_radius <= 0.0 { return; }
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::blur::tilt_shift_blur(im, src, focus_position, focus_width, blur_radius, angle));
}


pub fn filter_surface_blur(engine: &mut EngineInner, layer_id: &str, radius: u32, threshold: f32) {
    if radius == 0 { return; }
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::blur::surface_blur(im, src, radius, threshold));
}

pub fn filter_radial_blur(engine: &mut EngineInner, layer_id: &str, amount: u32) {
    if amount == 0 { return; }
    let Some((_, _, cu, cv)) = super::full_size_doc_center(&mut *engine, layer_id) else {
        return;
    };
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::blur::radial_blur(im, src, [cu, cv], amount));
}
