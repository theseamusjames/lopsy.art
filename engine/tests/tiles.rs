//! Tiles on a real GPU, with no browser:
//! `cargo test -p lopsy-engine --features native --test tiles`.
//!
//! A document can be one rectangle of a larger picture
//! (`commands::develop::set_document_region`, `lopsy_core::tile`). These
//! render a picture whole and then tile by tile, each tile its kept part
//! plus the apron the engine reports (`develop_apron`) clipped to the
//! picture, with the layer filled from the picture's bands through
//! `upload_layer_pixels_f32_window`, and assemble the kept parts. The
//! assembly must equal the whole picture's export bit for bit, for each
//! export read and both chain orders. They also check that an apron that
//! is too small does differ (so the comparison can fail), that a region
//! set and cleared changes nothing, that a tile loop gives back every
//! texture, and the window upload itself.
//!
//! A machine with no GPU adapter skips them: every test returns early with
//! a note on stderr.

use std::cell::RefCell;
use std::future::Future;
use std::task::{Context, Poll, Waker};

use lopsy_core::geometry::Rect;
use lopsy_engine::engine::EngineInner;
use lopsy_engine::gpu::context::GpuContext;
use lopsy_engine::gpu::read::Read;
use lopsy_engine::gpu::shader::ShaderPrograms;
use lopsy_engine::{commands, document::compositor, host};

thread_local! {
    /// Everything the engine logged as an error on this thread (see
    /// `tests/render.rs`).
    static ERRORS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
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

/// An engine with a `width` by `height` document, or `None` where there is
/// no GPU to make one on.
fn engine(width: u32, height: u32) -> Option<EngineInner> {
    host::install(host::Host { log: record, now_ms: || 0.0, gpu_lost: |_, _, _| {} });
    ERRORS.with_borrow_mut(Vec::clear);
    let ctx = match block_on(GpuContext::headless()) {
        Ok(ctx) => ctx,
        Err(reason) => {
            eprintln!("skipped: no GPU for a tile test ({reason})");
            return None;
        }
    };
    let shaders = ShaderPrograms::compile_all(&ctx).expect("shaders compile");
    let mut engine = EngineInner::new(ctx, shaders).expect("engine starts");
    engine.set_document_size(width, height).expect("document size");
    Some(engine)
}

fn now<T: 'static>(read: Read<T>) -> T {
    block_on(read).expect("readback")
}

fn assert_no_gpu_errors() {
    let errors = ERRORS.with_borrow(Vec::clone);
    assert!(errors.is_empty(), "the engine logged errors: {errors:#?}");
}

fn layer_json(id: &str, x: u32, y: u32, width: u32, height: u32) -> String {
    format!(
        r#"{{"id":"{id}","name":"{id}","layer_type":"Raster","visible":true,"locked":false,
            "opacity":1,"blend_mode":"Normal","x":{x},"y":{y},"width":{width},"height":{height},
            "clip_to_below":false,"mask":null}}"#
    )
}

/// Textures the engine's pool has handed out and not had back.
fn textures_in_use(engine: &EngineInner) -> usize {
    engine.texture_pool.live_entry_count() - engine.texture_pool.free_entry_count()
}

/// A RAW photo's settings: an X-Trans-like matrix and a film curve.
fn develop_settings() -> lopsy_core::raf::develop::RawDevelopSettings {
    use lopsy_core::raf::{base_curves, develop};
    develop::RawDevelopSettings {
        wb_ratio: [1.1, 1.0, 0.9],
        cam_to_rgb: [1.71, -0.62, -0.09, -0.21, 1.48, -0.27, 0.04, -0.47, 1.43],
        exposure_ev: develop::baseline_exposure_ev(),
        saturation: 1.2,
        highlight_desaturation: true,
        base_curve: Some(base_curves::curve_lut(base_curves::curve_for_film_mode(None)).to_vec()),
        clip_levels: None,
    }
}

/// `w`×`h` of linear camera RGB that gives every stage something to do:
/// blocks with hard edges, ramps across and down, a fine texture, noise
/// per pixel, and highlights above white along a band. Opaque.
fn picture(w: u32, h: u32) -> Vec<f32> {
    let noise = |x: u32, y: u32, k: u32| lopsy_core::finish::hash(x, y, k) - 0.5;
    (0..w * h)
        .flat_map(|i| {
            let (x, y) = (i % w, i / w);
            let (fx, fy) = (x as f32 / (w - 1) as f32, y as f32 / (h - 1) as f32);
            let block = if (x / 37 + y / 29) % 2 == 0 { 0.08 } else { 0.35 };
            let texture = (x as f32 * 0.9).sin() * (y as f32 * 0.7).cos();
            let glint = if (y / 40) % 7 == 3 && (x / 50) % 5 == 2 { 1.5 } else { 0.0 };
            let r = block + 0.3 * fx + 0.02 * texture + 0.03 * noise(x, y, 1) + glint;
            let g = 0.8 * block + 0.25 * fy + 0.03 * texture + 0.03 * noise(x, y, 2) + glint;
            let b = 0.05 + 0.3 * (1.0 - fx) * fy + 0.03 * texture + 0.03 * noise(x, y, 3) + 0.8 * glint;
            [r.max(0.0), g.max(0.0), b.max(0.0), 1.0]
        })
        .collect()
}

/// The exports a comparison reads.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Export {
    /// `compositeForExport`: 8-bit sRGB, dithered for a RAW photo with the
    /// working space.
    Eight,
    /// The read behind `exportPng16` for sRGB.
    Sixteen,
    /// `readHdrOutputF32` at a peak of 4 (working space only).
    Hdr,
}

/// One export's pixels, RGBA from the top row.
#[derive(Clone, Debug, PartialEq)]
enum Pixels {
    U8(Vec<u8>),
    U16(Vec<u16>),
    F32(Vec<f32>),
}

impl Pixels {
    fn values(&self) -> usize {
        match self {
            Pixels::U8(v) => v.len(),
            Pixels::U16(v) => v.len(),
            Pixels::F32(v) => v.len(),
        }
    }

    /// An empty `w`×`h` image of the same kind.
    fn blank(&self, w: u32, h: u32) -> Pixels {
        let n = (w * h * 4) as usize;
        match self {
            Pixels::U8(_) => Pixels::U8(vec![0; n]),
            Pixels::U16(_) => Pixels::U16(vec![0; n]),
            Pixels::F32(_) => Pixels::F32(vec![0.0; n]),
        }
    }

    /// Copy `rect` of `self` (an image `width` wide whose texel (0, 0) is at
    /// `origin`) into `to`, an image `to_width` wide at the origin.
    fn copy_into(&self, width: u32, origin: (u32, u32), rect: Rect, to: &mut Pixels, to_width: u32) {
        let row = rect.width as usize * 4;
        for y in rect.y as u32..rect.y as u32 + rect.height {
            let from = (((y - origin.1) * width + rect.x as u32 - origin.0) * 4) as usize;
            let at = ((y * to_width + rect.x as u32) * 4) as usize;
            match (self, &mut *to) {
                (Pixels::U8(a), Pixels::U8(b)) => b[at..at + row].copy_from_slice(&a[from..from + row]),
                (Pixels::U16(a), Pixels::U16(b)) => b[at..at + row].copy_from_slice(&a[from..from + row]),
                (Pixels::F32(a), Pixels::F32(b)) => b[at..at + row].copy_from_slice(&a[from..from + row]),
                _ => panic!("different kinds of pixels"),
            }
        }
    }

    /// How many values differ from `other`'s, and the largest difference
    /// in the export's own units (8- or 16-bit steps; for floats, half
    /// float steps at the value).
    fn differences(&self, other: &Pixels) -> (usize, f32) {
        let mut count = 0;
        let mut worst = 0.0f32;
        let mut note = |d: f32| {
            if d != 0.0 {
                count += 1;
                worst = worst.max(d);
            }
        };
        match (self, other) {
            (Pixels::U8(a), Pixels::U8(b)) => a.iter().zip(b).for_each(|(x, y)| note(f32::from(x.abs_diff(*y)))),
            (Pixels::U16(a), Pixels::U16(b)) => a.iter().zip(b).for_each(|(x, y)| note(f32::from(x.abs_diff(*y)))),
            (Pixels::F32(a), Pixels::F32(b)) => a.iter().zip(b).for_each(|(x, y)| {
                if x.to_bits() != y.to_bits() {
                    let step = lopsy_core::half::f16_to_f32(lopsy_core::half::f32_to_f16(x.abs().max(6.1e-5))) / 1024.0;
                    note(((x - y).abs() / step).max(f32::MIN_POSITIVE));
                }
            }),
            _ => panic!("different kinds of pixels"),
        }
        (count, worst)
    }
}

fn read_export(engine: &mut EngineInner, export: Export) -> Pixels {
    match export {
        Export::Eight => Pixels::U8(now(compositor::composite_for_export(engine))),
        Export::Sixteen => {
            Pixels::U16(now(compositor::composite_for_export_u16_to(engine, lopsy_core::output::OutputTarget::Srgb)))
        }
        Export::Hdr => Pixels::F32(now(commands::develop::read_hdr_output_f32(engine, 4.0))),
    }
}

/// A set of develop settings, in whole-picture coordinates, applied to the
/// whole picture's engine and to the tiles' alike.
struct Settings {
    name: &'static str,
    set: fn(&mut EngineInner),
}

/// The RAW develop stage, and the working space when `ws`.
fn develop(engine: &mut EngineInner, ws: bool) {
    commands::develop::set_raw_develop(engine, develop_settings()).expect("develop");
    commands::develop::set_develop_working_space(engine, ws, 0).expect("working space");
}

/// A rotated, inverted radial area and a linear one, with every built-in
/// slider moved, in a picture `w`×`h`.
fn areas(w: f32, h: f32) -> Vec<f32> {
    vec![
        1.0, 1.0, 0.9, 0.55 * w, 0.45 * h, 0.3 * w, 0.2 * h, 0.7, 0.5, 0.6, 30.0, -40.0, 35.0, 25.0, -15.0, 20.0, //
        0.0, 0.0, 1.0, 0.1 * w, 0.2 * h, 0.8 * w, 0.9 * h, 0.0, 0.0, -0.4, 20.0, 30.0, -25.0, -30.0, 20.0, -15.0,
    ]
}

/// Tone, look and curves: everything per pixel with no position.
fn per_pixel(e: &mut EngineInner) {
    commands::develop::set_develop_tone(e, &[0.3, 0.0, 0.0, 25.0, -40.0, 30.0, 15.0, -10.0]).expect("tone");
    let mut look = [0.0f32; 44];
    look[0] = 20.0;
    look[1] = 10.0;
    look[2 + 3] = 30.0;
    look[2 + 24] = 0.3;
    look[2 + 24 + 1] = 0.1;
    commands::develop::set_develop_look(e, &look).expect("look");
    commands::develop::set_image_color_mixer(e, &[10.0; 24]).expect("mixer");
}

/// Per pixel, with positions: the areas, and Finish's vignette and grain.
fn positions(e: &mut EngineInner, w: f32, h: f32, pixel_scale: f32) {
    per_pixel(e);
    commands::develop::set_image_areas(e, &areas(w, h)).expect("areas");
    commands::develop::set_image_finish(e, &[-45.0, 35.0, 30.0, 55.0, 60.0, 50.0, 40.0, 17.0, pixel_scale]).expect("finish");
}

/// Every stage the export chain has, with the areas' layers running their
/// own noise reduction, sharpening, Finish and look, and with `area_local`
/// their own haze and details too; at `pixel_scale`.
fn everything(e: &mut EngineInner, w: f32, h: f32, pixel_scale: f32, area_local: bool) {
    positions(e, w, h, pixel_scale);
    commands::develop::set_image_detail(e, &[60.0, 1.5, 20.0, 50.0, 60.0, 30.0, pixel_scale]).expect("detail");
    commands::develop::set_image_local_contrast(e, &[40.0, 30.0, 25.0, pixel_scale]).expect("local contrast");
    commands::develop::set_image_area_detail(e, 0, &[80.0, 1.0, 0.0, 30.0, 70.0, 20.0, pixel_scale]).expect("area detail");
    commands::develop::set_image_area_finish(e, 1, &[30.0, 50.0, -40.0, 40.0, 40.0, 70.0, 20.0, 5.0, pixel_scale]).expect("area finish");
    let mut area_look = [0.0f32; 45];
    area_look[0] = 20.0;
    area_look[3 + 5] = -40.0;
    commands::develop::set_develop_area_look(e, 1, &area_look).expect("area look");
    commands::develop::set_image_area_tone(e, 1, 20.0, -10.0, 15.0).expect("area tone");
    if area_local {
        commands::develop::set_image_area_local_contrast(e, 0, &[-30.0, 50.0, 40.0, pixel_scale]).expect("area local contrast");
    }
}

const SMALL: (u32, u32) = (720, 640);
const LARGE: (u32, u32) = (1600, 1100);

/// The kept parts' edges on each axis (even, as the gain map's 2×2 blocks
/// want): a 3×3 grid whose middle tile is clear of every picture edge by
/// more than any apron the settings below need, so it has an apron on all
/// four sides; the rest touch an edge or a corner.
fn grid(size: (u32, u32)) -> ([u32; 4], [u32; 4]) {
    match size {
        SMALL => ([0, 240, 480, 720], [0, 212, 428, 640]),
        LARGE => ([0, 480, 1120, 1600], [0, 480, 620, 1100]),
        _ => unreachable!(),
    }
}

/// A tile: the part kept and the document rendered for it (the kept part
/// and `apron` around it, clipped to the picture), in whole pixels.
struct Tile {
    kept: Rect,
    doc: Rect,
}

fn tiles(size: (u32, u32), apron: u32) -> Vec<Tile> {
    let (xs, ys) = grid(size);
    let mut tiles = Vec::new();
    for row in ys.windows(2) {
        for col in xs.windows(2) {
            let kept = Rect::new(col[0] as i32, row[0] as i32, col[1] - col[0], row[1] - row[0]);
            let (x0, y0) = (col[0].saturating_sub(apron), row[0].saturating_sub(apron));
            let (x1, y1) = ((col[1] + apron).min(size.0), (row[1] + apron).min(size.1));
            tiles.push(Tile { kept, doc: Rect::new(x0 as i32, y0 as i32, x1 - x0, y1 - y0) });
        }
    }
    tiles
}

/// Rows of the picture each band the window upload takes.
const BAND_ROWS: u32 = 96;

/// Fill layer `id` of a tile's engine with `doc`'s rectangle of the
/// picture, band by band, as the app's decode delivers it.
fn upload_window(engine: &mut EngineInner, id: &str, pixels: &[f32], size: (u32, u32), doc: Rect) {
    let (w, h) = size;
    let mut y = 0;
    while y < h {
        let rows = BAND_ROWS.min(h - y);
        let band = &pixels[(y * w * 4) as usize..((y + rows) * w * 4) as usize];
        commands::layer::upload_layer_pixels_f32_window(engine, id, doc.x, doc.y, doc.width, doc.height, 0, y as i32, w, rows, band)
            .expect("window upload");
        y += rows;
    }
}

/// The whole picture's exports with `settings`.
fn render_whole(size: (u32, u32), pixels: &[f32], ws: bool, settings: &Settings, exports: &[Export]) -> Option<Vec<Pixels>> {
    let (w, h) = size;
    let mut engine = engine(w, h)?;
    commands::layer::add_layer(&mut engine, &layer_json("raw", 0, 0, w, h)).expect("layer");
    commands::layer::upload_layer_pixels_f32_rect(&mut engine, "raw", w, h, 0, 0, w, h, pixels).expect("pixels");
    develop(&mut engine, ws);
    (settings.set)(&mut engine);
    let out = exports.iter().map(|&e| read_export(&mut engine, e)).collect();
    assert_no_gpu_errors();
    Some(out)
}

/// What the tile loop gives: the assembled exports, the apron the engine
/// reported, and the textures in use before and after the loop.
struct Tiled {
    assembled: Vec<Pixels>,
    reported_apron: u32,
    textures: (usize, usize),
}

/// The exports assembled from tiles with `apron` (`None`: the one the
/// engine reports for `settings`).
fn render_tiled(size: (u32, u32), pixels: &[f32], ws: bool, settings: &Settings, exports: &[Export], apron: Option<u32>) -> Option<Tiled> {
    let (w, h) = size;
    let mut engine = engine(w, h)?;
    commands::layer::add_layer(&mut engine, &layer_json("raw", 0, 0, w, h)).expect("layer");
    develop(&mut engine, ws);
    (settings.set)(&mut engine);
    let reported_apron = commands::develop::develop_apron(&engine);
    let apron = apron.unwrap_or(reported_apron);
    let before = textures_in_use(&engine);
    let mut assembled: Vec<Option<Pixels>> = vec![None; exports.len()];
    for tile in tiles(size, apron) {
        let doc = tile.doc;
        engine.set_document_size(doc.width, doc.height).expect("tile size");
        commands::develop::set_document_region(&mut engine, doc.x as u32, doc.y as u32, w, h).expect("region");
        commands::layer::update_layer(&mut engine, &layer_json("raw", doc.x as u32, doc.y as u32, doc.width, doc.height)).expect("layer");
        upload_window(&mut engine, "raw", pixels, size, doc);
        for (i, &export) in exports.iter().enumerate() {
            let got = read_export(&mut engine, export);
            assert_eq!(got.values(), (doc.width * doc.height * 4) as usize);
            let whole = assembled[i].get_or_insert_with(|| got.blank(w, h));
            got.copy_into(doc.width, (doc.x as u32, doc.y as u32), tile.kept, whole, w);
        }
    }
    engine.set_document_size(w, h).expect("whole size");
    commands::layer::update_layer(&mut engine, &layer_json("raw", 0, 0, w, h)).expect("layer");
    commands::layer::upload_layer_pixels_f32_rect(&mut engine, "raw", w, h, 0, 0, w, h, pixels).expect("pixels");
    let after = textures_in_use(&engine);
    assert_no_gpu_errors();
    Some(Tiled { assembled: assembled.into_iter().map(|p| p.expect("a tile")).collect(), reported_apron, textures: (before, after) })
}

/// Renders `settings` whole and tiled with the reported apron on both
/// chain orders, checks the apron is `apron` (working space on, off) and
/// that every export assembles to the whole's exactly.
fn assert_tiles_match(size: (u32, u32), settings: &Settings, apron: (u32, u32)) {
    let pixels = picture(size.0, size.1);
    for ws in [true, false] {
        let exports: &[Export] = if ws { &[Export::Eight, Export::Sixteen, Export::Hdr] } else { &[Export::Eight, Export::Sixteen] };
        let Some(whole) = render_whole(size, &pixels, ws, settings, exports) else { return };
        let Some(tiled) = render_tiled(size, &pixels, ws, settings, exports, None) else { return };
        let expected_apron = if ws { apron.0 } else { apron.1 };
        let order = if ws { "working space" } else { "no working space" };
        eprintln!("{} ({order}): apron {}", settings.name, tiled.reported_apron);
        assert_eq!(tiled.reported_apron, expected_apron, "{} ({order}): the apron", settings.name);
        let (xs, ys) = grid(size);
        assert!(xs[1] >= tiled.reported_apron && xs[3] - xs[2] >= tiled.reported_apron, "the middle tile has an apron each side");
        assert!(ys[1] >= tiled.reported_apron && ys[3] - ys[2] >= tiled.reported_apron, "the middle tile has an apron each side");
        assert_eq!(tiled.textures.0, tiled.textures.1, "{}: the tile loop gives back every texture", settings.name);
        for ((export, a), b) in exports.iter().zip(&tiled.assembled).zip(&whole) {
            let (count, worst) = a.differences(b);
            eprintln!("  {export:?}: {count} of {} values differ, the largest by {worst}", a.values());
            assert_eq!(count, 0, "{} ({order}), {export:?}: the tiles differ from the whole", settings.name);
        }
    }
}

#[test]
fn per_pixel_stages_need_no_apron_and_tile_exactly() {
    let settings = Settings { name: "per pixel", set: per_pixel };
    assert_tiles_match(SMALL, &settings, (0, 0));
}

#[test]
fn areas_finish_and_the_dither_tile_exactly_at_their_place_in_the_whole() {
    let settings = Settings { name: "areas, vignette, grain, dither", set: |e| positions(e, SMALL.0 as f32, SMALL.1 as f32, 1.0) };
    assert_tiles_match(SMALL, &settings, (0, 0));
}

#[test]
fn noise_reduction_alone_tiles_exactly() {
    // The colour blur (σ 6) goes through the box downscale.
    let settings = Settings { name: "noise reduction", set: |e| commands::develop::set_image_detail(e, &[0.0, 1.0, 0.0, 60.0, 80.0, 30.0, 1.0]).unwrap() };
    assert_tiles_match(SMALL, &settings, (26, 26));
}

#[test]
fn sharpening_alone_tiles_exactly() {
    let settings = Settings { name: "sharpening", set: |e| commands::develop::set_image_detail(e, &[120.0, 3.0, 30.0, 0.0, 0.0, 0.0, 1.0]).unwrap() };
    // σ 3: 9 taps, and the edge mask's gradient one more.
    assert_tiles_match(SMALL, &settings, (10, 10));
}

#[test]
fn large_and_small_details_alone_tile_exactly() {
    let settings = Settings { name: "large and small details", set: |e| commands::develop::set_image_local_contrast(e, &[50.0, 40.0, 0.0, 1.0]).unwrap() };
    assert_tiles_match(SMALL, &settings, (202, 202));
}

#[test]
fn haze_alone_tiles_exactly() {
    // With the working space a pass of its own; without it the local
    // contrast pass, which reads both blurs.
    let settings = Settings { name: "haze", set: |e| commands::develop::set_image_local_contrast(e, &[0.0, 0.0, 45.0, 1.0]).unwrap() };
    assert_tiles_match(SMALL, &settings, (202, 202));
}

#[test]
fn every_stage_at_once_tiles_exactly() {
    let settings = Settings { name: "everything", set: |e| everything(e, LARGE.0 as f32, LARGE.1 as f32, 1.0, false) };
    // On: noise reduction 26, haze 202, details 202, the area layer's noise
    // reduction 26 and sharpening 4 (σ 1), sharpening 6 (σ 1.5). Off: haze
    // is in the details' pass.
    assert_tiles_match(LARGE, &settings, (466, 264));
}

#[test]
fn every_stage_with_the_area_layers_own_haze_and_details_tiles_exactly() {
    let settings = Settings { name: "everything, half scale", set: |e| everything(e, LARGE.0 as f32, LARGE.1 as f32, 0.5, true) };
    // At half scale: noise reduction 9, haze 106, details 106, the area
    // layer's 9 + 106 + 106 and sharpening 3 (σ 0.5), sharpening 4 (σ 0.75).
    assert_tiles_match(LARGE, &settings, (449, 237));
}

#[test]
fn an_apron_too_small_for_the_neighbourhood_stages_shows() {
    let pixels = picture(SMALL.0, SMALL.1);
    let settings = Settings { name: "large and small details", set: |e| commands::develop::set_image_local_contrast(e, &[50.0, 40.0, 0.0, 1.0]).unwrap() };
    for ws in [true, false] {
        let Some(whole) = render_whole(SMALL, &pixels, ws, &settings, &[Export::Sixteen]) else { return };
        let Some(tiled) = render_tiled(SMALL, &pixels, ws, &settings, &[Export::Sixteen], Some(8)) else { return };
        let (count, worst) = tiled.assembled[0].differences(&whole[0]);
        eprintln!("an apron of 8 (working space {ws}): {count} values differ, the largest by {worst} steps");
        assert!(count > 1000 && worst > 16.0, "an apron of 8 must not pass for one of {}", tiled.reported_apron);
    }
}

/// A small RAW document with every stage on, for the checks of what a
/// region does to the arithmetic without tiles.
fn small_document(w: u32, h: u32) -> Option<(EngineInner, Vec<f32>)> {
    let mut engine = engine(w, h)?;
    let pixels = picture(w, h);
    commands::layer::add_layer(&mut engine, &layer_json("raw", 0, 0, w, h)).expect("layer");
    commands::layer::upload_layer_pixels_f32_rect(&mut engine, "raw", w, h, 0, 0, w, h, &pixels).expect("pixels");
    develop(&mut engine, true);
    everything(&mut engine, w as f32, h as f32, 1.0, true);
    Some((engine, pixels))
}

fn all_exports(engine: &mut EngineInner) -> Vec<Pixels> {
    [Export::Eight, Export::Sixteen, Export::Hdr].iter().map(|&e| read_export(engine, e)).collect()
}

#[test]
fn a_region_set_and_cleared_leaves_every_export_as_it_was() {
    let (w, h) = (160, 120);
    let Some((mut engine, _)) = small_document(w, h) else { return };
    let never = all_exports(&mut engine);
    let png = now(compositor::export_png_16(&mut engine, 0));
    commands::develop::set_document_region(&mut engine, 30, 20, 400, 300).expect("region");
    let moved = all_exports(&mut engine);
    assert_ne!(moved, never, "a region moves the layer and the masks");
    commands::develop::clear_document_region(&mut engine);
    assert_eq!(all_exports(&mut engine), never);
    assert_eq!(now(compositor::export_png_16(&mut engine, 0)), png);
    // A new document size clears it too.
    commands::develop::set_document_region(&mut engine, 30, 20, 400, 300).expect("region");
    engine.set_document_size(w, h).expect("size");
    assert!(engine.document_region.is_none());
    assert_eq!(all_exports(&mut engine), never);
    assert_no_gpu_errors();
}

#[test]
fn a_region_that_is_the_whole_picture_renders_as_none() {
    // The region's arithmetic, with nothing to move: every blur on the
    // whole's grid, every position plus 0.
    let (w, h) = (160, 120);
    let Some((mut engine, _)) = small_document(w, h) else { return };
    let never = all_exports(&mut engine);
    commands::develop::set_document_region(&mut engine, 0, 0, w, h).expect("region");
    assert_eq!(all_exports(&mut engine), never);
    assert_no_gpu_errors();
}

#[test]
fn a_region_must_hold_the_document() {
    let Some((mut engine, _)) = small_document(64, 48) else { return };
    assert!(commands::develop::set_document_region(&mut engine, 10, 0, 70, 48).is_err());
    assert!(commands::develop::set_document_region(&mut engine, 0, 0, 0, 0).is_err());
    assert!(engine.document_region.is_none(), "a refused region changes nothing");
    commands::develop::set_document_region(&mut engine, 6, 0, 70, 48).expect("region");
    assert!(commands::develop::set_document_region(&mut engine, 7, 0, 70, 48).is_err());
    assert_eq!(engine.document_region.map(|r| r.x), Some(6), "a refused region keeps the one there");
}

/// The layer texture of `id`, read as floats.
fn layer_floats(engine: &EngineInner, id: &str) -> (Vec<f32>, (u32, u32)) {
    let texture = engine.layer_textures[id];
    let (w, h) = engine.texture_pool.get_size(texture).expect("size");
    (now(engine.gpu().read_rgba_f32(texture, 0, 0, w, h)), (w, h))
}

fn crop(pixels: &[f32], width: u32, rect: Rect) -> Vec<f32> {
    (rect.y as u32..rect.y as u32 + rect.height)
        .flat_map(|y| {
            let at = ((y * width + rect.x as u32) * 4) as usize;
            pixels[at..at + rect.width as usize * 4].to_vec()
        })
        .collect()
}

#[test]
fn a_window_upload_is_the_crop_of_the_whole_upload() {
    let (fw, fh) = (37u32, 29u32);
    let Some(mut engine) = engine(fw, fh) else { return };
    let frame: Vec<f32> = picture(fw, fh).iter().map(|v| lopsy_core::half::f16_to_f32(lopsy_core::half::f32_to_f16(*v))).collect();
    // Orientations 1 to 4 deliver full-width rows, 5 to 8 full-height columns.
    let rows: Vec<Rect> = (0..fh).step_by(6).map(|y| Rect::new(0, y as i32, fw, 6.min(fh - y))).collect();
    let columns: Vec<Rect> = (0..fw).step_by(5).map(|x| Rect::new(x as i32, 0, 5.min(fw - x), fh)).collect();
    let windows = [Rect::new(0, 0, fw, fh), Rect::new(3, 4, 20, 11), Rect::new(17, 13, 20, 16), Rect::new(0, 23, 9, 6), Rect::new(36, 0, 1, 29)];
    commands::layer::add_layer(&mut engine, &layer_json("w", 0, 0, fw, fh)).expect("layer");
    for (kind, bands) in [("rows", &rows), ("columns", &columns)] {
        for &window in &windows {
            for &band in bands.iter() {
                let data = crop(&frame, fw, band);
                commands::layer::upload_layer_pixels_f32_window(
                    &mut engine, "w", window.x, window.y, window.width, window.height, band.x, band.y, band.width, band.height, &data,
                )
                .expect("upload");
            }
            let (got, size) = layer_floats(&engine, "w");
            assert_eq!(size, (window.width, window.height), "{kind}: the texture is the window");
            assert_eq!(got, crop(&frame, fw, window), "{kind}, window {window:?}");
        }
    }
    // A band that misses the window changes nothing and is no error.
    let window = Rect::new(3, 4, 20, 11);
    for band in [Rect::new(0, 15, fw, 6), Rect::new(23, 0, 5, fh), Rect::new(0, 0, fw, 4)] {
        let before = layer_floats(&engine, "w");
        let data = vec![9.0f32; (band.width * band.height * 4) as usize];
        commands::layer::upload_layer_pixels_f32_window(
            &mut engine, "w", window.x, window.y, window.width, window.height, band.x, band.y, band.width, band.height, &data,
        )
        .expect("a band outside the window");
        assert_eq!(layer_floats(&engine, "w"), before, "band {band:?}");
    }
    // A band whose data is the wrong length is refused.
    assert!(commands::layer::upload_layer_pixels_f32_window(&mut engine, "w", 0, 0, 4, 4, 0, 0, 4, 2, &[0.0; 12]).is_err());
    assert_no_gpu_errors();
}

/// Runs an `async fn` command to its result, polling while it waits for a
/// read as the hosts do.
fn run<T>(engine: &mut EngineInner, mut task: lopsy_engine::task::Task<T>) -> T {
    loop {
        if let Poll::Ready(value) = task.poll(engine) {
            return value;
        }
        std::thread::yield_now();
    }
}

/// The files the encoders that take whole pictures make: the 16-bit PNG
/// (sRGB) and TIFF (Display P3), the PQ PNG, and the gain map's pixels and
/// numbers over the 8-bit export.
#[derive(PartialEq)]
struct Files {
    png: Vec<u8>,
    tiff: Vec<u8>,
    pq: Vec<u8>,
    gain_map: (u32, u32, Vec<u8>, [f64; 7]),
}

impl std::fmt::Debug for Files {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "PNG {} bytes, TIFF {}, PQ PNG {}, gain map {}×{}", self.png.len(), self.tiff.len(), self.pq.len(), self.gain_map.0, self.gain_map.1)
    }
}

fn gain_map_of(map: lopsy_core::gain_map::GainMap) -> (u32, u32, Vec<u8>, [f64; 7]) {
    (map.width, map.height, map.rgba, map.metadata.to_values())
}

#[test]
fn files_encoded_from_assembled_tiles_are_the_whole_pictures_files() {
    use lopsy_core::color::ColorSpace;
    use lopsy_core::gain_map::{compute_gain_map, GainMapScale};
    let size = LARGE;
    let (w, h) = size;
    let pixels = picture(w, h);
    let settings = Settings { name: "everything", set: |e| everything(e, LARGE.0 as f32, LARGE.1 as f32, 1.0, false) };
    let half = GainMapScale::from_divisor(2).expect("scale");

    let Some(mut whole) = engine(w, h) else { return };
    commands::layer::add_layer(&mut whole, &layer_json("raw", 0, 0, w, h)).expect("layer");
    commands::layer::upload_layer_pixels_f32_rect(&mut whole, "raw", w, h, 0, 0, w, h, &pixels).expect("pixels");
    develop(&mut whole, true);
    (settings.set)(&mut whole);
    let hdr = now(commands::develop::read_hdr_output_f32(&mut whole, 4.0));
    let sdr = now(compositor::composite_for_export(&mut whole));
    let expected = Files {
        png: now(compositor::export_png_16(&mut whole, 0)),
        tiff: now(compositor::export_tiff_16(&mut whole, 1)),
        pq: lopsy_core::hdr_png::encode_pq_png(&hdr, w, h, 203.0).expect("PQ PNG"),
        gain_map: gain_map_of(compute_gain_map(&hdr, &sdr, w, h, ColorSpace::Srgb, half).expect("gain map")),
    };
    drop(whole);

    let Some(mut engine) = engine(w, h) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("raw", 0, 0, w, h)).expect("layer");
    develop(&mut engine, true);
    (settings.set)(&mut engine);
    let apron = commands::develop::develop_apron(&engine);
    let before = textures_in_use(&engine);
    // (kind, value) as `begin_export_assembly` takes them: 16-bit sRGB, then Display P3, HDR at 4, 8-bit.
    let passes: [&[(u8, f32)]; 2] = [&[(0, 0.0), (1, 4.0), (2, 0.0)], &[(0, 1.0), (1, 4.0)]];
    let mut files = Vec::new();
    let mut gain_map = None;
    for kinds in passes {
        for &(kind, value) in kinds {
            commands::develop::begin_export_assembly(&mut engine, kind, value, w, h).expect("assembly");
        }
        for tile in tiles(size, apron) {
            let doc = tile.doc;
            engine.set_document_size(doc.width, doc.height).expect("tile size");
            commands::develop::set_document_region(&mut engine, doc.x as u32, doc.y as u32, w, h).expect("region");
            commands::layer::update_layer(&mut engine, &layer_json("raw", doc.x as u32, doc.y as u32, doc.width, doc.height)).expect("layer");
            upload_window(&mut engine, "raw", &pixels, size, doc);
            for &(kind, value) in kinds {
                let k = tile.kept;
                let task = lopsy_engine::task::Task::new(move |cx| commands::develop::assemble_export_tile(cx, kind, value, k.x, k.y, k.width, k.height));
                run(&mut engine, task).expect("a tile's kept part");
            }
        }
        if kinds.len() == 3 {
            // The 16-bit PNG in sRGB, and the gain map (HDR over 8-bit).
            files.push(commands::develop::encode_export_assembly(&mut engine, 0, 0.0).expect("PNG"));
            gain_map = Some(gain_map_of(commands::develop::export_assembly_gain_map(&mut engine, ColorSpace::Srgb, half).expect("gain map")));
        } else {
            // The TIFF in Display P3, and the PQ PNG.
            files.push(commands::develop::encode_export_assembly(&mut engine, 1, 0.0).expect("TIFF"));
            files.push(commands::develop::encode_export_assembly(&mut engine, 2, 203.0).expect("PQ PNG"));
        }
    }
    commands::develop::clear_document_region(&mut engine);
    let got = Files { png: files[0].clone(), tiff: files[1].clone(), pq: files[2].clone(), gain_map: gain_map.expect("a gain map") };
    assert!(got.gain_map == expected.gain_map, "the gain map of the assembled pictures is the whole's");
    assert!(got.png == expected.png, "16-bit PNG: {got:?} against {expected:?}");
    assert!(got.tiff == expected.tiff, "TIFF: {got:?} against {expected:?}");
    assert!(got.pq == expected.pq, "PQ PNG: {got:?} against {expected:?}");
    // The assembly holds nothing once encoded, and a picture with a part missing is never encoded.
    assert!(commands::develop::encode_export_assembly(&mut engine, 0, 0.0).is_err());
    commands::develop::begin_export_assembly(&mut engine, 0, 0.0, w, h).expect("assembly");
    assert!(commands::develop::encode_export_assembly(&mut engine, 0, 0.0).is_err(), "no part written");
    commands::develop::clear_export_assembly(&mut engine);
    engine.set_document_size(w, h).expect("whole size");
    assert_eq!(textures_in_use(&engine), before, "the assembly gives back every texture");
    assert_no_gpu_errors();
}

#[test]
fn a_kept_part_outside_the_tile_or_the_picture_is_refused() {
    let Some((mut engine, _)) = small_document(64, 48) else { return };
    commands::develop::begin_export_assembly(&mut engine, 0, 0.0, 200, 100).expect("assembly");
    engine.set_document_size(64, 48).expect("size");
    commands::develop::set_document_region(&mut engine, 100, 50, 200, 100).expect("region");
    let assemble = |engine: &mut EngineInner, x: i32, y: i32| {
        run(engine, lopsy_engine::task::Task::new(move |cx| commands::develop::assemble_export_tile(cx, 0, 0.0, x, y, 20, 20)))
    };
    assert!(assemble(&mut engine, 100, 50).is_ok());
    assert!(assemble(&mut engine, 100, 50).is_err(), "a part written twice");
    assert!(assemble(&mut engine, 99, 60).is_err(), "a part that starts before the tile");
    assert!(assemble(&mut engine, 150, 80).is_err(), "a part that leaves the tile");
    commands::develop::set_document_region(&mut engine, 0, 0, 300, 100).expect("another whole");
    assert!(assemble(&mut engine, 0, 0).is_err(), "a tile of another picture");
    commands::develop::clear_export_assembly(&mut engine);
    assert!(assemble(&mut engine, 0, 0).is_err(), "nothing being assembled");
}

#[test]
fn showing_a_region_on_the_screen_changes_no_export() {
    // The flag only moves the final blit, which no export reads.
    let (w, h) = (160, 120);
    let Some((mut engine, _)) = small_document(w, h) else { return };
    commands::develop::set_document_region(&mut engine, 30, 20, 400, 300).expect("region");
    let as_tile = all_exports(&mut engine);
    commands::develop::set_screen_region(&mut engine, true);
    assert_eq!(all_exports(&mut engine), as_tile);
    commands::develop::set_screen_region(&mut engine, false);
    commands::develop::clear_document_region(&mut engine);
    commands::develop::set_screen_region(&mut engine, true);
    let unset = all_exports(&mut engine);
    commands::develop::set_screen_region(&mut engine, false);
    assert_eq!(all_exports(&mut engine), unset, "without a region the flag changes nothing");
    assert_no_gpu_errors();
}
