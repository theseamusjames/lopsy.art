//! Golden renders: real RAW files through the whole develop chain on a
//! native GPU, compared with fingerprints stored in `tests/golden/`
//! (`docs/photonamous-spec.md` section 10). A change to how a photo renders
//! fails here until its fingerprints are made again, so it cannot happen by
//! accident.
//!
//! ```text
//! cd engine
//! LOPSY_RAF_SAMPLES=/path/to/sample-raf-images cargo test -p lopsy-engine --features native --test golden
//! # After a change to rendering that is meant, make the fingerprints again and commit them with it:
//! LOPSY_RAF_SAMPLES=/path/to/sample-raf-images LOPSY_GOLDEN_UPDATE=1 cargo test -p lopsy-engine --features native --test golden
//! ```
//!
//! The RAF files are the public samples of `theseamusjames/sample-raf-images`,
//! kept outside this repository; without `LOPSY_RAF_SAMPLES` the test notes
//! that and passes, and so it does on a machine with no GPU.
//!
//! Each file is decoded as Photonamous decodes it for its working image:
//! `prepare_raf`, then the binned linear camera RGB with a long edge of at
//! least `LONG_EDGE`, uploaded as the document's one layer. For each of
//! `SETTINGS` the develop chain runs with the working space on, as
//! Photonamous runs it, through `compositor::composite_for_export_u16`
//! (rendered for sRGB), and the result is reduced to a
//! fingerprint: the mean R, G and B of each cell of a `GRID_COLUMNS` ×
//! `GRID_ROWS` grid, in 16-bit steps. One text file per sample holds every
//! setting's fingerprint; a cell channel more than `TOLERANCE` steps from
//! it fails, naming the file, the settings and every cell that moved.

use std::fmt::Write as _;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::task::{Context, Poll, Waker};

use lopsy_core::raf::develop::{self, RawDevelopSettings};
use lopsy_core::raf::{prepare_raf, RafDecodeOpts};
use lopsy_engine::engine::EngineInner;
use lopsy_engine::gpu::context::GpuContext;
use lopsy_engine::gpu::shader::ShaderPrograms;
use lopsy_engine::{commands, document::compositor, host};

/// The binned image's long edge is at least this, in pixels: big enough
/// for the detail stages to have edges to work on, small enough that the
/// suite runs in seconds.
const LONG_EDGE: u32 = 512;
const GRID_COLUMNS: usize = 12;
const GRID_ROWS: usize = 8;

/// How far a cell's mean may move, in 16-bit steps (1/65535): one 8-bit
/// level. Every texture is half float, and GPUs differ in how they round
/// a value they store in one (the Apple GPU the fingerprints were made on
/// rounds toward zero, others to nearest) and in their `exp`, `pow` and
/// filtering. Rounding toward zero lowers a stored value by half an ulp on
/// average (16 steps in 0.5..1), and in a cell's mean those biases add up
/// rather than averaging out: about ten computing passes in the longest
/// chain here make some 160 steps. Raising the baseline exposure by 0.02
/// EV (1.5%) moves about a third of each photo's cells by more than this.
const TOLERANCE: i32 = 256;

const UPDATE_VAR: &str = "LOPSY_GOLDEN_UPDATE";

thread_local! {
    /// Errors the engine logged on this thread (see `render.rs`).
    static ERRORS: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
}

fn record(level: host::LogLevel, message: &str) {
    if level == host::LogLevel::Error {
        ERRORS.with_borrow_mut(|errors| errors.push(message.to_string()));
    }
}

fn block_on<F: Future>(future: F) -> F::Output {
    let mut future = std::pin::pin!(future);
    let mut cx = Context::from_waker(Waker::noop());
    loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut cx) {
            return value;
        }
        std::thread::yield_now();
    }
}

/// One RAF file, decoded for the working image.
struct Decoded {
    name: String,
    /// The file's size in bytes, stored with its fingerprints so that a
    /// different file under the same name is not compared with them.
    bytes: u64,
    width: u32,
    height: u32,
    /// Linear camera RGB, RGBA f32, as `rafRenderBinnedLinear` gives it.
    linear: Vec<f32>,
    defaults: RawDevelopSettings,
    /// Working width over the full, oriented width, as the app computes it.
    pixel_scale: f32,
}

fn decode(path: &Path) -> Result<Decoded, String> {
    let data = std::fs::read(path).map_err(|e| format!("read: {e}"))?;
    let prep = prepare_raf(&data, RafDecodeOpts::default())?;
    let (full_width, _) = prep.params.oriented_size();
    let (width, height, linear) = develop::render_binned_linear_for(&prep.mosaic, &prep.params, LONG_EDGE)?;
    Ok(Decoded {
        name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        bytes: data.len() as u64,
        width,
        height,
        linear,
        defaults: develop::develop_defaults(&prep.params),
        pixel_scale: width as f32 / full_width.max(1) as f32,
    })
}

/// One fixed set of develop settings. `apply` sets everything but the RAW
/// stage on an engine holding `photo`; `raw` makes the RAW stage's settings.
struct Settings {
    name: &'static str,
    raw: fn(&Decoded) -> RawDevelopSettings,
    apply: fn(&mut EngineInner, &Decoded),
}

const SETTINGS: [Settings; 4] = [
    // The camera profile's defaults: what a photo looks like when opened.
    Settings { name: "camera-defaults", raw: |photo| photo.defaults.clone(), apply: |_, _| {} },
    // One stop brighter and warmer: the RAW stage's exposure and white
    // balance.
    Settings {
        name: "plus-1ev-warm",
        raw: |photo| RawDevelopSettings {
            exposure_ev: photo.defaults.exposure_ev + 1.0,
            wb_ratio: [1.12, 1.0, 0.86],
            ..photo.defaults.clone()
        },
        apply: |_, _| {},
    },
    // The document-wide stages after the RAW one: noise reduction, local
    // contrast and haze, tone on scene data (Contrast, Highlights and
    // Shadows), colour by hue in the look pass, sharpening and finish, at
    // the working image's pixel scale.
    Settings {
        name: "color-detail-finish",
        raw: |photo| photo.defaults.clone(),
        apply: |engine, photo| {
            let scale = photo.pixel_scale;
            commands::develop::set_image_detail(engine, &[80.0, 1.0, 20.0, 30.0, 50.0, 40.0, scale]).expect("detail");
            commands::develop::set_image_local_contrast(engine, &[35.0, 30.0, 20.0, scale]).expect("local contrast");
            commands::develop::set_develop_tone(engine, &[0.0, 0.0, 0.0, 15.0, -30.0, 25.0, 0.0, 0.0]).expect("tone");
            // (hue, saturation, luminance) of orange, yellow, green and
            // blue: oranges and yellows richer, greens toward yellow and
            // paler, blues deeper and more saturated.
            let mut mixer = [0.0f32; 24];
            mixer[3..6].copy_from_slice(&[10.0, 25.0, 5.0]);
            mixer[6..9].copy_from_slice(&[-10.0, 20.0, 0.0]);
            mixer[9..12].copy_from_slice(&[-20.0, -15.0, 10.0]);
            mixer[15..18].copy_from_slice(&[5.0, 35.0, -25.0]);
            let mut look = vec![0.0f32; 2];
            look.extend_from_slice(&mixer);
            look.extend_from_slice(&[0.0; 18]);
            commands::develop::set_develop_look(engine, &look).expect("look");
            commands::develop::set_image_finish(engine, &[-35.0, 50.0, 20.0, 50.0, 30.0, 40.0, 50.0, 7.0, scale]).expect("finish");
        },
    },
    // A radial area with its built-in adjustments (on scene data and in the
    // look pass), and a layer for it with whites, blacks, vibrance and
    // colour grading of its own.
    Settings {
        name: "area-and-layer",
        raw: |photo| photo.defaults.clone(),
        apply: |engine, photo| {
            let (w, h) = (photo.width as f32, photo.height as f32);
            let area = [
                1.0, 0.0, 1.0, // radial, not inverted, full amount
                0.4 * w, 0.45 * h, 0.3 * w, 0.25 * h, // centre and radii
                0.3, 0.6, // rotation, feather
                0.5, 20.0, -20.0, 30.0, 25.0, -10.0, 15.0, // exposure .. saturation
            ];
            commands::develop::set_image_areas(engine, &area).expect("areas");
            // Whites, blacks, vibrance, no colour by hue, and a cool global
            // tint, as `compileColorGrade` packs one.
            let mut layer = [0.0f32; commands::develop::AREA_LOOK_LEN];
            layer[..3].copy_from_slice(&[20.0, -15.0, 30.0]);
            let grade = &mut layer[27..];
            grade[12] = -0.15;
            grade[14] = 0.2;
            grade[16] = 1.0;
            grade[17] = 0.25;
            commands::develop::set_develop_area_look(engine, 0, &layer).expect("area look");
        },
    },
];

/// A grid's cells, row by row: the mean R, G and B of each.
type Fingerprint = Vec<[i32; 3]>;

/// The mean R, G and B of each grid cell of a `width`×`height` 16-bit
/// RGBA image, row by row, rounded to whole steps.
fn fingerprint(pixels: &[u16], width: u32, height: u32) -> Fingerprint {
    let (w, h) = (width as usize, height as usize);
    let mut cells = Vec::with_capacity(GRID_COLUMNS * GRID_ROWS);
    for row in 0..GRID_ROWS {
        let (y0, y1) = (row * h / GRID_ROWS, (row + 1) * h / GRID_ROWS);
        for column in 0..GRID_COLUMNS {
            let (x0, x1) = (column * w / GRID_COLUMNS, (column + 1) * w / GRID_COLUMNS);
            let mut sum = [0u64; 3];
            for y in y0..y1 {
                for x in x0..x1 {
                    let p = &pixels[(y * w + x) * 4..][..3];
                    for c in 0..3 {
                        sum[c] += u64::from(p[c]);
                    }
                }
            }
            let n = ((y1 - y0) * (x1 - x0)).max(1) as u64;
            cells.push(sum.map(|s| ((s + n / 2) / n) as i32));
        }
    }
    cells
}

/// Every setting's fingerprint of one photo, each on a fresh engine so
/// that nothing one setting turns on carries over to the next. `None`
/// with no GPU.
fn render(photo: &Decoded) -> Option<Vec<(&'static str, Fingerprint)>> {
    let mut results = Vec::new();
    for settings in &SETTINGS {
        let mut engine = new_engine(photo.width, photo.height)?;
        let layer = format!(
            r#"{{"id":"photo","name":"photo","layer_type":"Raster","visible":true,"locked":false,
                "opacity":1,"blend_mode":"Normal","x":0,"y":0,"width":{w},"height":{h},
                "clip_to_below":false,"mask":null}}"#,
            w = photo.width,
            h = photo.height,
        );
        commands::layer::add_layer(&mut engine, &layer).expect("layer");
        let (w, h) = (photo.width, photo.height);
        commands::layer::upload_layer_pixels_f32_rect(&mut engine, "photo", w, h, 0, 0, w, h, &photo.linear).expect("pixels");
        let raw = serde_json::to_string(&(settings.raw)(photo)).expect("settings JSON");
        commands::develop::set_raw_develop_json(&mut engine, &raw).expect("raw develop");
        commands::develop::set_develop_working_space(&mut engine, true, 0).expect("working space");
        (settings.apply)(&mut engine, photo);
        let pixels = block_on(compositor::composite_for_export_u16(&mut engine)).expect("export");
        let errors = ERRORS.with_borrow(Vec::clone);
        assert!(errors.is_empty(), "{}, {}: the engine logged errors: {errors:#?}", photo.name, settings.name);
        results.push((settings.name, fingerprint(&pixels, w, h)));
    }
    Some(results)
}

fn new_engine(width: u32, height: u32) -> Option<EngineInner> {
    host::install(host::Host { log: record, now_ms: || 0.0, gpu_lost: |_| {} });
    ERRORS.with_borrow_mut(Vec::clear);
    let ctx = match block_on(GpuContext::headless()) {
        Ok(ctx) => ctx,
        Err(reason) => {
            eprintln!("skipped: no GPU for the golden renders ({reason})");
            return None;
        }
    };
    let shaders = ShaderPrograms::compile_all(&ctx).expect("shaders compile");
    let mut engine = EngineInner::new(ctx, shaders).expect("engine starts");
    engine.set_document_size(width, height).expect("document size");
    Some(engine)
}

/// What a sample's file in `tests/golden/` holds.
struct Stored {
    bytes: u64,
    width: u32,
    height: u32,
    fingerprints: Vec<(String, Fingerprint)>,
}

fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("golden")
}

fn golden_path(name: &str) -> PathBuf {
    golden_dir().join(format!("{name}.txt"))
}

fn write_stored(photo: &Decoded, fingerprints: &[(&str, Fingerprint)]) -> String {
    let mut text = String::new();
    let _ = writeln!(text, "# Golden render fingerprints of {}: engine/tests/golden.rs.", photo.name);
    let _ = writeln!(text, "# Remade with LOPSY_GOLDEN_UPDATE=1; a change to rendering comes with new ones.");
    let _ = writeln!(text, "# Per settings, {GRID_ROWS} lines of {GRID_COLUMNS} cells: the mean R,G,B of each, 0..65535.");
    let _ = writeln!(text, "bytes {}", photo.bytes);
    let _ = writeln!(text, "size {} {}", photo.width, photo.height);
    for (settings, cells) in fingerprints {
        for (row, line) in cells.chunks(GRID_COLUMNS).enumerate() {
            let _ = write!(text, "{settings} {row}");
            for [r, g, b] in line {
                let _ = write!(text, " {r},{g},{b}");
            }
            text.push('\n');
        }
    }
    text
}

fn read_stored(text: &str) -> Result<Stored, String> {
    let mut stored = Stored { bytes: 0, width: 0, height: 0, fingerprints: Vec::new() };
    for (number, line) in text.lines().enumerate().filter(|(_, l)| !l.trim().is_empty() && !l.starts_with('#')) {
        let bad = || format!("line {}: {line:?}", number + 1);
        let mut words = line.split_whitespace();
        let key = words.next().ok_or_else(bad)?;
        let int = |words: &mut std::str::SplitWhitespace| words.next().and_then(|w| w.parse::<u64>().ok()).ok_or_else(bad);
        match key {
            "bytes" => stored.bytes = int(&mut words)?,
            "size" => {
                stored.width = int(&mut words)? as u32;
                stored.height = int(&mut words)? as u32;
            }
            settings => {
                let row = int(&mut words)? as usize;
                let cells = words
                    .map(|cell| {
                        let v: Vec<i32> = cell.split(',').filter_map(|c| c.parse().ok()).collect();
                        <[i32; 3]>::try_from(v).map_err(|_| bad())
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                if cells.len() != GRID_COLUMNS {
                    return Err(bad());
                }
                if stored.fingerprints.last().is_none_or(|(name, _)| name != settings) {
                    stored.fingerprints.push((settings.to_string(), Vec::new()));
                }
                let (_, all) = stored.fingerprints.last_mut().unwrap();
                if all.len() != row * GRID_COLUMNS {
                    return Err(bad());
                }
                all.extend(cells);
            }
        }
    }
    Ok(stored)
}

/// What differs between a photo's render and its stored fingerprints, as
/// lines of a failure message; empty when they agree.
fn compare(photo: &Decoded, rendered: &[(&str, Fingerprint)], stored: &Stored) -> Vec<String> {
    if stored.bytes != photo.bytes {
        return vec![format!("{}: the stored fingerprints are of a {}-byte file, this one is {} bytes", photo.name, stored.bytes, photo.bytes)];
    }
    if (stored.width, stored.height) != (photo.width, photo.height) {
        return vec![format!(
            "{}: decoded at {}×{}, the fingerprints were made at {}×{}",
            photo.name, photo.width, photo.height, stored.width, stored.height
        )];
    }
    let mut problems = Vec::new();
    for (settings, cells) in rendered {
        if let Some((_, expected)) = stored.fingerprints.iter().find(|(name, _)| name == settings) {
            eprintln!("{}, {settings}: {}", photo.name, movement(cells, expected));
        }
        let Some((_, expected)) = stored.fingerprints.iter().find(|(name, _)| name == settings) else {
            problems.push(format!("{}, {settings}: no stored fingerprint", photo.name));
            continue;
        };
        if expected.len() != cells.len() {
            problems.push(format!("{}, {settings}: {} cells stored, {} rendered", photo.name, expected.len(), cells.len()));
            continue;
        }
        let moved: Vec<String> = cells
            .iter()
            .zip(expected)
            .enumerate()
            .filter_map(|(i, (got, want))| {
                let delta = [0, 1, 2].map(|c| got[c] - want[c]);
                delta.iter().any(|d| d.abs() > TOLERANCE).then(|| {
                    format!("row {} column {}: R {:+} G {:+} B {:+}", i / GRID_COLUMNS, i % GRID_COLUMNS, delta[0], delta[1], delta[2])
                })
            })
            .collect();
        if !moved.is_empty() {
            problems.push(format!(
                "{}, {settings}: {} of {} cells moved more than {TOLERANCE} 16-bit steps:\n    {}",
                photo.name,
                moved.len(),
                cells.len(),
                moved.join("\n    "),
            ));
        }
    }
    for (name, _) in &stored.fingerprints {
        if !rendered.iter().any(|(settings, _)| settings == name) {
            problems.push(format!("{}: stored settings {name:?} are no longer rendered", photo.name));
        }
    }
    problems
}

/// How far a fingerprint moved from the stored one: the worst cell channel
/// and the median of each cell's worst channel, in 16-bit steps.
fn movement(cells: &Fingerprint, expected: &Fingerprint) -> String {
    let mut worst: Vec<i32> = cells
        .iter()
        .zip(expected)
        .map(|(got, want)| (0..3).map(|c| (got[c] - want[c]).abs()).max().unwrap_or(0))
        .collect();
    worst.sort_unstable();
    let max = worst.last().copied().unwrap_or(0);
    let median = worst.get(worst.len() / 2).copied().unwrap_or(0);
    format!("moved at most {max} steps, median cell {median}")
}

fn samples() -> Option<Vec<PathBuf>> {
    let dir = std::env::var("LOPSY_RAF_SAMPLES").ok()?;
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("LOPSY_RAF_SAMPLES={dir}: {e}"))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("raf")))
        .collect();
    files.sort();
    Some(files)
}

/// Decode `files` on a few threads at once: a debug build's decode is most
/// of the suite's time, and each holds a frame's mosaic (about 160 MB), so
/// not all of them at once.
fn decode_all(files: &[PathBuf]) -> Vec<(PathBuf, Result<Decoded, String>)> {
    let next = std::sync::atomic::AtomicUsize::new(0);
    let threads = std::thread::available_parallelism().map_or(2, |n| n.get()).min(4);
    let mut decoded: Vec<(PathBuf, Result<Decoded, String>)> = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..threads)
            .map(|_| {
                scope.spawn(|| {
                    let mut out = Vec::new();
                    loop {
                        let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let Some(path) = files.get(i) else { return out };
                        out.push((path.clone(), decode(path)));
                    }
                })
            })
            .collect();
        workers.into_iter().flat_map(|worker| worker.join().expect("decode thread")).collect()
    });
    decoded.sort_by(|a, b| a.0.cmp(&b.0));
    decoded
}

#[test]
fn real_raw_files_render_as_their_stored_fingerprints() {
    let Some(files) = samples() else {
        eprintln!("LOPSY_RAF_SAMPLES not set; skipping the golden renders");
        return;
    };
    assert!(!files.is_empty(), "LOPSY_RAF_SAMPLES holds no .RAF files");
    let update = std::env::var(UPDATE_VAR).is_ok_and(|v| v == "1");
    let mut problems = Vec::new();
    for (path, decoded) in decode_all(&files) {
        let photo = decoded.unwrap_or_else(|e| panic!("{}: does not decode: {e}", path.display()));
        let Some(rendered) = render(&photo) else { return };
        let golden = golden_path(&path.file_stem().unwrap_or_default().to_string_lossy());
        if update {
            std::fs::create_dir_all(golden_dir()).expect("golden directory");
            std::fs::write(&golden, write_stored(&photo, &rendered)).expect("write fingerprints");
            eprintln!("{}: fingerprints written to {}", photo.name, golden.display());
            continue;
        }
        let stored = match std::fs::read_to_string(&golden) {
            Ok(text) => read_stored(&text).unwrap_or_else(|e| panic!("{}: {e}", golden.display())),
            Err(_) => {
                problems.push(format!("{}: no stored fingerprints at {}", photo.name, golden.display()));
                continue;
            }
        };
        let found = compare(&photo, &rendered, &stored);
        eprintln!("{}: {}", photo.name, if found.is_empty() { "matches" } else { "differs" });
        problems.extend(found);
    }
    assert!(
        problems.is_empty(),
        "golden renders differ from their stored fingerprints (tolerance {TOLERANCE} of 65535 per cell mean).\n\
         If rendering was meant to change, run again with {UPDATE_VAR}=1 and commit the new fingerprints with the change.\n{}",
        problems.join("\n"),
    );
}

#[test]
fn a_fingerprint_survives_writing_and_reading_and_reports_what_moved() {
    let photo = Decoded {
        name: "TEST.RAF".to_string(),
        bytes: 42,
        width: 24,
        height: 16,
        linear: Vec::new(),
        defaults: RawDevelopSettings {
            wb_ratio: [1.0; 3],
            cam_to_rgb: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
            exposure_ev: 0.0,
            saturation: 1.0,
            highlight_desaturation: false,
            base_curve: None,
            clip_levels: None,
        },
        pixel_scale: 1.0,
    };
    let pixels: Vec<u16> = (0..24 * 16).flat_map(|i| [(i * 100) as u16, 30000, (65535 - i * 50) as u16, 65535]).collect();
    let cells = fingerprint(&pixels, 24, 16);
    assert_eq!(cells.len(), GRID_COLUMNS * GRID_ROWS);
    // Cell (0, 0) is pixels (0..2, 0..2): indices 0, 1, 24 and 25.
    assert_eq!(cells[0], [1250, 30000, 64910]);
    let rendered = vec![("plain", cells.clone()), ("other", cells.clone())];
    let stored = read_stored(&write_stored(&photo, &rendered)).expect("reads back");
    assert!(compare(&photo, &rendered, &stored).is_empty());

    let mut moved = cells.clone();
    moved[GRID_COLUMNS + 2][1] += TOLERANCE + 1;
    let problems = compare(&photo, &[("plain", cells), ("other", moved)], &stored);
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert!(problems[0].contains("TEST.RAF, other: 1 of 96 cells") && problems[0].contains("row 1 column 2: R +0 G +257 B +0"), "{}", problems[0]);
}
