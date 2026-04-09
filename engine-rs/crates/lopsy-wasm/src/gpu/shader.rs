use web_sys::{WebGl2RenderingContext, WebGlProgram, WebGlShader};

pub const FULLSCREEN_QUAD_VERT: &str = r#"#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    v_uv = vec2(x * 0.5 + 0.5, y * 0.5 + 0.5);
    gl_Position = vec4(x, y, 0.0, 1.0);
}
"#;

// Core shaders
pub const BLIT_FRAG: &str = include_str!("shaders/blit.glsl");
pub const BLEND_FRAG: &str = include_str!("shaders/blend.glsl");
pub const COMPOSITE_FRAG: &str = include_str!("shaders/composite.glsl");
pub const FINAL_BLIT_FRAG: &str = include_str!("shaders/final_blit.glsl");
pub const FLIP_FRAG: &str = include_str!("shaders/flip.glsl");
pub const CLIPBOARD_COPY_FRAG: &str = include_str!("shaders/clipboard_copy.glsl");
pub const CLIPBOARD_CLEAR_FRAG: &str = include_str!("shaders/clipboard_clear.glsl");
pub const SELECTION_FILL_FRAG: &str = include_str!("shaders/selection_fill.glsl");
pub const ROTATE90_FRAG: &str = include_str!("shaders/rotate90.glsl");
pub const BLIT_REGION_FRAG: &str = include_str!("shaders/blit_region.glsl");
pub const TRANSFORM_AFFINE_FRAG: &str = include_str!("shaders/transform_affine.glsl");
pub const TRANSFORM_PERSPECTIVE_FRAG: &str = include_str!("shaders/transform_perspective.glsl");

// Effects
pub const GLOW_FRAG: &str = include_str!("shaders/effects/glow.glsl");
pub const SHADOW_FRAG: &str = include_str!("shaders/effects/shadow.glsl");
pub const STROKE_EDT_FRAG: &str = include_str!("shaders/effects/stroke_edt.glsl");
pub const COLOR_OVERLAY_FRAG: &str = include_str!("shaders/effects/color_overlay.glsl");

// Filters
pub const GAUSSIAN_BLUR_FRAG: &str = include_str!("shaders/filters/gaussian_blur.glsl");
pub const BOX_BLUR_FRAG: &str = include_str!("shaders/filters/box_blur.glsl");
pub const ADJUSTMENTS_FRAG: &str = include_str!("shaders/filters/adjustments.glsl");
pub const HUE_SAT_FRAG: &str = include_str!("shaders/filters/hue_sat.glsl");
pub const INVERT_FRAG: &str = include_str!("shaders/filters/invert.glsl");
pub const POSTERIZE_FRAG: &str = include_str!("shaders/filters/posterize.glsl");
pub const THRESHOLD_FRAG: &str = include_str!("shaders/filters/threshold.glsl");
pub const NOISE_FRAG: &str = include_str!("shaders/filters/noise.glsl");
pub const SHARPEN_FRAG: &str = include_str!("shaders/filters/sharpen.glsl");
pub const VIGNETTE_FRAG: &str = include_str!("shaders/filters/vignette.glsl");
pub const MOTION_BLUR_FRAG: &str = include_str!("shaders/filters/motion_blur.glsl");
pub const RADIAL_BLUR_FRAG: &str = include_str!("shaders/filters/radial_blur.glsl");
pub const FIND_EDGES_FRAG: &str = include_str!("shaders/filters/find_edges.glsl");
pub const CEL_SHADING_FRAG: &str = include_str!("shaders/filters/cel_shading.glsl");
pub const CLOUDS_FRAG: &str = include_str!("shaders/filters/clouds.glsl");
pub const SMOKE_FRAG: &str = include_str!("shaders/filters/smoke.glsl");
pub const PIXELATE_FRAG: &str = include_str!("shaders/filters/pixelate.glsl");
pub const SELECTION_MASK_BLEND_FRAG: &str = include_str!("shaders/filters/selection_mask_blend.glsl");

// Brush
pub const BRUSH_DAB_FRAG: &str = include_str!("shaders/brush/brush_dab.glsl");
pub const ERASER_DAB_FRAG: &str = include_str!("shaders/brush/eraser_dab.glsl");
pub const DODGE_BURN_FRAG: &str = include_str!("shaders/brush/dodge_burn.glsl");
pub const CLONE_STAMP_FRAG: &str = include_str!("shaders/brush/clone_stamp.glsl");
pub const OPACITY_CLAMP_FRAG: &str = include_str!("shaders/brush/opacity_clamp.glsl");

// Gradient
pub const GRADIENT_LINEAR_FRAG: &str = include_str!("shaders/gradient/gradient_linear.glsl");
pub const GRADIENT_RADIAL_FRAG: &str = include_str!("shaders/gradient/gradient_radial.glsl");

// Shape
pub const SHAPE_FILL_FRAG: &str = include_str!("shaders/shape/shape_fill.glsl");
pub const FLOOD_FILL_APPLY_FRAG: &str = include_str!("shaders/shape/flood_fill_apply.glsl");

// Selection
pub const MARCHING_ANTS_FRAG: &str = include_str!("shaders/selection/marching_ants.glsl");

// Color
pub const COLOR_CONVERT_FRAG: &str = include_str!("shaders/color/color_convert.glsl");
pub const TONEMAP_FRAG: &str = include_str!("shaders/color/tonemap.glsl");

pub struct ShaderProgram {
    pub program: WebGlProgram,
}

pub fn compile_shader(
    gl: &WebGl2RenderingContext,
    source: &str,
    shader_type: u32,
) -> Result<WebGlShader, String> {
    let shader = gl.create_shader(shader_type).ok_or("Failed to create shader")?;
    gl.shader_source(&shader, source);
    gl.compile_shader(&shader);

    if gl.get_shader_parameter(&shader, WebGl2RenderingContext::COMPILE_STATUS)
        .as_bool()
        .unwrap_or(false)
    {
        Ok(shader)
    } else {
        let log = gl.get_shader_info_log(&shader).unwrap_or_default();
        gl.delete_shader(Some(&shader));
        Err(format!("Shader compile error: {log}"))
    }
}

pub fn link_program(
    gl: &WebGl2RenderingContext,
    vert: &WebGlShader,
    frag: &WebGlShader,
) -> Result<WebGlProgram, String> {
    let program = gl.create_program().ok_or("Failed to create program")?;
    gl.attach_shader(&program, vert);
    gl.attach_shader(&program, frag);
    gl.link_program(&program);

    if gl.get_program_parameter(&program, WebGl2RenderingContext::LINK_STATUS)
        .as_bool()
        .unwrap_or(false)
    {
        Ok(program)
    } else {
        let log = gl.get_program_info_log(&program).unwrap_or_default();
        gl.delete_program(Some(&program));
        Err(format!("Program link error: {log}"))
    }
}

pub fn compile_program(
    gl: &WebGl2RenderingContext,
    vert_src: &str,
    frag_src: &str,
) -> Result<ShaderProgram, String> {
    let vert = compile_shader(gl, vert_src, WebGl2RenderingContext::VERTEX_SHADER)?;
    let frag = compile_shader(gl, frag_src, WebGl2RenderingContext::FRAGMENT_SHADER)?;
    let program = link_program(gl, &vert, &frag)?;
    gl.delete_shader(Some(&vert));
    gl.delete_shader(Some(&frag));
    Ok(ShaderProgram { program })
}

pub struct ShaderPrograms {
    // Core
    pub blit: ShaderProgram,
    pub blend: ShaderProgram,
    pub composite: ShaderProgram,
    pub final_blit: ShaderProgram,
    pub flip: ShaderProgram,
    pub clipboard_copy: ShaderProgram,
    pub clipboard_clear: ShaderProgram,
    pub selection_fill: ShaderProgram,
    pub rotate90: ShaderProgram,
    pub blit_region: ShaderProgram,
    pub transform_affine: ShaderProgram,
    pub transform_perspective: ShaderProgram,
    // Effects
    pub glow: ShaderProgram,
    pub shadow: ShaderProgram,
    pub stroke_edt: ShaderProgram,
    pub color_overlay: ShaderProgram,
    // Filters
    pub gaussian_blur: ShaderProgram,
    pub box_blur: ShaderProgram,
    pub adjustments: ShaderProgram,
    pub hue_sat: ShaderProgram,
    pub invert: ShaderProgram,
    pub posterize: ShaderProgram,
    pub threshold: ShaderProgram,
    pub noise: ShaderProgram,
    pub sharpen: ShaderProgram,
    pub vignette: ShaderProgram,
    pub motion_blur: ShaderProgram,
    pub radial_blur: ShaderProgram,
    pub find_edges: ShaderProgram,
    pub cel_shading: ShaderProgram,
    pub clouds: ShaderProgram,
    pub smoke: ShaderProgram,
    pub pixelate: ShaderProgram,
    pub selection_mask_blend: ShaderProgram,
    // Brush — these use fullscreen quad vert for now (dab positioning via uniforms)
    pub brush_dab: ShaderProgram,
    pub eraser_dab: ShaderProgram,
    pub dodge_burn: ShaderProgram,
    pub clone_stamp: ShaderProgram,
    pub opacity_clamp: ShaderProgram,
    // Gradient
    pub gradient_linear: ShaderProgram,
    pub gradient_radial: ShaderProgram,
    // Shape
    pub shape_fill: ShaderProgram,
    pub flood_fill_apply: ShaderProgram,
    // Selection
    pub marching_ants: ShaderProgram,
    // Color
    pub color_convert: ShaderProgram,
    pub tonemap: ShaderProgram,
}

impl ShaderPrograms {
    pub fn compile_all(gl: &WebGl2RenderingContext) -> Result<Self, String> {
        let v = FULLSCREEN_QUAD_VERT;

        Ok(Self {
            // Core
            blit: compile_program(gl, v, BLIT_FRAG)?,
            blend: compile_program(gl, v, BLEND_FRAG)?,
            composite: compile_program(gl, v, COMPOSITE_FRAG)?,
            final_blit: compile_program(gl, v, FINAL_BLIT_FRAG)?,
            flip: compile_program(gl, v, FLIP_FRAG)?,
            clipboard_copy: compile_program(gl, v, CLIPBOARD_COPY_FRAG)?,
            clipboard_clear: compile_program(gl, v, CLIPBOARD_CLEAR_FRAG)?,
            selection_fill: compile_program(gl, v, SELECTION_FILL_FRAG)?,
            rotate90: compile_program(gl, v, ROTATE90_FRAG)?,
            blit_region: compile_program(gl, v, BLIT_REGION_FRAG)?,
            transform_affine: compile_program(gl, v, TRANSFORM_AFFINE_FRAG)?,
            transform_perspective: compile_program(gl, v, TRANSFORM_PERSPECTIVE_FRAG)?,
            // Effects
            glow: compile_program(gl, v, GLOW_FRAG)?,
            shadow: compile_program(gl, v, SHADOW_FRAG)?,
            stroke_edt: compile_program(gl, v, STROKE_EDT_FRAG)?,
            color_overlay: compile_program(gl, v, COLOR_OVERLAY_FRAG)?,
            // Filters
            gaussian_blur: compile_program(gl, v, GAUSSIAN_BLUR_FRAG)?,
            box_blur: compile_program(gl, v, BOX_BLUR_FRAG)?,
            adjustments: compile_program(gl, v, ADJUSTMENTS_FRAG)?,
            hue_sat: compile_program(gl, v, HUE_SAT_FRAG)?,
            invert: compile_program(gl, v, INVERT_FRAG)?,
            posterize: compile_program(gl, v, POSTERIZE_FRAG)?,
            threshold: compile_program(gl, v, THRESHOLD_FRAG)?,
            noise: compile_program(gl, v, NOISE_FRAG)?,
            sharpen: compile_program(gl, v, SHARPEN_FRAG)?,
            vignette: compile_program(gl, v, VIGNETTE_FRAG)?,
            motion_blur: compile_program(gl, v, MOTION_BLUR_FRAG)?,
            radial_blur: compile_program(gl, v, RADIAL_BLUR_FRAG)?,
            find_edges: compile_program(gl, v, FIND_EDGES_FRAG)?,
            cel_shading: compile_program(gl, v, CEL_SHADING_FRAG)?,
            clouds: compile_program(gl, v, CLOUDS_FRAG)?,
            smoke: compile_program(gl, v, SMOKE_FRAG)?,
            pixelate: compile_program(gl, v, PIXELATE_FRAG)?,
            selection_mask_blend: compile_program(gl, v, SELECTION_MASK_BLEND_FRAG)?,
            // Brush — use standard fullscreen quad vert; dab positioning via fragment shader
            brush_dab: compile_program(gl, v, BRUSH_DAB_FRAG)?,
            eraser_dab: compile_program(gl, v, ERASER_DAB_FRAG)?,
            dodge_burn: compile_program(gl, v, DODGE_BURN_FRAG)?,
            clone_stamp: compile_program(gl, v, CLONE_STAMP_FRAG)?,
            opacity_clamp: compile_program(gl, v, OPACITY_CLAMP_FRAG)?,
            // Gradient
            gradient_linear: compile_program(gl, v, GRADIENT_LINEAR_FRAG)?,
            gradient_radial: compile_program(gl, v, GRADIENT_RADIAL_FRAG)?,
            // Shape
            shape_fill: compile_program(gl, v, SHAPE_FILL_FRAG)?,
            flood_fill_apply: compile_program(gl, v, FLOOD_FILL_APPLY_FRAG)?,
            // Selection
            marching_ants: compile_program(gl, v, MARCHING_ANTS_FRAG)?,
            // Color
            color_convert: compile_program(gl, v, COLOR_CONVERT_FRAG)?,
            tonemap: compile_program(gl, v, TONEMAP_FRAG)?,
        })
    }
}
