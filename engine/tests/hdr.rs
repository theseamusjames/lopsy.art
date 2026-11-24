//! The HDR output step and the HDR reads on a real GPU, with no browser:
//! `cargo test -p lopsy-engine --features native --test hdr`.
//!
//! The headless context has no canvas, so nothing here shows what a
//! browser's HDR canvas displays: these test the output step's maths on
//! textures (against `lopsy_core::output`), the choice the live frame makes
//! between the HDR and SDR outputs, and the float read the HDR encoders
//! take, through the encoders. A machine with no GPU adapter skips them.

use std::cell::RefCell;
use std::future::Future;
use std::task::{Context, Poll, Waker};

use lopsy_core::output::{decode, OutputSettings, OutputTarget};
use lopsy_core::working_space::{luma, Gamut};
use lopsy_engine::engine::EngineInner;
use lopsy_engine::gpu::context::GpuContext;
use lopsy_engine::gpu::pass::Target;
use lopsy_engine::gpu::read::Read;
use lopsy_engine::gpu::shader::ShaderPrograms;
use lopsy_engine::gpu::texture_pool::TextureHandle;
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

fn engine(width: u32, height: u32) -> Option<EngineInner> {
    host::install(host::Host { log: record, now_ms: || 0.0, gpu_lost: |_| {} });
    ERRORS.with_borrow_mut(Vec::clear);
    let ctx = match block_on(GpuContext::headless()) {
        Ok(ctx) => ctx,
        Err(reason) => {
            eprintln!("skipped: no GPU for an HDR test ({reason})");
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

fn layer_json(id: &str, width: u32, height: u32) -> String {
    format!(
        r#"{{"id":"{id}","name":"{id}","layer_type":"Raster","visible":true,"locked":false,
            "opacity":1,"blend_mode":"Normal","x":0,"y":0,"width":{width},"height":{height},
            "clip_to_below":false,"mask":null}}"#
    )
}

/// The develop settings `tests/render.rs` uses: a base curve with its
/// shoulder above 1, so rendered values reach above white.
fn develop_settings() -> lopsy_core::raf::develop::RawDevelopSettings {
    use lopsy_core::raf::{base_curves, develop};
    develop::RawDevelopSettings {
        wb_ratio: [1.0, 1.0, 1.0],
        cam_to_rgb: [1.71, -0.62, -0.09, -0.21, 1.48, -0.27, 0.04, -0.47, 1.43],
        exposure_ev: develop::baseline_exposure_ev(),
        saturation: 1.2,
        highlight_desaturation: true,
        base_curve: Some(base_curves::curve_lut(base_curves::curve_for_film_mode(None)).to_vec()),
    }
}

/// `rgba` (straight RGBA f32, 16 wide) as a float texture.
fn float_texture(engine: &mut EngineInner, rgba: &[f32]) -> TextureHandle {
    let height = (rgba.len() / 64) as u32;
    let handle = engine.texture_pool.acquire(16, height).expect("texture");
    engine.texture_pool.upload_rgba_f32(handle, 0, 0, 16, height, rgba).expect("upload");
    handle
}

fn floats(engine: &EngineInner, handle: TextureHandle) -> Vec<f32> {
    let (w, h) = engine.texture_pool.get_size(handle).expect("size");
    now(engine.gpu().read_rgba_f32(handle, 0, 0, w, h))
}

/// The output step on the GPU over `rendered` (16 wide), and the values the
/// texture fed it (`rendered` as half floats).
fn gpu_output(engine: &mut EngineInner, rendered: &[f32], settings: &OutputSettings) -> (Vec<f32>, Vec<f32>) {
    let program = engine.shaders.output().expect("compiles");
    let src = float_texture(engine, rendered);
    let dst = engine.texture_pool.acquire(16, (rendered.len() / 64) as u32).expect("texture");
    assert!(lopsy_engine::develop::output::pass(engine, &program, src, settings).draw(Target::Texture(dst)));
    let fed = floats(engine, src);
    let out = floats(engine, dst);
    engine.texture_pool.release(src);
    engine.texture_pool.release(dst);
    (out, fed)
}

/// Every value of `gpu` within `ulps` half-float units in the last place
/// of `expected` (relative, with a floor near 0).
fn assert_within_halves(what: &str, gpu: &[f32], expected: &[f32], ulps: f32) {
    assert_eq!(gpu.len(), expected.len(), "{what}");
    let mut worst = 0.0f32;
    for (i, (&g, &e)) in gpu.iter().zip(expected).enumerate() {
        let ulp = e.abs().max(1.0 / 64.0) / 1024.0;
        let off = (g - e).abs() / ulp;
        worst = worst.max(off);
        assert!(off <= ulps, "{what}: value {i} (pixel {}, channel {}) is {g}, the reference {e}: {off:.1} ulps", i / 4, i % 4);
    }
    eprintln!("{what}: worst {worst:.2} half-float ulps");
}

/// Rendered values that test every branch: a grey ramp past the peak,
/// saturated colours inside and outside every target, negatives, alpha.
fn picture() -> Vec<f32> {
    let mut px = Vec::new();
    for i in 0..32 {
        let v = i as f32 / 31.0 * 6.0;
        px.extend_from_slice(&[v, v, v, 1.0]);
    }
    let colours: [[f32; 3]; 16] = [
        [0.4, 0.3, 0.25], [0.8, 0.1, 0.05], [0.05, 0.6, 0.1], [0.1, 0.15, 0.9],
        [0.0, 0.5, 0.0], [0.6, 0.0, 0.6], [1.6, 0.9, 0.2], [3.0, 2.5, 0.1],
        [0.02, 0.01, 0.4], [-0.05, 0.3, 0.2], [0.9, -0.1, -0.02], [6.0, 1.0, 0.3],
        [0.0, 0.0, 0.0], [5.0, 0.2, 0.2], [2.4, 2.6, 3.9], [0.7, 0.7, 1.4],
    ];
    for (k, c) in colours.iter().enumerate() {
        px.extend_from_slice(&[c[0], c[1], c[2], if k % 3 == 0 { 0.5 } else { 1.0 }]);
    }
    px
}

const HDR_TARGETS: [OutputTarget; 3] = [OutputTarget::ExtendedSrgb, OutputTarget::ExtendedDisplayP3, OutputTarget::LinearRec2020];

/// The SDR target an HDR one shares its primaries with.
fn sdr_twin(target: OutputTarget) -> OutputTarget {
    match target {
        OutputTarget::ExtendedSrgb => OutputTarget::Srgb,
        OutputTarget::ExtendedDisplayP3 => OutputTarget::DisplayP3,
        _ => OutputTarget::Rec2020,
    }
}

#[test]
fn the_hdr_output_matches_its_cpu_reference_for_every_target() {
    let Some(mut engine) = engine(4, 4) else { return };
    let rendered = picture();
    for target in HDR_TARGETS {
        for (source, peak) in [(Gamut::Rec2020, 4.0), (Gamut::Srgb, 4.0), (Gamut::Rec2020, 2.0), (Gamut::Rec2020, 1.0)] {
            let s = OutputSettings::hdr(target, source, peak);
            let (got, fed) = gpu_output(&mut engine, &rendered, &s);
            let expected = lopsy_core::output::output_reference(&fed, 16, &s);
            assert!(got.iter().any(|&v| v > 1.01) || peak == 1.0, "{target:?}: nothing above white");
            assert_within_halves(&format!("HDR output to {target:?} from {source:?}, peak {peak}"), &got, &expected, 4.0);
        }
    }
    assert_no_gpu_errors();
}

#[test]
fn a_scene_ramp_through_tone_and_each_hdr_output_matches_sdr_below_white_and_rises_to_the_peak() {
    let Some(mut engine) = engine(4, 4) else { return };
    commands::develop::set_raw_develop_json(&mut engine, &serde_json::to_string(&develop_settings()).unwrap()).expect("develop");
    // Scene luminance 0..16, densest at the bottom, grey then warm.
    let n = 256;
    let lum: Vec<f32> = (0..n).map(|i| { let t = i as f32 / (n - 1) as f32; 16.0 * t * t * t }).collect();
    let mut scene = Vec::new();
    for &l in &lum {
        scene.extend_from_slice(&[l, l, l, 1.0]);
    }
    for &l in &lum {
        scene.extend_from_slice(&[1.3 * l, 0.9 * l, 0.6 * l, 1.0]);
    }
    let program = engine.shaders.tone().expect("compiles");
    let src = float_texture(&mut engine, &scene);
    let toned = engine.texture_pool.acquire(16, (scene.len() / 64) as u32).expect("texture");
    let state = engine.raw_develop.as_ref().expect("state");
    let (pass, _) = lopsy_engine::develop::tone::pass(&engine, &program, src, state);
    assert!(pass.draw(Target::Texture(toned)));
    let rendered = floats(&engine, toned);
    let w2020 = luma(Gamut::Rec2020);
    let y2020 = |p: &[f32]| w2020[0] * p[0] + w2020[1] * p[1] + w2020[2] * p[2];
    let peak = 4.0;
    for target in HDR_TARGETS {
        let (hdr, _) = gpu_output(&mut engine, &rendered, &OutputSettings::hdr(target, Gamut::Rec2020, peak));
        let (sdr, _) = gpu_output(&mut engine, &rendered, &OutputSettings::sdr(sdr_twin(target), Gamut::Rec2020, false));
        let wt = luma(target.gamut());
        let lin = |out: &[f32], t: OutputTarget, i: usize| [0, 1, 2].map(|c| decode(out[i * 4 + c], t.transfer()));
        for (name, start) in [("grey", 0), ("warm", n)] {
            let mut last = -1.0f32;
            let mut above_white = 0;
            for i in start..start + n {
                let r = y2020(&rendered[i * 4..i * 4 + 3]);
                let h = lin(&hdr, target, i);
                let yh = wt[0] * h[0] + wt[1] * h[1] + wt[2] * h[2];
                assert!(h.iter().all(|&v| v <= peak * (1.0 + 1e-3)), "{target:?} {name} at scene {}: {h:?} above the peak", lum[i - start]);
                if name == "grey" {
                    let spread = h[0].max(h[1]).max(h[2]) - h[0].min(h[1]).min(h[2]);
                    assert!(spread <= 2e-3 * h[0].max(1.0 / 64.0), "{target:?}: grey at scene {} came out {h:?}", lum[i - start]);
                }
                if r <= 1.0 && name == "grey" {
                    // Below the knee (white) the two renderings are the same
                    // pixel: within the half-float rounding of the stores.
                    let d = lin(&sdr, sdr_twin(target), i);
                    for c in 0..3 {
                        assert!((h[c] - d[c]).abs() <= 3e-3 * d[c].max(1.0 / 64.0), "{target:?} {name} at scene {}: HDR {h:?}, SDR {d:?}", lum[i - start]);
                    }
                }
                if r > 1.0 {
                    above_white += 1;
                    assert!(yh > 1.0 - 1e-3, "{target:?} {name} at scene {}: rendered {r} is above white, HDR {yh} is not", lum[i - start]);
                }
                assert!(yh >= last - 2e-3 * last.max(1.0 / 64.0), "{target:?} {name}: HDR luminance falls at scene {}: {last} -> {yh}", lum[i - start]);
                if last >= 0.0 {
                    // Continuous: no step larger than the rendered one's,
                    // with room for half-float rounding.
                    let r0 = y2020(&rendered[(i - 1) * 4..(i - 1) * 4 + 3]);
                    assert!(yh - last <= (r - r0).abs() + 4e-3 * yh.max(1.0 / 64.0), "{target:?} {name}: HDR jumps at scene {}: {last} -> {yh} (rendered {r0} -> {r})", lum[i - start]);
                }
                last = yh;
            }
            assert!(above_white > 10, "{target:?} {name}: the ramp hardly passes white");
            assert!(last > 1.5, "{target:?} {name}: the top of the ramp is {last}");
        }
    }
    assert_no_gpu_errors();
}

#[test]
fn a_grey_ramp_stays_grey_in_hdr() {
    let Some(mut engine) = engine(4, 4) else { return };
    let ramp: Vec<f32> = (0..64).flat_map(|i| { let v = i as f32 / 63.0 * 12.0; [v, v, v, 1.0] }).collect();
    for target in HDR_TARGETS {
        let (got, _) = gpu_output(&mut engine, &ramp, &OutputSettings::hdr(target, Gamut::Rec2020, 4.0));
        for (i, p) in got.chunks(4).enumerate() {
            let spread = p[0].max(p[1]).max(p[2]) - p[0].min(p[1]).min(p[2]);
            assert!(spread <= 2e-3 * p[0].max(1.0 / 64.0), "{target:?}: grey {i} came out {p:?}");
        }
    }
    assert_no_gpu_errors();
}

/// A RAW-like document: linear camera RGB whose brightness rises left to
/// right past what the tone step renders as white, and whose colour
/// changes top to bottom, so a flip or a shift between two reads shows.
fn hdr_document(w: u32, h: u32) -> Option<EngineInner> {
    let mut engine = engine(w, h)?;
    commands::layer::add_layer(&mut engine, &layer_json("raw", w, h)).expect("layer");
    let linear: Vec<f32> = (0..w * h)
        .flat_map(|i| {
            let (x, y) = ((i % w) as f32 / (w - 1) as f32, (i / w) as f32 / (h - 1) as f32);
            let l = 0.002 + 6.0 * x * x;
            [l * (0.6 + 0.6 * y), l * 0.8, l * (1.2 - 0.6 * y), 1.0]
        })
        .collect();
    commands::layer::upload_layer_pixels_f32_rect(&mut engine, "raw", w, h, 0, 0, w, h, &linear).expect("pixels");
    commands::develop::set_raw_develop_json(&mut engine, &serde_json::to_string(&develop_settings()).unwrap()).expect("develop");
    commands::develop::set_develop_working_space(&mut engine, true, 0).expect("working space");
    Some(engine)
}

#[test]
fn with_the_hdr_view_off_an_hdr_screen_is_given_the_sdr_rendering() {
    use lopsy_engine::develop::output::{live_settings, live_settings_on, settings_for, screen_target};
    let (w, h) = (32u32, 8u32);
    let Some(mut engine) = hdr_document(w, h) else { return };
    // No canvas: the engine never claims an HDR screen, whatever was asked.
    assert!(!engine.set_screen_output(true, true));
    assert!(!engine.screen_is_hdr());
    let sdr = settings_for(&engine, screen_target(&engine), false, true);
    assert_eq!(live_settings(&engine), sdr, "an SDR surface shows the SDR rendering");
    // The HDR view on: an HDR surface would be given the HDR canvas output.
    assert!(engine.develop_hdr.on, "on by default");
    let on = live_settings_on(&engine, true);
    assert_eq!((on.target, on.peak, on.knee, on.dither), (OutputTarget::ExtendedDisplayP3, 4.0, 1.0, 0.0));
    commands::develop::set_develop_hdr(&mut engine, true, 2.0);
    assert_eq!(live_settings_on(&engine, true).peak, 2.0);
    // Off: the same surface is given exactly the SDR rendering.
    commands::develop::set_develop_hdr(&mut engine, false, 2.0);
    assert!(engine.needs_recomposite);
    assert_eq!(live_settings_on(&engine, true), sdr);

    // And the frame: the composite after a live frame (what the final blit
    // reads) is the rendered image through the SDR output, bit for bit
    // the GPU's.
    compositor::render(&mut engine);
    let frame = now(engine.gpu().read_rgba_f32(engine.composite_texture, 0, 0, w, h));
    let rendered = engine.working_space.and_then(|ws| ws.rendered).expect("rendered");
    let program = engine.shaders.output().expect("compiles");
    let dst = engine.texture_pool.acquire(w, h).expect("texture");
    let settings = live_settings_on(&engine, true);
    assert!(lopsy_engine::develop::output::pass(&engine, &program, rendered, &settings).draw(Target::Texture(dst)));
    assert_eq!(floats(&engine, dst), frame);
    assert!(frame.iter().all(|&v| v <= 1.0), "nothing above white with the view off");
    assert_no_gpu_errors();
}
