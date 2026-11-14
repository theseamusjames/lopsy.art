//! `lopsy-shaderc <shaders-dir> <out-dir>`
//!
//! Translates every shader as the engine's build script does and writes,
//! under the same relative paths, the WGSL as naga parsed it (`.wgsl`) and
//! the GLSL generated from it (`.glsl`). For tools that look at the
//! shaders outside a build: `scripts/check-wgsl-webgpu.mjs` feeds the WGSL
//! to a browser's WebGPU compiler.

use std::fs;
use std::path::Path;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let [_, shaders, out] = args.as_slice() else {
        eprintln!("usage: lopsy-shaderc <shaders-dir> <out-dir>");
        return ExitCode::from(2);
    };
    match run(Path::new(shaders), Path::new(out)) {
        Ok(count) => {
            println!("{count} shaders translated");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}

fn run(root: &Path, out: &Path) -> Result<usize, String> {
    let files = lopsy_shaderc::shader_files(root)?;
    for path in &files {
        let translated = lopsy_shaderc::translate_file(root, path)?;
        let relative = path.strip_prefix(root).map_err(|e| e.to_string())?;
        let dest = out.join(relative);
        let parent = dest.parent().ok_or("a shader path has no parent")?;
        fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        fs::write(&dest, &translated.wgsl).map_err(|e| format!("{}: {e}", dest.display()))?;
        let glsl = dest.with_extension("glsl");
        fs::write(&glsl, &translated.glsl).map_err(|e| format!("{}: {e}", glsl.display()))?;
    }
    Ok(files.len())
}
