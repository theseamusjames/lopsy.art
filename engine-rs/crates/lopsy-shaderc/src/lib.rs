//! Build-time shader translation.
//!
//! The engine's shaders are written in WGSL, the language the wgpu backend
//! will compile directly. The WebGL backend needs GLSL ES 3.00, so
//! `lopsy-engine`'s build script runs every `.wgsl` file through this crate
//! and embeds the result. The generated GLSL follows the conventions the
//! hand-written shaders used, so the WebGL backend treats both alike:
//!
//! - the fragment input is `v_uv` and the output `fragColor`, to link with
//!   the shared fullscreen vertex shader (GLSL ES 3.00 links varyings by
//!   name);
//! - each sampler carries its WGSL texture's name, which is the name a pass
//!   binds it by;
//! - the uniform struct `Params` becomes one unnamed block,
//!   `layout(std140) uniform Params { ... };`, whose members are global
//!   names, as `gpu::uniforms` expects.
//!
//! naga is a dependency of this crate only, so it never reaches the wasm
//! bundle.

use std::fs;
use std::path::{Path, PathBuf};

use naga::back::glsl;
use naga::proc::BoundsCheckPolicies;
use naga::valid::{Capabilities, ValidationFlags, Validator};
use naga::{AddressSpace, ShaderStage};

/// The fragment entry point every shader declares.
pub const FRAGMENT_ENTRY: &str = "fs_main";
/// The uniform struct every shader with uniforms declares.
pub const PARAMS_STRUCT: &str = "Params";

const FRAGMENT_INPUT: &str = "v_uv";
const FRAGMENT_OUTPUT: &str = "fragColor";
const NAGA_INPUT: &str = "_vs2fs_location0";
const NAGA_OUTPUT: &str = "_fs2p_location0";

/// `NAME == value` pairs that select `//#if` branches.
pub type Defines<'a> = [(&'a str, i64)];

/// Every `.wgsl` shader under `root`, in a stable order. The `include`
/// directory is left out: its files are spliced into shaders and are not
/// shaders themselves.
pub fn shader_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut found = Vec::new();
    collect_shader_files(root, &mut found)?;
    Ok(found)
}

fn collect_shader_files(dir: &Path, found: &mut Vec<PathBuf>) -> Result<(), String> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|e| format!("{}: {e}", dir.display()))?
        .flatten()
        .map(|entry| entry.path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            if path.file_name().is_some_and(|name| name != "include") {
                collect_shader_files(&path, found)?;
            }
        } else if path.extension().is_some_and(|ext| ext == "wgsl") {
            found.push(path);
        }
    }
    Ok(())
}

/// One shader file, translated.
pub struct Translated {
    /// The WGSL after preprocessing: what naga parsed, and what a WebGPU
    /// backend will compile.
    pub wgsl: String,
    /// The GLSL ES 3.00 the WebGL backend compiles.
    pub glsl: String,
}

/// Preprocess and translate the shader at `path`, taking its includes from
/// `<root>/include/<name>.wgsl`.
pub fn translate_file(root: &Path, path: &Path) -> Result<Translated, String> {
    let include_dir = root.join("include");
    let include = |name: &str| fs::read_to_string(include_dir.join(format!("{name}.wgsl"))).ok();
    let source = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let wgsl = preprocess(&source, &include, &[]).map_err(|e| format!("{}: {e}", path.display()))?;
    let glsl = wgsl_to_glsl(&wgsl).map_err(|e| format!("{}:\n{e}", path.display()))?;
    Ok(Translated { wgsl, glsl })
}

/// The string preprocessing that runs before naga.
///
/// `//#include name` splices the text `include(name)` returns. `//#if NAME
/// == n`, `//#elif NAME == n`, `//#else` and `//#endif` keep one branch: a
/// WGSL `const` does not prune a dead branch, so variants of one file are
/// selected as text.
pub fn preprocess(
    src: &str,
    include: &dyn Fn(&str) -> Option<String>,
    defines: &Defines,
) -> Result<String, String> {
    let mut out = String::new();
    // (some branch already taken, this branch active)
    let mut stack: Vec<(bool, bool)> = Vec::new();
    let test = |expr: &str| -> Result<bool, String> {
        let parts: Vec<&str> = expr.split_whitespace().collect();
        let [name, "==", value] = parts[..] else {
            return Err(format!("unsupported condition `{expr}`"));
        };
        let wanted: i64 = value.parse().map_err(|_| format!("bad value in `{expr}`"))?;
        Ok(defines.iter().any(|(k, v)| *k == name && *v == wanted))
    };
    for line in src.lines() {
        let directive = line.trim();
        let is_active = stack.iter().all(|&(_, on)| on);
        if let Some(expr) = directive.strip_prefix("//#if ") {
            let on = test(expr)?;
            stack.push((on, on));
        } else if let Some(expr) = directive.strip_prefix("//#elif ") {
            let (taken, _) = stack.pop().ok_or("//#elif without //#if")?;
            let on = !taken && test(expr)?;
            stack.push((taken || on, on));
        } else if directive == "//#else" {
            let (taken, _) = stack.pop().ok_or("//#else without //#if")?;
            stack.push((true, !taken));
        } else if directive == "//#endif" {
            stack.pop().ok_or("//#endif without //#if")?;
        } else if !is_active {
            continue;
        } else if let Some(name) = directive.strip_prefix("//#include ") {
            let text = include(name).ok_or_else(|| format!("no include named `{name}`"))?;
            out.push_str(&preprocess(&text, include, defines)?);
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    if !stack.is_empty() {
        return Err("unterminated //#if".into());
    }
    Ok(out)
}

/// Translate preprocessed WGSL with an `fs_main` fragment entry point into
/// GLSL ES 3.00 in the engine's conventions (see the crate docs).
pub fn wgsl_to_glsl(wgsl: &str) -> Result<String, String> {
    let mut module = naga::front::wgsl::parse_str(wgsl).map_err(|e| e.emit_to_string(wgsl))?;
    // Drops the functions, constants and types the entry point never
    // reaches (unused include helpers); the GLSL writer alone keeps them.
    naga::compact::compact(&mut module, naga::compact::KeepUnused::No);
    let info = Validator::new(ValidationFlags::all(), Capabilities::empty())
        .validate(&module)
        .map_err(|e| e.emit_to_string(wgsl))?;

    let options = glsl::Options {
        version: glsl::Version::Embedded { version: 300, is_webgl: true },
        writer_flags: glsl::WriterFlags::empty(),
        binding_map: glsl::BindingMap::default(),
        zero_initialize_workgroup_memory: false,
    };
    let pipeline = glsl::PipelineOptions {
        shader_stage: ShaderStage::Fragment,
        entry_point: FRAGMENT_ENTRY.to_string(),
        multiview: None,
    };
    let mut text = String::new();
    // Unchecked: no clamps injected around textureLoad or array indexing,
    // as in the hand-written GLSL, which guards its own texelFetch calls.
    let reflection = glsl::Writer::new(&mut text, &module, &info, &options, &pipeline, BoundsCheckPolicies::default())
        .map_err(|e| e.to_string())?
        .write()
        .map_err(|e| e.to_string())?;

    // Each sampler takes its WGSL texture's name.
    let mut renames: Vec<(String, String)> = Vec::new();
    for (glsl_name, mapping) in &reflection.texture_mapping {
        let texture = module.global_variables[mapping.texture]
            .name
            .clone()
            .ok_or("a texture global has no name")?;
        renames.push((glsl_name.clone(), texture));
    }
    // naga names the varyings by location. A shader may ignore its input,
    // but it has exactly one colour output.
    if !text.contains(NAGA_OUTPUT) || text.contains("_fs2p_location1") || text.contains("_vs2fs_location1") {
        return Err(format!(
            "`{FRAGMENT_ENTRY}` takes at most `@location(0) uv` and returns one `@location(0)` colour"
        ));
    }
    renames.push((NAGA_INPUT.to_string(), FRAGMENT_INPUT.to_string()));
    renames.push((NAGA_OUTPUT.to_string(), FRAGMENT_OUTPUT.to_string()));
    renames.sort();
    let text = rename_identifiers(&text, &renames)?;

    // The uniform struct, if the shader has one.
    let mut blocks = Vec::new();
    for (&handle, block_name) in &reflection.uniforms {
        let var = &module.global_variables[handle];
        if var.space != AddressSpace::Uniform {
            continue;
        }
        let binding = var.binding.as_ref().ok_or("a uniform global has no binding")?;
        let instance = format!("_group_{}_binding_{}_fs", binding.group, binding.binding);
        blocks.push((block_name.clone(), instance));
    }
    match blocks.as_slice() {
        [] => Ok(text),
        [(block_name, instance)] => flatten_params_struct(&text, block_name, instance),
        _ => Err(format!("expected at most one uniform struct, found {}", blocks.len())),
    }
}

/// naga writes a uniform struct as a struct type plus a block holding one
/// instance of it, and reads members through the instance:
///
/// ```glsl
/// struct Params {
///     float u_levels;
/// };
/// layout(std140) uniform Params_block_0Fragment { Params _group_0_binding_0_fs; };
/// ```
///
/// The engine's convention is one unnamed block whose members are global
/// names. Both lay the members out the same way under std140.
fn flatten_params_struct(text: &str, block_name: &str, instance: &str) -> Result<String, String> {
    let struct_open = format!("struct {PARAMS_STRUCT} {{");
    let block_line = format!("layout(std140) uniform {block_name} {{ {PARAMS_STRUCT} {instance}; }};");
    let mut members: Vec<String> = Vec::new();
    let mut out = String::with_capacity(text.len());
    let mut is_in_struct = false;
    let mut is_block_written = false;
    for line in text.lines() {
        if is_in_struct {
            if line.trim() == "};" {
                is_in_struct = false;
            } else {
                members.push(short_matrix_type(line));
            }
        } else if line.trim() == struct_open {
            is_in_struct = true;
        } else if line.trim() == block_line {
            out.push_str(&format!("layout(std140) uniform {PARAMS_STRUCT} {{\n"));
            for member in &members {
                out.push_str(member);
                out.push('\n');
            }
            out.push_str("};\n");
            is_block_written = true;
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    if !is_block_written || members.is_empty() {
        return Err(format!("the uniform struct must be named `{PARAMS_STRUCT}` and declared once"));
    }
    let out = out.replace(&format!("{instance}."), "");
    // The struct type is gone, so nothing may still name it (a function
    // taking the whole struct, say) or the bare instance.
    let idents: Vec<&str> = out.split(|c: char| !is_ident(c)).collect();
    if idents.iter().filter(|t| **t == PARAMS_STRUCT).count() != 1 || idents.contains(&instance) {
        return Err(format!("`{PARAMS_STRUCT}` may only be read member by member"));
    }
    Ok(out)
}

/// naga spells a square matrix `mat3x3`; the hand-written shaders, and the
/// check of each block against its Rust struct, spell it `mat3`.
fn short_matrix_type(member: &str) -> String {
    let mut out = member.to_string();
    for (long, short) in [("mat2x2 ", "mat2 "), ("mat3x3 ", "mat3 "), ("mat4x4 ", "mat4 ")] {
        if out.trim_start().starts_with(long) {
            out = out.replacen(long, short, 1);
        }
    }
    out
}

fn is_ident(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Whole-identifier rename. Refuses when a new name already occurs as an
/// identifier, so a rename can never capture an existing variable.
fn rename_identifiers(text: &str, renames: &[(String, String)]) -> Result<String, String> {
    let existing: Vec<&str> = text.split(|c: char| !is_ident(c)).collect();
    for (from, to) in renames {
        if existing.contains(&from.as_str()) && existing.contains(&to.as_str()) {
            return Err(format!("renaming {from} to {to} would collide with an existing name"));
        }
    }
    let mut out = String::with_capacity(text.len());
    let mut token = String::new();
    let flush = |token: &mut String, out: &mut String| {
        match renames.iter().find(|(from, _)| from == token) {
            Some((_, to)) => out.push_str(to),
            None => out.push_str(token),
        }
        token.clear();
    };
    for c in text.chars() {
        if is_ident(c) {
            token.push(c);
        } else {
            flush(&mut token, &mut out);
            out.push(c);
        }
    }
    flush(&mut token, &mut out);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NO_INCLUDES: &dyn Fn(&str) -> Option<String> = &|_| None;

    #[test]
    fn a_sampling_shader_links_with_the_shared_vertex_shader() {
        let glsl = wgsl_to_glsl(
            "@group(0) @binding(0) var u_tex: texture_2d<f32>;
             @group(0) @binding(1) var u_tex_sampler: sampler;
             @fragment
             fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
                 return textureSample(u_tex, u_tex_sampler, uv);
             }",
        )
        .unwrap();
        assert!(glsl.starts_with("#version 300 es\n"));
        assert!(glsl.contains("uniform highp sampler2D u_tex;"));
        assert!(glsl.contains("in vec2 v_uv;"));
        assert!(glsl.contains("out vec4 fragColor;"));
        assert!(!glsl.contains("_group_"));
    }

    #[test]
    fn the_uniform_struct_becomes_one_unnamed_block() {
        let glsl = wgsl_to_glsl(
            "struct Params { u_levels: f32, u_offset: vec2<f32>, }
             @group(0) @binding(0) var<uniform> params: Params;
             @fragment
             fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
                 return vec4<f32>(uv + params.u_offset, params.u_levels, 1.0);
             }",
        )
        .unwrap();
        assert!(glsl.contains("layout(std140) uniform Params {\n    float u_levels;\n    vec2 u_offset;\n};\n"), "{glsl}");
        assert!(!glsl.contains("struct Params"));
        assert!(!glsl.contains("_group_0_binding_0_fs"));
        assert!(glsl.contains("u_offset"));
    }

    #[test]
    fn a_square_matrix_member_takes_the_short_glsl_name() {
        let glsl = wgsl_to_glsl(
            "struct Params { u_colorMatrix: mat3x3<f32>, }
             @group(0) @binding(0) var<uniform> params: Params;
             @fragment
             fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
                 return vec4<f32>(params.u_colorMatrix * vec3<f32>(uv, 1.0), 1.0);
             }",
        )
        .unwrap();
        assert!(glsl.contains("    mat3 u_colorMatrix;\n"), "{glsl}");
    }

    #[test]
    fn a_shader_error_names_the_source() {
        let err = wgsl_to_glsl("@fragment fn fs_main() -> @location(0) vec4<f32> { return nope; }").unwrap_err();
        assert!(err.contains("nope"), "{err}");
    }

    #[test]
    fn includes_are_spliced_and_one_variant_branch_kept() {
        let include = |name: &str| (name == "helper").then(|| "fn helper() {}\n".to_string());
        let src = "//#include helper\n//#if MODE == 1\none\n//#elif MODE == 2\ntwo\n//#else\nother\n//#endif\n";
        assert_eq!(preprocess(src, &include, &[("MODE", 2)]).unwrap(), "fn helper() {}\ntwo\n");
        assert_eq!(preprocess(src, &include, &[]).unwrap(), "fn helper() {}\nother\n");
    }

    #[test]
    fn a_missing_include_or_open_branch_is_an_error() {
        assert!(preprocess("//#include gone\n", NO_INCLUDES, &[]).is_err());
        assert!(preprocess("//#if A == 1\n", NO_INCLUDES, &[]).is_err());
    }
}
