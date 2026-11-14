use crate::gpu::params::filters::{MotionBlurParams, RadialBlurParams, SurfaceBlurParams, TiltShiftBlurParams};
use crate::gpu::pass::Pass;
use crate::gpu::texture_pool::TextureHandle;
use crate::imaging::Imaging;

// Surface blur is a non-separable bilateral filter: the shader samples a
// (2r+1)^2 neighborhood per pixel, so cost grows with the square of the
// radius. A large radius would run a single draw call long enough to trip
// the GPU watchdog and drop the WebGL context, so the radius is capped here
// regardless of what the caller requests.
const SURFACE_BLUR_MAX_RADIUS: u32 = 50;

pub fn motion_blur<'a>(im: Imaging<'a>, src: TextureHandle, angle: f32, distance: u32) -> Pass<'a, MotionBlurParams> {
    im.gpu.pass(&im.shaders.motion_blur, MotionBlurParams { angle, distance: distance as i32 }).texture("u_tex", src)
}

pub fn tilt_shift_blur<'a>(im: Imaging<'a>, src: TextureHandle, focus_position: f32, focus_width: f32, blur_radius: f32, angle: f32) -> Pass<'a, TiltShiftBlurParams> {
    let focus_position = focus_position.clamp(0.0, 1.0);
    let focus_width = focus_width.clamp(0.0, 1.0);
    let blur_radius = blur_radius.clamp(1.0, 32.0);
    im.gpu.pass(&im.shaders.tilt_shift_blur, TiltShiftBlurParams { focus_position, focus_width, blur_radius, angle }).texture("u_tex", src)
}

pub fn surface_blur<'a>(im: Imaging<'a>, src: TextureHandle, radius: u32, threshold: f32) -> Pass<'a, SurfaceBlurParams> {
    let radius = radius.min(SURFACE_BLUR_MAX_RADIUS);
    let threshold = threshold.clamp(1.0, 255.0) / 255.0;
    im.gpu.pass(&im.shaders.surface_blur, SurfaceBlurParams { radius: radius as i32, threshold }).texture("u_tex", src)
}

/// Zoom blur of `amount` around `center`, a point in the source's UV space.
pub fn radial_blur<'a>(im: Imaging<'a>, src: TextureHandle, center: [f32; 2], amount: u32) -> Pass<'a, RadialBlurParams> {
    im.gpu.pass(&im.shaders.radial_blur, RadialBlurParams { center, amount: amount as i32 }).texture("u_tex", src)
}
