//! `lopsy`: the engine from a command line, on this machine's GPU.
//!
//!     lopsy --op blur=8 --op invert --out done photos/*.png
//!
//! Each input PNG becomes one layer of a document its own size, the
//! operations run on it in the order given, and the result is written as an
//! 8-bit PNG of the same name in the output directory. One engine, and so
//! one GPU device and one set of compiled shaders, serves every image.
//!
//! This is a host, like the wasm one: it starts the engine and calls the
//! functions in `lopsy_engine::commands`. It holds no image logic.

mod args;
mod operation;

use std::fs;
use std::future::Future;
use std::path::Path;
use std::process::ExitCode;
use std::sync::OnceLock;
use std::task::{Context, Poll, Waker};
use std::time::Instant;

use lopsy_core::decode::{decode_png, DecodedPixels};
use lopsy_engine::commands::layer;
use lopsy_engine::engine::EngineInner;
use lopsy_engine::gpu::context::GpuContext;
use lopsy_engine::gpu::shader::ShaderPrograms;
use lopsy_engine::host::{self, Host, LogLevel};

use args::{Job, Request};
use operation::{Operation, USAGE};

const LAYER: &str = "image";

fn main() -> ExitCode {
    match args::parse(std::env::args().skip(1)) {
        Ok(Request::Help) => {
            print_usage();
            ExitCode::SUCCESS
        }
        Ok(Request::Run(job)) => match run(&job) {
            Ok(()) => ExitCode::SUCCESS,
            Err(reason) => {
                eprintln!("lopsy: {reason}");
                ExitCode::FAILURE
            }
        },
        Err(reason) => {
            eprintln!("lopsy: {reason}\n");
            print_usage();
            ExitCode::FAILURE
        }
    }
}

fn print_usage() {
    println!("usage: lopsy [--op <operation>]... --out <directory> <image.png>...\n");
    println!("Operations run in the order given:");
    for (form, meaning) in USAGE {
        println!("  {form:<40} {meaning}");
    }
}

fn run(job: &Job) -> Result<(), String> {
    fs::create_dir_all(&job.out_dir).map_err(|e| format!("{}: {e}", job.out_dir.display()))?;
    let mut engine = start_engine()?;
    for input in &job.inputs {
        let name = input.file_name().ok_or_else(|| format!("{}: not a file", input.display()))?;
        let output = job.out_dir.join(name);
        process(&mut engine, input, &output, &job.operations).map_err(|e| format!("{}: {e}", input.display()))?;
        println!("{} -> {}", input.display(), output.display());
    }
    Ok(())
}

fn start_engine() -> Result<EngineInner, String> {
    static STARTED: OnceLock<Instant> = OnceLock::new();
    STARTED.get_or_init(Instant::now);
    host::install(Host {
        log: |level, message| {
            if matches!(level, LogLevel::Warn | LogLevel::Error) {
                eprintln!("{message}");
            }
        },
        now_ms: || STARTED.get().map_or(0.0, |started| started.elapsed().as_secs_f64() * 1000.0),
        gpu_lost: |reason| eprintln!("lopsy: the GPU was lost: {reason}"),
    });
    let context = block_on(GpuContext::headless())?;
    let shaders = ShaderPrograms::compile_all(&context)?;
    EngineInner::new(context, shaders)
}

/// One image through the engine: a document its size, one layer holding
/// it, the operations, and the layer read back.
fn process(engine: &mut EngineInner, input: &Path, output: &Path, operations: &[Operation]) -> Result<(), String> {
    let bytes = fs::read(input).map_err(|e| e.to_string())?;
    let image = decode_png(&bytes).ok_or("not a PNG this can decode")?;
    let (width, height) = (image.width, image.height);

    engine.set_document_size(width, height)?;
    layer::add_layer(engine, &layer_description(width, height))?;
    let result = (|| {
        match &image.pixels {
            DecodedPixels::Rgba8(pixels) => layer::upload_layer_pixels(engine, LAYER, pixels, width, height, 0, 0)?,
            DecodedPixels::RgbaF32(pixels) => {
                layer::upload_layer_pixels_f32_rect(engine, LAYER, width, height, 0, 0, width, height, pixels)?;
            }
        }
        for operation in operations {
            operation.apply(engine, LAYER)?;
        }
        let size = layer::get_layer_texture_dimensions(engine, LAYER);
        let pixels = block_on(layer::read_layer_pixels(engine, LAYER))?;
        match size[..] {
            [w, h] if pixels.len() == (w as usize) * (h as usize) * 4 => write_png(output, w, h, &pixels),
            _ => Err("the layer came back a size its pixels do not fit".to_string()),
        }
    })();
    layer::remove_layer(engine, LAYER);
    result
}

fn layer_description(width: u32, height: u32) -> String {
    format!(
        r#"{{"id":"{LAYER}","name":"{LAYER}","layer_type":"Raster","visible":true,"locked":false,
            "opacity":1.0,"blend_mode":"Normal","x":0,"y":0,"width":{width},"height":{height},
            "clip_to_below":false,"mask":null}}"#
    )
}

fn write_png(path: &Path, width: u32, height: u32, rgba: &[u8]) -> Result<(), String> {
    let file = fs::File::create(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
    writer.write_image_data(rgba).map_err(|e| e.to_string())
}

/// Run a future whose every wait is on the GPU, which a native device
/// answers when polled.
fn block_on<F: Future>(future: F) -> F::Output {
    let mut future = std::pin::pin!(future);
    let mut context = Context::from_waker(Waker::noop());
    loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return value;
        }
        std::thread::yield_now();
    }
}
