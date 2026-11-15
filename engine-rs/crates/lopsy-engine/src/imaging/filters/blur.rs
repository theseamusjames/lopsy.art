use crate::gpu::params::filters::{
    BoxBlurParams, GaussianBlurParams, MotionBlurParams, RadialBlurParams, SharpenParams, SurfaceBlurParams,
    TiltShiftBlurParams,
};
use crate::gpu::pass::Pass;
use crate::gpu::shader::ShaderProgram;
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::uniforms::{Uniforms, Vec4Array};
use crate::imaging::{Imaging, Scratch, Staged};

/// The largest radius the Gaussian and box blur shaders sample in one pass.
pub const MAX_TAP_RADIUS: u32 = 63;

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

/// A blur along x into scratch A, then along y into scratch B. `params`
/// gives the shader's uniforms for the direction it is handed.
fn separable<P: Uniforms>(
    im: Imaging<'_>,
    src: TextureHandle,
    (w, h): (u32, u32),
    scratch: Scratch,
    shader: &ShaderProgram<P>,
    params: impl Fn([f32; 2]) -> P,
) -> Staged {
    im.gpu.pass(shader, params([1.0, 0.0]))
        .texture("u_tex", src)
        .viewport(0, 0, w as i32, h as i32)
        .draw(scratch.a.target());
    im.gpu.pass(shader, params([0.0, 1.0]))
        .texture("u_tex", scratch.a.texture)
        .viewport(0, 0, w as i32, h as i32)
        .draw(scratch.b.target());
    Staged::B
}

/// Gaussian blur with the exact kernel, for a radius of at most
/// [`MAX_TAP_RADIUS`]. A larger one is three [`box_blur`]s with the
/// spacing [`box_blur_for_gaussian`] gives.
pub fn gaussian_blur(im: Imaging<'_>, src: TextureHandle, size: (u32, u32), scratch: Scratch, radius: u32) -> Staged {
    let kernel = lopsy_core::filters::blur::gaussian_kernel(radius);
    let center = radius as usize;
    let count = (radius as usize) + 1;
    let mut weights: Vec<f32> = kernel[center..center + count].to_vec();
    let raw_sum = weights[0] + 2.0 * weights[1..].iter().sum::<f32>();
    if raw_sum > 0.0 {
        for w in &mut weights { *w /= raw_sum; }
    }
    let weights = Vec4Array::from_floats(&weights);
    separable(im, src, size, scratch, &im.shaders.gaussian_blur, |direction| GaussianBlurParams {
        direction,
        weights,
        radius: radius as i32,
    })
}

/// Box blur of `radius` taps each side, `step` texels apart.
pub fn box_blur(im: Imaging<'_>, src: TextureHandle, size: (u32, u32), scratch: Scratch, radius: u32, step: u32) -> Staged {
    separable(im, src, size, scratch, &im.shaders.box_blur, |direction| BoxBlurParams {
        direction,
        radius: radius as i32,
        step: step as i32,
    })
}

/// The `(radius, step)` of the strided box blur that, run three times,
/// approximates a Gaussian of `radius` larger than [`MAX_TAP_RADIUS`]. The
/// stride lets each pass cover the full radius with 63 samples a side.
pub fn box_blur_for_gaussian(radius: u32) -> (u32, u32) {
    let step = ((radius + MAX_TAP_RADIUS - 1) / MAX_TAP_RADIUS).max(1);
    ((radius / step).min(MAX_TAP_RADIUS), step)
}

/// Unsharp mask: blur a copy, then push the source away from it.
pub fn unsharp_mask(
    im: Imaging<'_>,
    src: TextureHandle,
    (w, h): (u32, u32),
    scratch: Scratch,
    radius: u32,
    amount: f32,
    threshold: u32,
) -> Staged {
    let kernel = lopsy_core::filters::blur::gaussian_kernel(radius);
    let weights = Vec4Array::from_floats(&kernel);
    let blur_pass = |from: TextureHandle, direction: [f32; 2]| {
        im.gpu
            .pass(&im.shaders.gaussian_blur, GaussianBlurParams { direction, weights, radius: radius as i32 })
            .texture("u_tex", from)
            .viewport(0, 0, w as i32, h as i32)
    };
    blur_pass(src, [1.0, 0.0]).draw(scratch.a.target());
    blur_pass(scratch.a.texture, [0.0, 1.0]).draw(scratch.b.target());

    // The source and its blur (scratch B) into scratch A.
    im.gpu.pass(&im.shaders.sharpen, SharpenParams { amount, threshold: threshold as f32 })
        .texture("u_tex", src)
        .texture("u_blurredTex", scratch.b.texture)
        .viewport(0, 0, w as i32, h as i32)
        .draw(scratch.a.target());
    Staged::A
}

#[cfg(test)]
mod tests {
    use super::box_blur_for_gaussian;

    #[test]
    fn a_large_gaussian_is_covered_by_63_strided_taps() {
        assert_eq!(box_blur_for_gaussian(64), (32, 2));
        assert_eq!(box_blur_for_gaussian(126), (63, 2));
        assert_eq!(box_blur_for_gaussian(127), (42, 3));
        assert_eq!(box_blur_for_gaussian(200), (50, 4));
    }
}
