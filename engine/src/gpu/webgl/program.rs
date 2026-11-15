//! WebGL programs: compiling and linking the generated GLSL, and sending a
//! uniform struct to a linked program member by member.

use std::cell::RefCell;
use std::collections::HashMap;
use web_sys::{WebGl2RenderingContext, WebGlProgram, WebGlShader, WebGlUniformLocation};

use crate::gpu::uniforms::{flatten_params_block, glsl_name, Field, UniformSink, UniformType};

const FULLSCREEN_QUAD_VERT: &str = r#"#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    v_uv = vec2(x * 0.5 + 0.5, y * 0.5 + 0.5);
    gl_Position = vec4(x, y, 0.0, 1.0);
}
"#;

/// The part of a [`ShaderProgram`] that does not depend on its uniform
/// struct. Everything that works on a program takes this, so that code is
/// compiled once and not once per shader.
pub(in crate::gpu) struct LinkedProgram {
    pub(in crate::gpu) program: WebGlProgram,
    uniforms: RefCell<HashMap<String, Option<WebGlUniformLocation>>>,
    params: RefCell<Option<ParamState>>,
}

/// Where a typed program's `Params` members live, and the values they hold.
struct ParamState {
    /// One per field of the uniform struct; `None` where the compiler
    /// dropped a member the shader variant does not read.
    locations: Vec<Option<WebGlUniformLocation>>,
    /// The bits last uploaded, field after field.
    values: Vec<u32>,
    is_uploaded: bool,
}

/// What a uniform struct's values are handed to.
pub(in crate::gpu) type ParamSink<'a> = ParamUpload<'a>;

/// Sets the members whose value differs from what the program holds.
pub(in crate::gpu) struct ParamUpload<'a> {
    gl: &'a WebGl2RenderingContext,
    state: &'a mut ParamState,
    field: usize,
    offset: usize,
}

impl ParamUpload<'_> {
    /// Records `bits` as the next field's value. Returns the field's
    /// location if the value has to be sent.
    fn store(&mut self, bits: impl ExactSizeIterator<Item = u32> + Clone) -> Option<&WebGlUniformLocation> {
        let held = &mut self.state.values[self.offset..self.offset + bits.len()];
        let field = self.field;
        self.field += 1;
        self.offset += bits.len();
        if self.state.is_uploaded && held.iter().copied().eq(bits.clone()) {
            return None;
        }
        for (slot, value) in held.iter_mut().zip(bits) {
            *slot = value;
        }
        self.state.locations[field].as_ref()
    }
}

impl UniformSink for ParamUpload<'_> {
    fn floats(&mut self, ty: UniformType, values: &[f32]) {
        let gl = self.gl;
        let Some(location) = self.store(values.iter().map(|v| v.to_bits())) else { return };
        let location = Some(location);
        match ty {
            UniformType::Float => gl.uniform1f(location, values[0]),
            UniformType::Vec2 => gl.uniform2f(location, values[0], values[1]),
            UniformType::Vec3 => gl.uniform3f(location, values[0], values[1], values[2]),
            UniformType::Vec4 => gl.uniform4f(location, values[0], values[1], values[2], values[3]),
            UniformType::Mat2 => gl.uniform_matrix2fv_with_f32_array(location, false, values),
            UniformType::Mat3 => gl.uniform_matrix3fv_with_f32_array(location, false, values),
            UniformType::Vec4Array(_) => gl.uniform4fv_with_f32_array(location, values),
            UniformType::Int | UniformType::Uint | UniformType::IVec2 => {}
        }
    }

    fn ints(&mut self, ty: UniformType, values: &[i32]) {
        let gl = self.gl;
        let Some(location) = self.store(values.iter().map(|v| *v as u32)) else { return };
        let location = Some(location);
        match ty {
            UniformType::Int => gl.uniform1i(location, values[0]),
            UniformType::Uint => gl.uniform1ui(location, values[0] as u32),
            UniformType::IVec2 => gl.uniform2i(location, values[0], values[1]),
            _ => {}
        }
    }
}

impl LinkedProgram {
    fn new(program: WebGlProgram) -> Self {
        Self { program, uniforms: RefCell::new(HashMap::new()), params: RefCell::new(None) }
    }

    /// Calls `set` with the location of uniform `name`, if the program has
    /// one. Locations are cached, and handed out by reference: cloning one
    /// is a round trip into JS and back, which at a dozen uniforms a pass
    /// was a large part of what a pass cost on the CPU.
    pub(in crate::gpu) fn with_location(&self, gl: &WebGl2RenderingContext, name: &str, set: impl FnOnce(&WebGlUniformLocation)) {
        if !self.uniforms.borrow().contains_key(name) {
            let location = gl.get_uniform_location(&self.program, name);
            self.uniforms.borrow_mut().insert(name.to_string(), location);
        }
        if let Some(Some(location)) = self.uniforms.borrow().get(name) {
            set(location);
        }
    }

    /// The location of uniform `name`, cloned for a caller that keeps it.
    pub(in crate::gpu) fn location(&self, gl: &WebGl2RenderingContext, name: &str) -> Option<WebGlUniformLocation> {
        let mut location = None;
        self.with_location(gl, name, |found| location = Some(found.clone()));
        location
    }

    /// Makes the program's `Params` members hold the struct that `put`
    /// hands over, whose fields are `fields`. The program must be current.
    /// A member is only sent when its value changed: uniforms belong to the
    /// program and keep their value between passes, and they are written
    /// nowhere else.
    pub(in crate::gpu) fn upload(&self, gl: &WebGl2RenderingContext, fields: &'static [Field], put: &dyn Fn(&mut ParamUpload)) {
        if fields.is_empty() {
            return;
        }
        let mut state = self.params.borrow_mut();
        let state = state.get_or_insert_with(|| ParamState {
            locations: fields
                .iter()
                .map(|field| gl.get_uniform_location(&self.program, &glsl_name(field.name)))
                .collect(),
            values: vec![0; fields.iter().map(|field| field.ty.components()).sum()],
            is_uploaded: false,
        });
        put(&mut ParamUpload { gl, state, field: 0, offset: 0 });
        state.is_uploaded = true;
    }
}
/// Links fragment shaders against the full-screen vertex shader.
#[derive(Clone)]
pub(in crate::gpu) struct Linker {
    gl: WebGl2RenderingContext,
}

impl Linker {
    pub(in crate::gpu) fn new(gl: &WebGl2RenderingContext) -> Self {
        Self { gl: gl.clone() }
    }

    pub(in crate::gpu) fn link(&self, frag_src: &str) -> Result<LinkedProgram, String> {
        link(&self.gl, FULLSCREEN_QUAD_VERT, frag_src)
    }
}

fn compile_shader(
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

fn link_program(
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

fn link(
    gl: &WebGl2RenderingContext,
    vert_src: &str,
    frag_src: &str,
) -> Result<LinkedProgram, String> {
    let frag_src = flatten_params_block(frag_src);
    let vert = compile_shader(gl, vert_src, WebGl2RenderingContext::VERTEX_SHADER)?;
    let frag = compile_shader(gl, &frag_src, WebGl2RenderingContext::FRAGMENT_SHADER)?;
    let program = link_program(gl, &vert, &frag)?;
    gl.delete_shader(Some(&vert));
    gl.delete_shader(Some(&frag));
    Ok(LinkedProgram::new(program))
}
