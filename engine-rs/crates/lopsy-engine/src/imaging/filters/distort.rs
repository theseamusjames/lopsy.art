use super::render::with_second_texture;
use crate::gpu::params::filters::MeshWarpParams;
use crate::gpu::pass::Pass;
use crate::gpu::texture_pool::TextureHandle;
use crate::imaging::Imaging;

/// Warp the source through `grid`, a texture of `grid_size` points each
/// holding a 16-bit offset in two bytes per axis, over the part of the
/// source between `bounds_min` and `bounds_max` in UV.
///
/// The shader reads grid points with `textureLoad` and interpolates the
/// decoded offsets itself: hardware filtering would blend the high and low
/// bytes separately at the texture's own precision (#1160).
pub fn mesh_warp<'a>(
    im: Imaging<'a>,
    src: TextureHandle,
    grid: Option<TextureHandle>,
    grid_size: (u32, u32),
    bounds_min: [f32; 2],
    bounds_max: [f32; 2],
) -> Pass<'a, MeshWarpParams> {
    let pass = im.gpu
        .pass(&im.shaders.mesh_warp, MeshWarpParams {
            grid_size: [grid_size.0 as f32, grid_size.1 as f32],
            bounds_min,
            bounds_max,
        })
        .texture("u_tex", src);
    with_second_texture(pass, "u_grid", grid)
}
