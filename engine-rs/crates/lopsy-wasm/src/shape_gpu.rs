use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;

pub fn render_shape(
    engine: &mut EngineInner,
    layer_id: &str,
    shape_type: u32,
    cx: f64,
    cy: f64,
    width: f64,
    height: f64,
    fill_r: f32,
    fill_g: f32,
    fill_b: f32,
    fill_a: f32,
    stroke_r: f32,
    stroke_g: f32,
    stroke_b: f32,
    stroke_a: f32,
    stroke_width: f32,
    corner_radius: f32,
) {
    let corner_radius = corner_radius.min((width as f32).min(height as f32) / 2.0);
    let _ = engine.ensure_layer_full_size(layer_id);

    let gl = &engine.gl;
    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let layer_tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let prog = &engine.shaders.shape_fill.program;
    gl.use_program(Some(prog));

    // Render to layer texture via temp FBO
    let temp_fbo = gl.create_framebuffer();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, temp_fbo.as_ref());
    gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&layer_tex),
        0,
    );
    gl.viewport(0, 0, w as i32, h as i32);

    // Enable blending for shape compositing
    gl.enable(WebGl2RenderingContext::BLEND);
    gl.blend_func(
        WebGl2RenderingContext::ONE,
        WebGl2RenderingContext::ONE_MINUS_SRC_ALPHA,
    );

    if let Some(loc) = gl.get_uniform_location(prog, "u_shapeType") {
        gl.uniform1i(Some(&loc), shape_type as i32);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_center") {
        gl.uniform2f(Some(&loc), cx as f32, cy as f32);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_size") {
        gl.uniform2f(Some(&loc), width as f32, height as f32);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_fillColor") {
        gl.uniform4f(Some(&loc), fill_r, fill_g, fill_b, fill_a);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_strokeColor") {
        gl.uniform4f(Some(&loc), stroke_r, stroke_g, stroke_b, stroke_a);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_strokeWidth") {
        gl.uniform1f(Some(&loc), stroke_width);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_cornerRadius") {
        gl.uniform1f(Some(&loc), corner_radius);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_texSize") {
        gl.uniform2f(Some(&loc), w as f32, h as f32);
    }

    engine.draw_fullscreen_quad();

    gl.disable(WebGl2RenderingContext::BLEND);
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    gl.delete_framebuffer(temp_fbo.as_ref());
    engine.mark_layer_dirty(layer_id);
}
