//! Render tests for the wgpu backend on a real GPU, with no browser:
//! `cargo test -p lopsy-engine --features native`.
//!
//! They cover what the two graphics APIs do differently and the backend
//! has to make the same: which texel is (0, 0), a viewport that leaves its
//! target, a clear under a scissor, the blend equations, readback of a
//! rect that leaves its texture. Each draws through the same pass layer
//! the engine uses and reads the result back.
//!
//! A machine with no GPU adapter (a CI runner without a software Vulkan)
//! skips them: every test returns early with a note on stderr.

use std::cell::RefCell;
use std::future::Future;
use std::task::{Context, Poll, Waker};

use lopsy_core::geometry::Rect;
use lopsy_engine::engine::EngineInner;
use lopsy_engine::gpu::context::GpuContext;
use lopsy_engine::gpu::params::core::BlitRegionParams;
use lopsy_engine::gpu::pass::{Blend, Scissor, Target};
use lopsy_engine::gpu::read::Read;
use lopsy_engine::gpu::shader::ShaderPrograms;
use lopsy_engine::gpu::texture_pool::TextureHandle;
use lopsy_engine::imaging::adjustments::{self, ImageAdjustmentState, OverWhite};
use lopsy_engine::{commands, document::compositor, host, task};

thread_local! {
    /// Everything the engine logged as an error on this thread: GPU
    /// validation errors arrive here through the device's uncaptured-error
    /// handler. Each test runs on its own thread and drives its engine only
    /// from it, and a native device reports an error from inside the call
    /// that caused it, so one test's errors never reach another's log. A
    /// `RefCell` cannot be poisoned by a failed assertion, as a shared
    /// `Mutex` was, taking every later test down with it.
    static ERRORS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

fn record(level: host::LogLevel, message: &str) {
    if level == host::LogLevel::Error {
        ERRORS.with_borrow_mut(|errors| errors.push(message.to_string()));
    }
}

/// Run a future whose every wait is on the GPU, which a native device
/// answers when polled.
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
    host::install(host::Host { log: record, now_ms: || 0.0, gpu_lost: |_| {} });
    // With `--test-threads=1` the tests share one thread, so a new engine
    // starts with an empty log.
    ERRORS.with_borrow_mut(Vec::clear);
    let ctx = match block_on(GpuContext::headless()) {
        Ok(ctx) => ctx,
        Err(reason) => {
            eprintln!("skipped: no GPU for a render test ({reason})");
            return None;
        }
    };
    let shaders = ShaderPrograms::compile_all(&ctx).expect("shaders compile");
    let mut engine = EngineInner::new(ctx, shaders).expect("engine starts");
    engine.set_document_size(width, height).expect("document size");
    Some(engine)
}

/// A native read is answered by the time it is first polled.
fn now<T: 'static>(read: Read<T>) -> T {
    block_on(read).expect("readback")
}

/// Fails the test if the GPU reported a validation error.
fn assert_no_gpu_errors() {
    let errors = ERRORS.with_borrow(Vec::clone);
    assert!(errors.is_empty(), "the engine logged errors: {errors:#?}");
}

/// A texture holding `texels`, sampled nearest so a 1:1 draw is exact.
fn texture(engine: &mut EngineInner, width: u32, height: u32, texels: &[[u8; 4]]) -> TextureHandle {
    assert_eq!(texels.len(), (width * height) as usize);
    let handle = engine.texture_pool.acquire(width, height).expect("texture");
    engine.texture_pool.set_nearest_filter(handle);
    engine.texture_pool.upload_rgba(handle, 0, 0, width, height, texels.as_flattened()).expect("upload");
    handle
}

/// A `width` by `height` texture whose texel (x, y) is `[x * 10, y * 10, 200, 255]`.
fn coordinates(engine: &mut EngineInner, width: u32, height: u32) -> TextureHandle {
    let texels: Vec<[u8; 4]> =
        (0..height).flat_map(|y| (0..width).map(move |x| [x as u8 * 10, y as u8 * 10, 200, 255])).collect();
    texture(engine, width, height, &texels)
}

fn solid(engine: &mut EngineInner, width: u32, height: u32, color: [u8; 4]) -> TextureHandle {
    texture(engine, width, height, &vec![color; (width * height) as usize])
}

/// The whole of a texture as rows of texels, texel (0, 0) first.
fn texels(engine: &EngineInner, handle: TextureHandle) -> Vec<Vec<[u8; 4]>> {
    let (width, height) = engine.texture_pool.get_size(handle).expect("size");
    let bytes = now(engine.gpu().read_rgba(handle, 0, 0, width, height));
    bytes
        .chunks_exact(width as usize * 4)
        .map(|row| row.chunks_exact(4).map(|t| [t[0], t[1], t[2], t[3]]).collect())
        .collect()
}

const CLEAR: [u8; 4] = [0, 0, 0, 0];
const RED: [u8; 4] = [255, 0, 0, 255];
const GREEN: [u8; 4] = [0, 255, 0, 255];
const BLUE: [u8; 4] = [0, 0, 255, 255];
const WHITE: [u8; 4] = [255, 255, 255, 255];

fn layer_json(id: &str, x: i32, y: i32, width: u32, height: u32, opacity: f32) -> String {
    format!(
        r#"{{"id":"{id}","name":"{id}","layer_type":"Raster","visible":true,"locked":false,
            "opacity":{opacity},"blend_mode":"Normal","x":{x},"y":{y},"width":{width},"height":{height},
            "clip_to_below":false,"mask":null}}"#
    )
}

#[test]
fn eight_bit_pixels_read_back_as_uploaded_with_texel_zero_first() {
    let Some(mut engine) = engine(4, 4) else { return };
    let source = coordinates(&mut engine, 5, 3);
    let read = texels(&engine, source);
    assert_eq!(read[0][0], [0, 0, 200, 255]);
    assert_eq!(read[0][4], [40, 0, 200, 255]);
    assert_eq!(read[2][1], [10, 20, 200, 255]);
    assert_no_gpu_errors();
}

#[test]
fn a_read_that_leaves_the_texture_is_zero_outside_it() {
    let Some(mut engine) = engine(4, 4) else { return };
    let source = solid(&mut engine, 2, 2, RED);
    // 4x4 around the texture, as the eyedropper samples around a corner.
    let bytes = now(engine.gpu().read_rgba(source, -1, -1, 4, 4));
    let rows: Vec<Vec<[u8; 4]>> =
        bytes.chunks_exact(16).map(|row| row.chunks_exact(4).map(|t| [t[0], t[1], t[2], t[3]]).collect()).collect();
    assert_eq!(rows[0], [CLEAR; 4]);
    assert_eq!(rows[1], [CLEAR, RED, RED, CLEAR]);
    assert_eq!(rows[2], [CLEAR, RED, RED, CLEAR]);
    assert_eq!(rows[3], [CLEAR; 4]);
    assert_no_gpu_errors();
}

#[test]
fn a_pass_draws_texel_for_texel_with_uv_zero_at_texel_zero() {
    let Some(mut engine) = engine(4, 4) else { return };
    let source = coordinates(&mut engine, 4, 3);
    let target = engine.texture_pool.acquire(4, 3).unwrap();
    assert!(engine.pass(&engine.shaders.blit, ()).texture("u_tex", source).draw(Target::Texture(target)));
    assert_eq!(texels(&engine, target), texels(&engine, source));
    assert_no_gpu_errors();
}

#[test]
fn a_viewport_inside_the_target_leaves_the_rest_alone() {
    let Some(mut engine) = engine(4, 4) else { return };
    let source = solid(&mut engine, 2, 2, GREEN);
    let target = solid(&mut engine, 4, 4, BLUE);
    engine.pass(&engine.shaders.blit, ()).texture("u_tex", source).viewport(1, 2, 2, 2).draw(Target::Texture(target));
    let read = texels(&engine, target);
    assert_eq!(read[0], [BLUE; 4]);
    assert_eq!(read[1], [BLUE; 4]);
    assert_eq!(read[2], [BLUE, GREEN, GREEN, BLUE]);
    assert_eq!(read[3], [BLUE, GREEN, GREEN, BLUE]);
    assert_no_gpu_errors();
}

#[test]
fn a_viewport_that_leaves_the_target_is_clipped_not_rejected() {
    let Some(mut engine) = engine(4, 4) else { return };
    let source = coordinates(&mut engine, 4, 4);
    let target = solid(&mut engine, 4, 4, BLUE);
    // The source placed two texels left and one down: WebGL clips the
    // viewport to the target, WebGPU would refuse it.
    engine.pass(&engine.shaders.blit, ()).texture("u_tex", source).viewport(-2, 1, 4, 4).draw(Target::Texture(target));
    let read = texels(&engine, target);
    assert_eq!(read[0], [BLUE; 4], "row 0 is above the viewport");
    for y in 1..4usize {
        for x in 0..4usize {
            let expected = if x < 2 { [(x as u8 + 2) * 10, (y as u8 - 1) * 10, 200, 255] } else { BLUE };
            assert_eq!(read[y][x], expected, "texel ({x}, {y})");
        }
    }
    assert_no_gpu_errors();
}

#[test]
fn a_clear_under_a_scissor_clears_only_the_scissor() {
    let Some(mut engine) = engine(4, 4) else { return };
    let source = solid(&mut engine, 4, 4, GREEN);
    let target = solid(&mut engine, 4, 4, BLUE);
    // Clear to red and draw green, both limited to the 2x1 rect: nothing
    // red survives the draw and nothing outside the rect is touched.
    engine
        .pass(&engine.shaders.blit, ())
        .texture("u_tex", source)
        .scissor(Scissor::Rect(Rect::new(1, 2, 2, 1)))
        .clear([1.0, 0.0, 0.0, 1.0])
        .draw(Target::Texture(target));
    let read = texels(&engine, target);
    assert_eq!(read[1], [BLUE; 4]);
    assert_eq!(read[2], [BLUE, GREEN, GREEN, BLUE]);
    assert_eq!(read[3], [BLUE; 4]);

    // With the viewport elsewhere the draw misses the scissor and the
    // clear, which a viewport does not limit, is what shows.
    engine
        .pass(&engine.shaders.blit, ())
        .texture("u_tex", source)
        .viewport(0, 0, 1, 1)
        .scissor(Scissor::Rect(Rect::new(1, 2, 2, 1)))
        .clear([1.0, 0.0, 0.0, 1.0])
        .draw(Target::Texture(target));
    assert_eq!(texels(&engine, target)[2], [BLUE, RED, RED, BLUE]);
    assert_no_gpu_errors();
}

#[test]
fn a_whole_clear_and_a_rect_clear() {
    let Some(mut engine) = engine(4, 4) else { return };
    let target = solid(&mut engine, 3, 3, BLUE);
    assert!(engine.gpu().clear(target, [0.0, 1.0, 0.0, 1.0]));
    assert_eq!(texels(&engine, target), vec![vec![GREEN; 3]; 3]);
    // A rect that hangs off the texture clears the part inside it.
    assert!(engine.gpu().clear_rect(target, Rect::new(2, 1, 5, 1), [1.0, 0.0, 0.0, 1.0]));
    let read = texels(&engine, target);
    assert_eq!(read[0], [GREEN; 3]);
    assert_eq!(read[1], [GREEN, GREEN, RED]);
    assert_eq!(read[2], [GREEN; 3]);
    assert_no_gpu_errors();
}

#[test]
fn a_region_is_copied_to_the_origin_of_another_texture() {
    let Some(mut engine) = engine(4, 4) else { return };
    let source = coordinates(&mut engine, 4, 4);
    let fbo = engine.fbo_pool.create().unwrap();
    engine.fbo_pool.attach_texture(fbo, engine.texture_pool.get(source).unwrap());
    let target = solid(&mut engine, 2, 2, BLUE);
    assert!(engine.gpu().copy_region(fbo, Rect::new(1, 2, 2, 2), target));
    let read = texels(&engine, target);
    assert_eq!(read[0], [[10, 20, 200, 255], [20, 20, 200, 255]]);
    assert_eq!(read[1], [[10, 30, 200, 255], [20, 30, 200, 255]]);
    assert_no_gpu_errors();
}

#[test]
fn the_blend_modes_use_the_webgl_equations() {
    let Some(mut engine) = engine(4, 4) else { return };
    // Premultiplied half-opaque red over opaque blue.
    let source = solid(&mut engine, 2, 2, [128, 0, 0, 128]);

    let over = solid(&mut engine, 2, 2, BLUE);
    engine.pass(&engine.shaders.blit, ()).texture("u_tex", source).blend(Blend::PremulOver).draw(Target::Texture(over));
    let [r, g, b, a] = texels(&engine, over)[0][0];
    assert!((r as i32 - 128).abs() <= 1 && g == 0 && (b as i32 - 127).abs() <= 1 && a == 255, "over: {:?}", [r, g, b, a]);

    let max = solid(&mut engine, 2, 2, [64, 200, 0, 64]);
    engine.pass(&engine.shaders.blit, ()).texture("u_tex", source).blend(Blend::Max).draw(Target::Texture(max));
    assert_eq!(texels(&engine, max)[0][0], [128, 200, 0, 128]);

    // Straight colour laid over by its alpha, the target's alpha kept.
    let keep = solid(&mut engine, 2, 2, [0, 0, 255, 200]);
    let straight = solid(&mut engine, 2, 2, [255, 0, 0, 128]);
    engine.pass(&engine.shaders.blit, ()).texture("u_tex", straight).blend(Blend::OverKeepAlpha).draw(Target::Texture(keep));
    let [r, _, b, a] = texels(&engine, keep)[0][0];
    assert!((r as i32 - 128).abs() <= 1 && (b as i32 - 127).abs() <= 1 && a == 200, "keep alpha: {:?}", [r, b, a]);
    assert_no_gpu_errors();
}

#[test]
fn uniforms_changed_between_draws_reach_the_draw_they_were_set_for() {
    let Some(mut engine) = engine(4, 4) else { return };
    let source = coordinates(&mut engine, 4, 1);
    let target = solid(&mut engine, 4, 1, BLUE);
    // Each draw fills one texel with a different source texel: the first
    // samples the source's last texel, the last its first.
    let pick = |x: u32| BlitRegionParams { scale: [0.0, 0.0], offset: [(x as f32 + 0.5) / 4.0, 0.5] };
    let mut pass = engine
        .pass(&engine.shaders.blit_region, pick(0))
        .texture("u_tex", source)
        .begin(Target::Texture(target))
        .expect("pass begins");
    for x in 0..4u32 {
        pass.set(&pick(3 - x));
        pass.draw_in(Rect::new(x as i32, 0, 1, 1));
    }
    pass.end();
    let read = texels(&engine, target);
    assert_eq!(read[0], [[30, 0, 200, 255], [20, 0, 200, 255], [10, 0, 200, 255], [0, 0, 200, 255]]);
    assert_no_gpu_errors();
}

#[test]
fn more_draws_than_the_uniform_arena_holds_still_all_land() {
    let Some(mut engine) = engine(4, 4) else { return };
    let source = coordinates(&mut engine, 4, 1);
    let target = solid(&mut engine, 4, 1, BLUE);
    let pick = |x: u32| BlitRegionParams { scale: [0.0, 0.0], offset: [(x as f32 + 0.5) / 4.0, 0.5] };
    let mut pass = engine
        .pass(&engine.shaders.blit_region, pick(0))
        .texture("u_tex", source)
        .begin(Target::Texture(target))
        .expect("pass begins");
    // 5,000 draws with a uniform change each: the arena holds about 4,000
    // before the pass has to submit and carry on.
    for i in 0..5000u32 {
        let x = i % 4;
        pass.set(&pick(x));
        pass.draw_in(Rect::new(x as i32, 0, 1, 1));
    }
    pass.end();
    assert_eq!(texels(&engine, target), texels(&engine, source));
    assert_no_gpu_errors();
}

#[test]
fn single_byte_data_goes_up_and_comes_back_through_eight_bit_targets() {
    let Some(mut engine) = engine(4, 4) else { return };
    let bytes: Vec<u8> = (0..15u8).map(|i| i * 17).collect();
    let mask = engine.upload_mask_texture(&bytes, 5, 3).expect("mask texture");
    assert_eq!(now(engine.read_texture_r8(mask, 5, 3)), bytes);
    let rgba = now(engine.read_texture_rgba8(mask, 5, 3));
    assert_eq!(rgba.len(), 5 * 3 * 4);
    assert_eq!(rgba[4 * 7], bytes[7]);
    assert_no_gpu_errors();
}

#[test]
fn the_background_colour_fills_an_empty_document() {
    let Some(mut engine) = engine(6, 4) else { return };
    engine.set_background_color(1.0, 0.0, 0.0, 1.0);
    let pixels = now(compositor::composite_for_export(&mut engine));
    assert_eq!(pixels.len(), 6 * 4 * 4);
    assert!(pixels.chunks_exact(4).all(|p| p == RED));
    assert_no_gpu_errors();
}

#[test]
fn a_layer_composites_at_its_position_and_opacity() {
    let Some(mut engine) = engine(6, 4) else { return };
    engine.set_background_color(1.0, 1.0, 1.0, 1.0);
    commands::layer::add_layer(&mut engine, &layer_json("ink", 1, 2, 3, 1, 0.5)).expect("layer");
    commands::layer::upload_layer_pixels(&mut engine, "ink", &[BLUE; 3].concat(), 3, 1, 0, 0).expect("pixels");
    let pixels = now(compositor::composite_for_export(&mut engine));
    let at = |x: usize, y: usize| -> [u8; 4] { pixels[(y * 6 + x) * 4..][..4].try_into().unwrap() };
    assert_eq!(at(0, 2), WHITE);
    assert_eq!(at(4, 2), WHITE);
    assert_eq!(at(1, 1), WHITE, "the layer is on row 2, counted from the top");
    for x in 1..4 {
        let [r, g, b, a] = at(x, 2);
        assert!((r as i32 - 128).abs() <= 1 && (g as i32 - 128).abs() <= 1 && b == 255 && a == 255, "({x}, 2): {:?}", [r, g, b, a]);
    }
    assert_no_gpu_errors();
}

#[test]
fn a_filter_a_thumbnail_and_content_bounds_agree_on_one_layer() {
    let Some(mut engine) = engine(8, 8) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("art", 0, 0, 8, 8, 1.0)).expect("layer");
    // An opaque 3x2 block at (2, 5) in an otherwise empty layer.
    let mut pixels = vec![CLEAR; 64];
    for y in 5..7 {
        for x in 2..5 {
            pixels[y * 8 + x] = [200, 100, 0, 255];
        }
    }
    commands::layer::upload_layer_pixels(&mut engine, "art", pixels.as_flattened(), 8, 8, 0, 0).expect("pixels");

    let bounds = task::run_now(&mut engine, |cx| commands::layer::get_layer_content_bounds(cx, "art".to_string()));
    assert_eq!(bounds, [2, 5, 3, 2]);

    commands::filter::adjust::filter_invert(&mut engine, "art");
    let inverted = now(commands::layer::read_layer_pixels(&engine, "art"));
    assert_eq!(inverted[(5 * 8 + 2) * 4..][..4], [55, 155, 255, 255]);

    let thumbnail = now(commands::layer::read_layer_thumbnail(&engine, "art", 4));
    assert_eq!(thumbnail[..8], [4, 0, 0, 0, 4, 0, 0, 0]);
    assert_eq!(thumbnail.len(), 8 + 4 * 4 * 4);
    assert_no_gpu_errors();
}

/// 80% grey with one stop of exposure is 1.6. Float textures hold that, but
/// a read clips it, so each case takes the stop off again and reads that.
fn exposed_then_unexposed(engine: &mut EngineInner, over_white: OverWhite, adj: ImageAdjustmentState) -> [u8; 4] {
    let grey = solid(engine, 2, 2, [204, 204, 204, 255]);
    let bright = engine.texture_pool.acquire(2, 2).unwrap();
    let back = engine.texture_pool.acquire(2, 2).unwrap();
    let up = ImageAdjustmentState { exposure: 1.0, ..adj };
    let down = ImageAdjustmentState { exposure: -1.0, ..Default::default() };
    assert!(adjustments::pass(engine.imaging(), grey, &up, 0.0, 0, over_white).0.draw(Target::Texture(bright)));
    assert!(adjustments::pass(engine.imaging(), bright, &down, 0.0, 0, OverWhite::Clipped).0.draw(Target::Texture(back)));
    texels(engine, back)[0][0]
}

#[test]
fn adjustments_keep_what_goes_over_white_only_when_asked() {
    let Some(mut engine) = engine(4, 4) else { return };
    let plain = ImageAdjustmentState::default;

    // Clipped at white, then halved: 50% grey.
    assert_eq!(exposed_then_unexposed(&mut engine, OverWhite::Clipped, plain()), [128, 128, 128, 255]);
    // Kept at 1.6, then halved: the 80% grey it started as.
    assert_eq!(exposed_then_unexposed(&mut engine, OverWhite::Kept, plain()), [204, 204, 204, 255]);
    // An adjustment that rebuilds the colour clips even when asked to keep:
    // inverted white is black, and the excess is not added to it.
    let inverted = ImageAdjustmentState { invert: true, ..plain() };
    assert_eq!(exposed_then_unexposed(&mut engine, OverWhite::Kept, inverted), [0, 0, 0, 255]);
    assert_no_gpu_errors();
}

#[test]
fn bloom_keeps_the_layer_and_adds_a_glow() {
    let Some(mut engine) = engine(16, 16) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("art", 0, 0, 16, 16, 1.0)).expect("layer");
    // A white square on a dark, opaque ground.
    let mut pixels = vec![[20u8, 20, 30, 255]; 256];
    for y in 6..10 {
        for x in 6..10 {
            pixels[y * 16 + x] = WHITE;
        }
    }
    commands::layer::upload_layer_pixels(&mut engine, "art", pixels.as_flattened(), 16, 16, 0, 0).expect("pixels");
    commands::filter::stylize::filter_bloom(&mut engine, "art", 0.5, 0.5, 3, 1.0);
    let bloomed = now(commands::layer::read_layer_pixels(&engine, "art"));
    let at = |x: usize, y: usize| -> [u8; 4] { bloomed[(y * 16 + x) * 4..][..4].try_into().unwrap() };
    assert_eq!(at(7, 7), WHITE, "the bright square stays");
    assert_eq!(at(0, 0)[3], 255, "the ground stays opaque");
    assert!(at(5, 7)[0] > 20, "light spills onto the ground beside the square: {:?}", at(5, 7));
    assert_no_gpu_errors();
}

/// A 16×16 layer of linear camera RGB: smooth ramps, saturated colours and
/// values over white, as `rafRenderLinearBand` produces.
fn linear_camera_rgb(size: u32) -> Vec<f32> {
    (0..size * size)
        .flat_map(|i| {
            let (x, y) = ((i % size) as f32 / (size - 1) as f32, (i / size) as f32 / (size - 1) as f32);
            [x * 1.6, (x * y).sqrt() * 0.9, (1.0 - y) * 0.7 + 0.002, 1.0]
        })
        .collect()
}

/// The develop pass over the composite against
/// `lopsy_core::raf::develop::develop_reference`. Returns the largest
/// difference, in 16-bit steps, on channels both clip to 0..1.
fn develop_on_the_gpu_vs_reference(settings: &lopsy_core::raf::develop::RawDevelopSettings) -> Option<u32> {
    let size = 16u32;
    let mut engine = engine(size, size)?;
    commands::layer::add_layer(&mut engine, &layer_json("raw", 0, 0, size, size, 1.0)).expect("layer");
    let linear = linear_camera_rgb(size);
    commands::layer::upload_layer_pixels_f32_rect(&mut engine, "raw", size, size, 0, 0, size, size, &linear)
        .expect("pixels");
    commands::develop::set_raw_develop_json(&mut engine, &serde_json::to_string(settings).unwrap()).expect("develop");
    let gpu = now(compositor::composite_for_export_u16(&mut engine));
    let expected = lopsy_core::raf::develop::develop_reference(&linear, settings);
    let worst = gpu
        .iter()
        .zip(&expected)
        .map(|(&g, &e)| (g as i64 - (e.clamp(0.0, 1.0) * 65535.0).round() as i64).unsigned_abs() as u32)
        .max()
        .unwrap();
    assert_no_gpu_errors();
    Some(worst)
}

fn develop_settings() -> lopsy_core::raf::develop::RawDevelopSettings {
    use lopsy_core::raf::{base_curves, develop};
    develop::RawDevelopSettings {
        wb_ratio: [1.0, 1.0, 1.0],
        // A neutralized X-Trans cam→sRGB matrix (rows sum to 1).
        cam_to_rgb: [1.71, -0.62, -0.09, -0.21, 1.48, -0.27, 0.04, -0.47, 1.43],
        exposure_ev: develop::baseline_exposure_ev(),
        saturation: 1.2,
        highlight_desaturation: true,
        base_curve: Some(base_curves::curve_lut(base_curves::curve_for_film_mode(None)).to_vec()),
    }
}

#[test]
fn the_raw_develop_stage_matches_its_cpu_reference() {
    // The layer and the composite are half floats, so the inputs carry
    // about 1/2048 of relative error into a gamma-encoded output.
    let Some(worst) = develop_on_the_gpu_vs_reference(&develop_settings()) else { return };
    eprintln!("raw develop, defaults: worst {worst} of 65535");
    assert!(worst <= 160, "worst difference {worst} 16-bit steps");

    let warm = lopsy_core::raf::develop::RawDevelopSettings {
        wb_ratio: [1.15, 1.0, 0.82],
        exposure_ev: develop_settings().exposure_ev - 0.7,
        base_curve: None,
        highlight_desaturation: false,
        ..develop_settings()
    };
    let worst = develop_on_the_gpu_vs_reference(&warm).unwrap();
    eprintln!("raw develop, warm and darker, no curve: worst {worst} of 65535");
    assert!(worst <= 160, "worst difference {worst} 16-bit steps");
}

#[test]
fn without_a_raw_develop_stage_the_composite_is_unchanged() {
    let Some(mut engine) = engine(6, 4) else { return };
    engine.set_background_color(1.0, 1.0, 1.0, 1.0);
    commands::layer::add_layer(&mut engine, &layer_json("ink", 1, 2, 3, 1, 0.5)).expect("layer");
    commands::layer::upload_layer_pixels(&mut engine, "ink", &[BLUE; 3].concat(), 3, 1, 0, 0).expect("pixels");
    let before = now(compositor::composite_for_export(&mut engine));
    commands::develop::set_raw_develop_json(&mut engine, &serde_json::to_string(&develop_settings()).unwrap())
        .expect("develop");
    assert!(engine.needs_recomposite);
    let developed = now(compositor::composite_for_export(&mut engine));
    assert_ne!(before, developed);
    commands::develop::clear_raw_develop(&mut engine);
    assert!(engine.raw_develop.is_none() && engine.needs_recomposite);
    assert_eq!(now(compositor::composite_for_export(&mut engine)), before);
    assert_no_gpu_errors();
}

#[test]
fn the_color_mixer_matches_its_cpu_reference_and_clears() {
    let Some(mut engine) = engine(4, 1) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("art", 0, 0, 4, 1, 1.0)).expect("layer");
    let texels = [[200u8, 60, 40, 255], [60, 160, 70, 255], [50, 80, 200, 255], [128, 128, 128, 255]];
    commands::layer::upload_layer_pixels(&mut engine, "art", texels.as_flattened(), 4, 1, 0, 0).expect("pixels");
    let before = now(compositor::composite_for_export(&mut engine));
    let values: [f32; 24] = std::array::from_fn(|k| [40.0, -60.0, 20.0, 80.0, -30.0, 50.0][k % 6]);
    commands::develop::set_image_color_mixer(&mut engine, &values).expect("mixer");
    let mixed = now(compositor::composite_for_export(&mut engine));
    let input: Vec<f32> = texels.as_flattened().iter().map(|&v| v as f32 / 255.0).collect();
    let expected = lopsy_core::color_mixer::color_mixer_reference(&input, &values);
    for (g, e) in mixed.iter().zip(&expected) {
        assert!((*g as f32 - e * 255.0).abs() <= 1.5, "{mixed:?} vs {expected:?}");
    }
    commands::develop::clear_image_color_mixer(&mut engine);
    assert_eq!(now(compositor::composite_for_export(&mut engine)), before);
    assert_no_gpu_errors();
}

#[test]
fn the_detail_stages_change_the_composite_and_clear_back() {
    let Some(mut engine) = engine(64, 32) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("art", 0, 0, 64, 32, 1.0)).expect("layer");
    let texels: Vec<[u8; 4]> = (0..64 * 32).map(|i| if i % 64 < 32 { [60, 70, 90, 255] } else { [190, 170, 150, 255] }).collect();
    commands::layer::upload_layer_pixels(&mut engine, "art", texels.as_flattened(), 64, 32, 0, 0).expect("pixels");
    let before = now(compositor::composite_for_export(&mut engine));
    commands::develop::set_image_detail(&mut engine, &[100.0, 1.0, 0.0, 50.0, 50.0, 0.0, 1.0]).expect("detail");
    commands::develop::set_image_local_contrast(&mut engine, &[50.0, 50.0, 40.0, 1.0]).expect("local contrast");
    let after = now(compositor::composite_for_export(&mut engine));
    assert_ne!(before, after);
    commands::develop::clear_image_detail(&mut engine);
    commands::develop::clear_image_local_contrast(&mut engine);
    assert_eq!(now(compositor::composite_for_export(&mut engine)), before);
    assert_no_gpu_errors();
}

#[test]
fn areas_change_exports_but_their_overlay_never_does() {
    let Some(mut engine) = engine(16, 8) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("art", 0, 0, 16, 8, 1.0)).expect("layer");
    commands::layer::upload_layer_pixels(&mut engine, "art", &[[100u8, 110, 120, 255]; 128].concat(), 16, 8, 0, 0).expect("pixels");
    let plain = now(compositor::composite_for_export(&mut engine));
    let mut area = [0.0f32; 16];
    area[2] = 1.0;
    area[5] = 16.0;
    area[9] = 1.0;
    commands::develop::set_image_areas(&mut engine, &area).expect("areas");
    let applied = now(compositor::composite_for_export(&mut engine));
    assert_ne!(applied, plain);
    commands::develop::set_image_area_overlay(&mut engine, 0);
    assert_eq!(now(compositor::composite_for_export(&mut engine)), applied);
    commands::develop::clear_image_areas(&mut engine);
    assert_eq!(now(compositor::composite_for_export(&mut engine)), plain);
    assert_no_gpu_errors();
}

#[test]
fn an_areas_layer_grades_inside_its_mask_as_its_reference_says() {
    let Some(mut engine) = engine(16, 8) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("art", 0, 0, 16, 8, 1.0)).expect("layer");
    commands::layer::upload_layer_pixels(&mut engine, "art", &[[100u8, 110, 120, 255]; 128].concat(), 16, 8, 0, 0).expect("pixels");
    let plain = now(compositor::composite_for_export(&mut engine));
    // A linear mask with none of the built-in adjustments: all of its effect at x = 0, none from x = 12.
    let mut area = [0.0f32; 16];
    area[2] = 1.0;
    area[5] = 12.0;
    commands::develop::set_image_areas(&mut engine, &area).expect("areas");
    assert_eq!(now(compositor::composite_for_export(&mut engine)), plain, "an area with nothing set changes nothing");

    // Its layer: a warm global tint, as `compileColorGrade` packs one.
    let mut grade = [0.0f32; 18];
    grade[12] = 0.2;
    grade[14] = -0.2;
    grade[16] = 1.0;
    grade[17] = 0.25;
    commands::develop::set_image_area_color_grading(&mut engine, 0, &grade).expect("grade");
    let graded = now(compositor::composite_for_export(&mut engine));
    let texel = |image: &[u8], x: usize| image[4 * x..4 * x + 4].to_vec();
    assert_ne!(texel(&graded, 0), texel(&plain, 0), "graded where the mask is full");
    assert_eq!(texel(&graded, 13), texel(&plain, 13), "untouched past the mask");

    // The same grade through a mask that covers everything is the layer itself: the reference lays it over
    // the plain image with the first mask as its opacity.
    let mut everywhere = area;
    everywhere[3] = 1000.0;
    everywhere[5] = 2000.0;
    commands::develop::set_image_areas(&mut engine, &everywhere).expect("areas");
    let layer = now(compositor::composite_for_export(&mut engine));
    let floats = |image: &[u8]| image.iter().map(|&v| f32::from(v) / 255.0).collect::<Vec<f32>>();
    let (parsed, _) = lopsy_core::areas::parse_areas(&area).expect("parse");
    let expected = lopsy_core::areas::area_layer_reference(&floats(&plain), &floats(&layer), 16, 8, &parsed[0]);
    for (i, (&got, want)) in graded.iter().zip(expected).enumerate() {
        assert!((f32::from(got) / 255.0 - want).abs() <= 2.0 / 255.0, "byte {i}: {got} against {want}");
    }

    // A layer for a place no area has draws nothing, and clearing them puts the photo back.
    commands::develop::set_image_areas(&mut engine, &area).expect("areas");
    commands::develop::set_image_area_color_grading(&mut engine, 3, &grade).expect("grade");
    assert_eq!(now(compositor::composite_for_export(&mut engine)), graded);
    assert!(commands::develop::set_image_area_color_grading(&mut engine, 8, &grade).is_err());
    commands::develop::clear_image_area_layers(&mut engine);
    assert_eq!(now(compositor::composite_for_export(&mut engine)), plain);
    assert_no_gpu_errors();
}

#[test]
fn an_areas_layer_runs_every_stage_it_was_given_and_leaves_the_documents_settings_alone() {
    let Some(mut engine) = engine(64, 32) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("art", 0, 0, 64, 32, 1.0)).expect("layer");
    // Stripes, so local contrast, sharpening and noise reduction have something to work on.
    let texels: Vec<[u8; 4]> = (0..64 * 32).map(|i| if (i % 64) / 4 % 2 == 0 { [70, 90, 120, 255] } else { [170, 150, 110, 255] }).collect();
    commands::layer::upload_layer_pixels(&mut engine, "art", texels.as_flattened(), 64, 32, 0, 0).expect("pixels");
    // The document's own colour by hue stays on throughout: a layer must not disturb it.
    let mut mixer = [0.0f32; 24];
    mixer[1] = 40.0;
    commands::develop::set_image_color_mixer(&mut engine, &mixer).expect("mixer");
    // A mask over the left half: all of its effect up to x = 16, none from x = 48.
    let mut area = [0.0f32; 16];
    area[2] = 1.0;
    area[3] = 16.0;
    area[5] = 48.0;
    commands::develop::set_image_areas(&mut engine, &area).expect("areas");
    let plain = now(compositor::composite_for_export(&mut engine));
    let column = |image: &[u8], x: usize| image[4 * x..4 * x + 4].to_vec();

    // Each stage alone changes the image under the mask and nothing past it; taken off, the image is back.
    let lut: Vec<u8> = (0..256u32).flat_map(|i| [(255 - i) as u8; 4]).collect();
    let mut area_mixer = [0.0f32; 24];
    area_mixer[16] = -80.0;
    let stages: [(&str, &dyn Fn(&mut EngineInner)); 6] = [
        ("tone", &|e| commands::develop::set_image_area_tone(e, 0, 60.0, -40.0, 50.0).expect("tone")),
        ("curves", &|e| commands::develop::set_image_area_curves_lut(e, 0, &lut).expect("curves")),
        ("colour by hue", &|e| commands::develop::set_image_area_color_mixer(e, 0, &area_mixer).expect("mixer")),
        ("detail", &|e| commands::develop::set_image_area_detail(e, 0, &[120.0, 1.0, 0.0, 60.0, 60.0, 50.0, 1.0]).expect("detail")),
        ("local contrast", &|e| commands::develop::set_image_area_local_contrast(e, 0, &[60.0, 60.0, 30.0, 1.0]).expect("local contrast")),
        ("finish", &|e| commands::develop::set_image_area_finish(e, 0, &[-60.0, 50.0, 0.0, 50.0, 40.0, 25.0, 50.0, 7.0, 1.0]).expect("finish")),
    ];
    for (name, set) in stages {
        set(&mut engine);
        let layered = now(compositor::composite_for_export(&mut engine));
        assert_ne!(layered, plain, "{name} changes the image");
        for x in 48..64 {
            assert_eq!(column(&layered, x), column(&plain, x), "{name} stays inside the mask (column {x})");
        }
        assert_eq!(now(compositor::composite_for_export(&mut engine)), layered, "{name} draws the same twice");
        commands::develop::clear_image_area_layer(&mut engine, 0);
        assert_eq!(now(compositor::composite_for_export(&mut engine)), plain, "{name} taken off puts the image back");
    }

    // All of them at once, then the document's settings are as they were set.
    for (_, set) in stages {
        set(&mut engine);
    }
    assert_ne!(now(compositor::composite_for_export(&mut engine)), plain);
    assert_eq!(engine.color_mixer, Some(mixer));
    assert!(engine.detail.is_none() && engine.local_contrast.is_none() && engine.finish.is_none());
    assert!(!engine.adjustments.has_curves && engine.adjustments.curves_texture.is_none());
    commands::develop::clear_image_areas(&mut engine);
    assert!(engine.area_layers.is_empty());
    assert_no_gpu_errors();
}

#[test]
fn screen_only_views_never_reach_exports() {
    let Some(mut engine) = engine(8, 4) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("art", 0, 0, 8, 4, 1.0)).expect("layer");
    let texels: Vec<[u8; 4]> = (0..32).map(|i| if i % 8 < 4 { [0, 0, 0, 255] } else { WHITE }).collect();
    commands::layer::upload_layer_pixels(&mut engine, "art", texels.as_flattened(), 8, 4, 0, 0).expect("pixels");
    commands::develop::set_image_detail(&mut engine, &[100.0, 1.0, 20.0, 0.0, 0.0, 0.0, 1.0]).expect("detail");
    let before = now(compositor::composite_for_export(&mut engine));
    let before_png = now(compositor::export_png_16(&mut engine, 0));
    let shown = now(commands::develop::read_develop_histogram(&mut engine));
    commands::develop::set_clipping_warning(&mut engine, true, true);
    commands::develop::set_image_detail_mask_view(&mut engine, true);
    assert_ne!(now(commands::develop::read_develop_histogram(&mut engine)), shown, "the live frame shows them");
    assert_eq!(now(compositor::composite_for_export(&mut engine)), before);
    assert_eq!(now(compositor::export_png_16(&mut engine, 0)), before_png);
    assert_no_gpu_errors();
}

#[test]
fn the_develop_histogram_counts_the_displayed_pixels() {
    let Some(mut engine) = engine(8, 4) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("art", 0, 0, 8, 4, 1.0)).expect("layer");
    // Left half red, right half mid grey.
    let pixels: Vec<[u8; 4]> = (0..32).map(|i| if i % 8 < 4 { RED } else { [128, 128, 128, 255] }).collect();
    commands::layer::upload_layer_pixels(&mut engine, "art", pixels.as_flattened(), 8, 4, 0, 0).expect("pixels");
    let h = now(commands::develop::read_develop_histogram(&mut engine));
    assert_eq!(h.len(), 1024);
    assert_eq!((h[255], h[128]), (16, 16), "red channel");
    assert_eq!((h[256], h[256 + 128]), (16, 16), "green channel");
    assert_eq!((h[768 + 54], h[768 + 128]), (16, 16), "luminance");
    assert_no_gpu_errors();
}

// ---------------------------------------------------------------------------
// The develop stages against their CPU references
// ---------------------------------------------------------------------------
//
// Each test below develops one picture through one stage on the GPU and
// through the stage's reference in `lopsy-core`, and compares them in
// 16-bit steps (1/65535).
//
// Every texture is half float, which keeps 11 significant bits: one unit
// in the last place (ulp) is 32 steps for a value in 0.5..1, 16 in
// 0.25..0.5, and so on. The stage's output is stored that way, and so is
// every blur a stage makes, pass by pass, before the combining shader
// reads it. How a GPU rounds when it stores is its own: the Apple GPU these
// were written on rounds toward zero (the comparison below says which
// fits), others to nearest. Fed blurs that are not
// rounded, the reference is off by a bias of up to an ulp per store, which
// the combining shaders multiply by their gain. So the CPU side here
// stores its blurs and its result as the GPU does, both ways, and the
// comparison takes the rounding that fits better. What is left is the
// rounding of values that sit on either side of an ulp boundary after the
// two sides' f32 maths, and the GPU's own `exp`, `pow` and bilinear
// weights; the mean difference is then about a step.

/// How a value is rounded when it is stored in a half-float texture.
#[derive(Clone, Copy, Debug)]
enum HalfRounding {
    Nearest,
    TowardZero,
}

impl HalfRounding {
    fn store(self, values: &mut [f32]) {
        use lopsy_core::half::{f16_to_f32, f32_to_f16};
        for v in values {
            *v = match self {
                Self::Nearest => f16_to_f32(f32_to_f16(*v)),
                // Dropping the 13 low mantissa bits of an f32 is a half's
                // rounding toward zero wherever the half is normal (above
                // 6.1e-5); below that it keeps a little more than a half
                // would, far under a 16-bit step.
                Self::TowardZero => f32::from_bits(v.to_bits() & !0x1fff),
            };
        }
    }
}

/// A `w`×`h` picture that gives every stage something to do: 8-pixel
/// blocks with hard edges in both directions, ramps across and down, a
/// fine texture, per-pixel noise, and a grey ramp from 0 to 1 along the
/// top rows. Opaque, straight RGBA f32.
fn develop_test_picture(w: u32, h: u32) -> Vec<f32> {
    let noise = |x: u32, y: u32, k: u32| lopsy_core::finish::hash(x, y, k) - 0.5;
    (0..w * h)
        .flat_map(|i| {
            let (x, y) = (i % w, i / w);
            let (fx, fy) = (x as f32 / (w - 1) as f32, y as f32 / (h - 1) as f32);
            if y < 4 {
                return [fx, fx, fx, 1.0];
            }
            let block = if (x / 8 + y / 8) % 2 == 0 { 0.25 } else { 0.7 };
            let texture = (x as f32 * 0.9).sin() * (y as f32 * 0.7).cos();
            let r = 0.5 * block + 0.4 * fx + 0.05 * texture + 0.08 * noise(x, y, 1);
            let g = 0.6 * block + 0.3 * fy + 0.08 * texture + 0.08 * noise(x, y, 2);
            let b = 0.35 + 0.5 * (1.0 - fx) * fy - 0.2 * block + 0.1 * texture + 0.08 * noise(x, y, 3);
            [r.clamp(0.0, 1.0), g.clamp(0.0, 1.0), b.clamp(0.0, 1.0), 1.0]
        })
        .collect()
}

/// The size of every stage comparison's document: big enough for the
/// pyramid blurs to have several texels each way.
const STAGE_W: u32 = 96;
const STAGE_H: u32 = 64;

/// The composite a stage reads and what the stage made of it.
struct StageRun {
    /// The composite before the stage. The 16-bit read is within half a
    /// step of each half-float texel, so the nearest half to it is that
    /// texel wherever halves are more than a step apart (above 1/32).
    input: Vec<f32>,
    /// The 16-bit export with the stage on.
    output: Vec<u16>,
}

/// `develop_test_picture` as a document, exported at 16 bits before and
/// after `set` turns a stage on. `None` with no GPU.
fn run_stage(set: &dyn Fn(&mut EngineInner)) -> Option<StageRun> {
    let (w, h) = (STAGE_W, STAGE_H);
    let mut engine = engine(w, h)?;
    commands::layer::add_layer(&mut engine, &layer_json("art", 0, 0, w, h, 1.0)).expect("layer");
    commands::layer::upload_layer_pixels_f32_rect(&mut engine, "art", w, h, 0, 0, w, h, &develop_test_picture(w, h))
        .expect("pixels");
    let mut input: Vec<f32> =
        now(compositor::composite_for_export_u16(&mut engine)).iter().map(|&v| f32::from(v) / 65535.0).collect();
    HalfRounding::Nearest.store(&mut input);
    set(&mut engine);
    let output = now(compositor::composite_for_export_u16(&mut engine));
    assert_no_gpu_errors();
    Some(StageRun { input, output })
}

/// Differences between `gpu` and `expected` in 16-bit steps, colour
/// channels only (every stage keeps alpha), with `expected` clipped to
/// 0..1 as the 16-bit read clips.
fn step_differences(gpu: &[u16], expected: &[f32]) -> Vec<(usize, f32)> {
    assert_eq!(gpu.len(), expected.len());
    gpu.iter()
        .zip(expected)
        .enumerate()
        .filter(|(i, _)| i % 4 != 3)
        .map(|(i, (&g, &e))| (i, (f32::from(g) - e.clamp(0.0, 1.0) * 65535.0).abs()))
        .collect()
}

/// Most a stage may be off on average, in 16-bit steps, once the reference
/// rounds as the GPU does: about a step is the half-float rounding of
/// values that straddle an ulp boundary. A formula that is wrong moves far
/// more pixels than that, by far more.
const MEAN_TOLERANCE: f32 = 4.0;

/// Compares a stage's output with `reference`, which makes the expected
/// image with its blurs stored at `HalfRounding`; the expected image is
/// stored the same way, as the stage's output is. Fails if the mean
/// difference is over `MEAN_TOLERANCE` or any value is more than
/// `tolerance` steps, plus `allowance(i)` for value `i`, off; the message
/// names the pixel.
fn assert_matches_reference(
    what: &str,
    run: &StageRun,
    reference: &dyn Fn(HalfRounding) -> Vec<f32>,
    tolerance: f32,
    allowance: &dyn Fn(usize, HalfRounding) -> f32,
) {
    let (rounding, expected, diffs) = [HalfRounding::Nearest, HalfRounding::TowardZero]
        .into_iter()
        .map(|rounding| {
            let mut expected = reference(rounding);
            rounding.store(&mut expected);
            let diffs = step_differences(&run.output, &expected);
            (rounding, expected, diffs)
        })
        .min_by(|a, b| {
            let mean = |d: &[(usize, f32)]| d.iter().map(|(_, v)| v).sum::<f32>();
            mean(&a.2).total_cmp(&mean(&b.2))
        })
        .unwrap();
    let mean = diffs.iter().map(|(_, d)| d).sum::<f32>() / diffs.len() as f32;
    let (i, worst) = diffs
        .iter()
        .map(|&(i, d)| (i, d - allowance(i, rounding)))
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .unwrap();
    let (x, y, channel) = ((i / 4) as u32 % STAGE_W, (i / 4) as u32 / STAGE_W, i % 4);
    eprintln!("{what}: rounding {rounding:?}, mean {mean:.2} steps, worst {worst:.1} beyond its allowance at ({x}, {y}) channel {channel}");
    assert!(mean <= MEAN_TOLERANCE, "{what}: off by {mean:.2} 16-bit steps on average (rounding {rounding:?})");
    assert!(
        worst <= tolerance,
        "{what}: {worst:.1} 16-bit steps beyond its allowance at ({x}, {y}) channel {channel}: GPU {} against reference {:.1} (rounding {rounding:?})",
        run.output[i],
        expected[i].clamp(0.0, 1.0) * 65535.0,
    );
}

const NO_ALLOWANCE: &dyn Fn(usize, HalfRounding) -> f32 = &|_, _| 0.0;

/// What `develop::detail`'s blur leaves in the texture a combining shader
/// samples, on the CPU: the two passes of a Gaussian of `sigma` working
/// pixels, or, above `PYRAMID_SIGMA`, `thumbnail_box.wgsl`'s box downscale
/// by `ceil(σ / 2)`, the Gaussian of what is left of σ, and the shader's
/// bilinear read at each pixel's centre. Each texture it fills is stored
/// with `rounding`. Returns the image at full size.
fn engine_blur(img: &[f32], w: usize, h: usize, sigma: f32, rounding: HalfRounding) -> Vec<f32> {
    use lopsy_core::detail;
    let gaussian = |img: &[f32], w: usize, h: usize, sigma: f32| {
        let mut across = detail::blur_axis(img, w, h, true, sigma);
        rounding.store(&mut across);
        let mut down = detail::blur_axis(&across, w, h, false, sigma);
        rounding.store(&mut down);
        down
    };
    if sigma <= detail::PYRAMID_SIGMA {
        return gaussian(img, w, h, sigma);
    }
    let factor = (sigma / 2.0).ceil().max(2.0) as usize;
    let (lw, lh) = (w.div_ceil(factor).max(1), h.div_ceil(factor).max(1));
    // A clamped, bilinear read of `img` (`iw`×`ih`) at texel coordinates
    // (`qx`, `qy`), texel centres on integers.
    let bilinear = |img: &[f32], iw: usize, ih: usize, qx: f32, qy: f32, c: usize| {
        let at = |x: i32, y: i32| img[(y.clamp(0, ih as i32 - 1) as usize * iw + x.clamp(0, iw as i32 - 1) as usize) * 4 + c];
        let (x0, y0) = (qx.floor(), qy.floor());
        let (fx, fy) = (qx - x0, qy - y0);
        let (x0, y0) = (x0 as i32, y0 as i32);
        let top = at(x0, y0) + fx * (at(x0 + 1, y0) - at(x0, y0));
        let bottom = at(x0, y0 + 1) + fx * (at(x0 + 1, y0 + 1) - at(x0, y0 + 1));
        top + fy * (bottom - top)
    };
    // The box downscale: each output texel averages 2×2 bilinear taps
    // spread over its footprint. The picture is opaque, so the shader's
    // premultiplied and straight averages are the same.
    let footprint = (w as f32 / lw as f32, h as f32 / lh as f32);
    let taps = ((footprint.0 * 0.5).ceil().clamp(1.0, 64.0) as usize, (footprint.1 * 0.5).ceil().clamp(1.0, 64.0) as usize);
    let step = (footprint.0 / taps.0 as f32, footprint.1 / taps.1 as f32);
    let mut low = vec![0.0f32; lw * lh * 4];
    for oy in 0..lh {
        for ox in 0..lw {
            for c in 0..4 {
                let mut sum = 0.0;
                for j in 0..taps.1 {
                    for i in 0..taps.0 {
                        let qx = ox as f32 * footprint.0 + (i as f32 + 0.5) * step.0 - 0.5;
                        let qy = oy as f32 * footprint.1 + (j as f32 + 0.5) * step.1 - 0.5;
                        sum += bilinear(img, w, h, qx, qy, c);
                    }
                }
                low[(oy * lw + ox) * 4 + c] = sum / (taps.0 * taps.1) as f32;
            }
        }
    }
    rounding.store(&mut low);
    let low = gaussian(&low, lw, lh, sigma / factor as f32);
    // The combining shader's linear, clamped read at uv = (x + 0.5) / w.
    let mut out = vec![0.0f32; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let qx = (x as f32 + 0.5) / w as f32 * lw as f32 - 0.5;
            let qy = (y as f32 + 0.5) / h as f32 * lh as f32 - 0.5;
            for c in 0..4 {
                out[(y * w + x) * 4 + c] = bilinear(&low, lw, lh, qx, qy, c);
            }
        }
    }
    out
}

#[test]
fn noise_reduction_matches_its_cpu_reference() {
    use lopsy_core::detail::{self, DetailSettings};
    let (w, h) = (STAGE_W as usize, STAGE_H as usize);
    // At full resolution the colour blur (σ 6) goes through the box
    // downscale; at half resolution (σ 3) it is a plain Gaussian.
    for (name, values) in [
        ("noise reduction, full size", [0.0, 1.0, 0.0, 70.0, 80.0, 30.0, 1.0]),
        ("noise reduction, half size", [0.0, 1.0, 0.0, 40.0, 100.0, 0.0, 0.5]),
    ] {
        let Some(run) = run_stage(&|e| commands::develop::set_image_detail(e, &values).expect("detail")) else { return };
        let s = DetailSettings::from_values(&values).unwrap();
        let reference = |rounding| {
            let chroma = engine_blur(&run.input, w, h, detail::NR_CHROMA_SIGMA * s.pixel_scale, rounding);
            detail::noise_reduce_reference(&run.input, &chroma, w, h, &s)
        };
        // An ulp of the output (32) for a value that straddles a boundary,
        // and one more for the colour blur's: the edge guard
        // `exp(-((yb - yc) / 0.08)²)` has a slope of up to 11, and the
        // chroma it swaps in is up to the colour amount times the blur.
        assert_matches_reference(name, &run, &reference, 64.0, NO_ALLOWANCE);
    }
}

#[test]
fn haze_and_local_contrast_match_their_cpu_reference() {
    use lopsy_core::detail::{self, LocalContrastSettings};
    let (w, h) = (STAGE_W as usize, STAGE_H as usize);
    // Both directions of each control. The large blur (σ 50 or 25) always
    // goes through the box downscale; the small one (σ 3 or 1.5) never.
    for (name, values) in [
        ("local contrast and dehaze, full size", [60.0, 50.0, 40.0, 1.0]),
        ("local contrast and added haze, half size", [-50.0, -40.0, -60.0, 0.5]),
    ] {
        let Some(run) = run_stage(&|e| commands::develop::set_image_local_contrast(e, &values).expect("local contrast")) else { return };
        let s = LocalContrastSettings::from_values(&values).unwrap();
        let reference = |rounding| {
            let small = engine_blur(&run.input, w, h, detail::LC_SMALL_SIGMA * s.pixel_scale, rounding);
            let large = engine_blur(&run.input, w, h, detail::LC_LARGE_SIGMA * s.pixel_scale, rounding);
            detail::local_contrast_reference(&run.input, &small, &large, w, h, &s)
        };
        // Where an ulp of either blur flips (32 steps for a blur in
        // 0.5..1), the large and small details' gains (up to 1.5 · amount
        // / 100 each) and dehazing's 1 / (1 − k) (up to 1.5 at 40) carry it
        // into the luminance, and the result scales the pixel by y2 / y.
        // A dark pixel beside light ones, as in the rows under the grey
        // ramp, takes the most: about three ulps of the blur, measured.
        // Four are allowed, since another GPU's bilinear weights differ.
        assert_matches_reference(name, &run, &reference, 128.0, NO_ALLOWANCE);
    }
}

#[test]
fn sharpening_matches_its_cpu_reference() {
    use lopsy_core::detail::{self, DetailSettings};
    let (w, h) = (STAGE_W as usize, STAGE_H as usize);
    for (name, values) in [
        ("sharpening, no edge mask", [120.0, 1.2, 0.0, 0.0, 0.0, 0.0, 1.0]),
        ("sharpening, edge mask", [150.0, 2.0, 40.0, 0.0, 0.0, 0.0, 1.0]),
    ] {
        let Some(run) = run_stage(&|e| commands::develop::set_image_detail(e, &values).expect("detail")) else { return };
        let s = DetailSettings::from_values(&values).unwrap();
        let blurs = [HalfRounding::Nearest, HalfRounding::TowardZero].map(|r| engine_blur(&run.input, w, h, s.sharpen_sigma(), r));
        let blurred = |rounding| match rounding {
            HalfRounding::Nearest => &blurs[0],
            HalfRounding::TowardZero => &blurs[1],
        };
        let reference = |rounding| detail::sharpen_reference(&run.input, blurred(rounding), w, h, &s);
        let luma = |img: &[f32], x: i32, y: i32| {
            let i = (y.clamp(0, h as i32 - 1) as usize * w + x.clamp(0, w as i32 - 1) as usize) * 4;
            detail::LUMA[0] * img[i] + detail::LUMA[1] * img[i + 1] + detail::LUMA[2] * img[i + 2]
        };
        // An ulp of the output (32) for a value that straddles a boundary,
        // and the unsharp mask adds `amount` (1.5 at most) times an ulp of
        // the blur where one flips: 80 in all.
        //
        // Where the edge mask is on its ramp, an ulp of the blur (4.9e-4)
        // that flips moves the gradient the mask is measured on by up to
        // √2 times that, and the smoothstep's slope (up to 1.5 / (0.025 ·
        // edges / 100)) turns it into a change of the mask that no
        // tolerance of a few ulps covers. That part is allowed per pixel:
        // the mask on either side of the reference's gradient.
        let allowance = |i: usize, rounding| {
            if s.edges <= 0.0 {
                return 0.0;
            }
            let blurred = blurred(rounding);
            let (x, y) = ((i / 4 % w) as i32, (i / 4 / w) as i32);
            let gx = 0.5 * (luma(blurred, x + 1, y) - luma(blurred, x - 1, y));
            let gy = 0.5 * (luma(blurred, x, y + 1) - luma(blurred, x, y - 1));
            let mag = (gx * gx + gy * gy).sqrt();
            let mask = detail::edge_mask(s.edges, mag);
            let moved = (detail::edge_mask(s.edges, mag + 7e-4) - mask)
                .abs()
                .max((detail::edge_mask(s.edges, (mag - 7e-4).max(0.0)) - mask).abs());
            s.amount / 100.0 * moved * (luma(&run.input, x, y) - luma(blurred, x, y)).abs() * 65535.0
        };
        assert_matches_reference(name, &run, &reference, 80.0, &allowance);
    }
}

#[test]
fn the_built_in_area_adjustments_match_their_cpu_reference() {
    let (w, h) = (STAGE_W as usize, STAGE_H as usize);
    // A linear area with every adjustment raised, and an inverted, rotated
    // radial one with every adjustment lowered, over the first.
    let mut values = [0.0f32; 32];
    values[..16].copy_from_slice(&[0.0, 0.0, 0.9, 10.0, 5.0, 80.0, 50.0, 0.0, 0.0, 1.2, 40.0, 50.0, 40.0, 60.0, -30.0, 50.0]);
    values[16..].copy_from_slice(&[1.0, 1.0, 0.8, 50.0, 30.0, 30.0, 18.0, 0.6, 0.5, -0.8, -50.0, -60.0, -40.0, -50.0, 40.0, -70.0]);
    let Some(run) = run_stage(&|e| commands::develop::set_image_areas(e, &values).expect("areas")) else { return };
    let (areas, _) = lopsy_core::areas::parse_areas(&values).expect("parse");
    let reference = |_| lopsy_core::areas::areas_reference(&run.input, w, h, &areas);
    // No blur: an ulp of the output for a value that straddles a boundary,
    // which the GPU's `pow` and `exp2` can push it across.
    assert_matches_reference("areas", &run, &reference, 40.0, NO_ALLOWANCE);
}

#[test]
fn finish_matches_its_cpu_reference() {
    use lopsy_core::finish::{self, FinishSettings};
    let (w, h) = (STAGE_W as usize, STAGE_H as usize);
    for (name, values) in [
        // A darkening, rounded vignette and coarse grain, as in an export.
        ("finish, full size", [-60.0, 40.0, 50.0, 60.0, 50.0, 60.0, 40.0, 7.0, 1.0]),
        // A lightening, rectangular vignette and the working image's grain.
        ("finish, working size", [50.0, 20.0, -70.0, 30.0, 80.0, 20.0, 70.0, 11.0, 0.4]),
    ] {
        let Some(run) = run_stage(&|e| commands::develop::set_image_finish(e, &values).expect("finish")) else { return };
        let s = FinishSettings::from_values(&values).unwrap();
        let reference = |_| finish::finish_reference(&run.input, w, h, &s);
        // No blur, and the grain's hash is exact integer arithmetic on
        // both sides: an ulp of the output for a value that straddles a
        // boundary, which the vignette's `pow` can push it across.
        assert_matches_reference(name, &run, &reference, 40.0, NO_ALLOWANCE);
    }
}

#[test]
fn undo_snapshots_of_a_large_layer_restore_bit_for_bit() {
    // Big enough that an interpolated UV strays off the texel centre: a
    // filtered copy then mixed in a sliver of the neighbour, and antialiased
    // edges came back a step off (#1741).
    let (width, height) = (1500u32, 2100u32);
    let Some(mut engine) = engine(width, height) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("art", 0, 0, width, height, 1.0)).expect("layer");
    let pixels: Vec<u8> = (0..height)
        .flat_map(|y| (0..width).map(move |x| (x, y)))
        .flat_map(|(x, y)| [(x % 251) as u8, (y % 241) as u8, ((x * 7 + y * 3) % 256) as u8, ((x ^ y) % 256) as u8])
        .collect();
    commands::layer::upload_layer_pixels(&mut engine, "art", &pixels, width, height, 0, 0).expect("pixels");
    let read = |engine: &EngineInner| now(lopsy_engine::document::layer_manager::read_pixels_u16(engine, "art"));
    let original = read(&engine);

    let mut current = commands::layer::snapshot_layer_gpu(&mut engine, "art");
    for trip in 0..4 {
        commands::layer::restore_from_gpu_snapshot(&mut engine, "art", current).expect("restore");
        let next = commands::layer::snapshot_layer_gpu(&mut engine, "art");
        commands::layer::release_gpu_snapshot(&mut engine, current);
        current = next;
        let restored = read(&engine);
        assert_eq!(restored.len(), original.len());
        let differing = original.iter().zip(&restored).filter(|(a, b)| a != b).count();
        assert_eq!(differing, 0, "trip {trip}: {differing} half-float values changed");
    }
    assert_no_gpu_errors();
}

// ---------------------------------------------------------------------------
// The working space: its conversions, the tone and output steps, and what
// the chain does with them on
// ---------------------------------------------------------------------------
//
// Each step is drawn from one float texture into another and read back as
// 32-bit floats, so nothing is clamped on the way: the comparison sees the
// step's own output. Both textures are half float, so the reference is fed
// the input as the texture holds it and allowed a few units in the last
// place of the result.

use lopsy_core::output::{OutputSettings, OutputTarget};
use lopsy_core::working_space::{Gamut, SourceEncoding};

/// `rgba` (straight RGBA f32, `width` wide) as a float texture.
fn float_texture(engine: &mut EngineInner, width: u32, rgba: &[f32]) -> TextureHandle {
    let height = (rgba.len() / 4) as u32 / width;
    let handle = engine.texture_pool.acquire(width, height).expect("texture");
    engine.texture_pool.upload_rgba_f32(handle, 0, 0, width, height, rgba).expect("upload");
    handle
}

/// The whole of a texture as f32 RGBA.
fn floats(engine: &EngineInner, handle: TextureHandle) -> Vec<f32> {
    let (w, h) = engine.texture_pool.get_size(handle).expect("size");
    now(engine.gpu().read_rgba_f32(handle, 0, 0, w, h))
}

/// Values as a half-float texture holds them.
fn as_halves(values: &[f32]) -> Vec<f32> {
    let mut v = values.to_vec();
    HalfRounding::Nearest.store(&mut v);
    v
}

/// Every value of `gpu` within `ulps` half-float units in the last place of
/// `expected` (relative, with a floor for values near 0), or the message
/// names the first that is not.
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

/// Scene or rendered values that test every branch: a grey ramp past white,
/// saturated colours inside and far outside sRGB, negatives, and alpha.
fn working_space_picture() -> Vec<f32> {
    let mut px = Vec::new();
    for i in 0..32 {
        let v = i as f32 / 31.0 * 4.0;
        px.extend_from_slice(&[v, v, v, 1.0]);
    }
    let colours: [[f32; 3]; 16] = [
        [0.4, 0.3, 0.25], [0.8, 0.1, 0.05], [0.05, 0.6, 0.1], [0.1, 0.15, 0.9],
        [0.0, 0.5, 0.0], [0.6, 0.0, 0.6], [1.6, 0.9, 0.2], [3.0, 2.5, 0.1],
        [0.02, 0.01, 0.4], [-0.05, 0.3, 0.2], [0.9, -0.1, -0.02], [0.18, 0.18, 0.18],
        [0.0, 0.0, 0.0], [5.0, 0.2, 0.2], [0.001, 0.002, 0.0005], [0.7, 0.7, 1.4],
    ];
    for (k, c) in colours.iter().enumerate() {
        px.extend_from_slice(&[c[0], c[1], c[2], if k % 3 == 0 { 0.5 } else { 1.0 }]);
    }
    px
}

#[test]
fn the_working_space_conversions_match_their_cpu_reference() {
    use lopsy_engine::develop::working_space::{self as ws, Conversion};
    use lopsy_core::working_space as cpu;
    let Some(mut engine) = engine(4, 4) else { return };
    let encoded: Vec<f32> = (0..48).flat_map(|i| {
        let t = i as f32 / 47.0;
        [t, (1.0 - t) * 0.8, (t * 7.0).fract(), if i % 5 == 0 { 0.25 } else { 1.0 }]
    }).collect();
    let rendered = working_space_picture();
    let program = engine.shaders.working_space().expect("compiles");
    let cases: [(&str, Conversion, &[f32], Vec<f32>); 4] = [
        ("input step, sRGB", Conversion::Input(SourceEncoding::Srgb), &encoded, cpu::input_reference(&as_halves(&encoded), SourceEncoding::Srgb)),
        ("input step, Display P3", Conversion::Input(SourceEncoding::DisplayP3), &encoded, cpu::input_reference(&as_halves(&encoded), SourceEncoding::DisplayP3)),
        ("to the display encoding", Conversion::ToDisplay, &rendered, cpu::to_display_reference(&as_halves(&rendered))),
        ("from the display encoding", Conversion::FromDisplay, &encoded, cpu::from_display_reference(&as_halves(&encoded))),
    ];
    for (what, conversion, input, expected) in cases {
        let src = float_texture(&mut engine, 16, input);
        let dst = engine.texture_pool.acquire(16, (input.len() / 64) as u32).expect("texture");
        assert!(ws::pass(&engine, &program, src, conversion).draw(Target::Texture(dst)));
        assert_within_halves(what, &floats(&engine, dst), &as_halves(&expected), 3.0);
    }
    assert_no_gpu_errors();
}

#[test]
fn the_tone_step_matches_its_cpu_reference() {
    let Some(mut engine) = engine(4, 4) else { return };
    let program = engine.shaders.tone().expect("compiles");
    // A curve and every control on, then no curve: luminance unclamped.
    let settings = [
        develop_settings(),
        lopsy_core::raf::develop::RawDevelopSettings { base_curve: None, saturation: 0.7, highlight_desaturation: false, ..develop_settings() },
    ];
    for (n, s) in settings.iter().enumerate() {
        commands::develop::set_raw_develop_json(&mut engine, &serde_json::to_string(s).unwrap()).expect("develop");
        let scene = working_space_picture();
        let src = float_texture(&mut engine, 16, &scene);
        let dst = engine.texture_pool.acquire(16, 3).expect("texture");
        let state = engine.raw_develop.as_ref().expect("state");
        let (pass, _) = lopsy_engine::develop::tone::pass(&engine, &program, src, state);
        assert!(pass.draw(Target::Texture(dst)));
        let expected = lopsy_core::tone::tone_reference(&as_halves(&scene), &lopsy_core::raf::develop::tone_settings(s));
        assert_within_halves(&format!("tone, settings {n}"), &floats(&engine, dst), &as_halves(&expected), 4.0);
    }
    assert_no_gpu_errors();
}

/// The output step drawn on the GPU over `rendered` (16 wide).
fn gpu_output(engine: &mut EngineInner, rendered: &[f32], settings: &OutputSettings) -> Vec<f32> {
    let program = engine.shaders.output().expect("compiles");
    let src = float_texture(engine, 16, rendered);
    let dst = engine.texture_pool.acquire(16, (rendered.len() / 64) as u32).expect("texture");
    assert!(lopsy_engine::develop::output::pass(engine, &program, src, settings).draw(Target::Texture(dst)));
    floats(engine, dst)
}

#[test]
fn the_output_step_matches_its_cpu_reference_for_every_target() {
    let Some(mut engine) = engine(4, 4) else { return };
    let rendered = working_space_picture();
    for target in [OutputTarget::Srgb, OutputTarget::DisplayP3, OutputTarget::Rec2020] {
        for (source, dither) in [(Gamut::Rec2020, false), (Gamut::Srgb, false), (Gamut::Rec2020, true)] {
            let s = OutputSettings::sdr(target, source, dither);
            let got = gpu_output(&mut engine, &rendered, &s);
            let expected = lopsy_core::output::output_reference(&as_halves(&rendered), 16, &s);
            assert_within_halves(&format!("output to {target:?} from {source:?}, dither {dither}"), &got, &as_halves(&expected), 4.0);
        }
    }
    assert_no_gpu_errors();
}

#[test]
fn a_wide_gamut_colour_keeps_more_saturation_in_p3_than_in_srgb_and_never_clips_hard() {
    use lopsy_core::working_space::{apply, conversion, srgb_decode};
    let Some(mut engine) = engine(4, 4) else { return };
    // From grey to Rec. 2020's green primary at the same luminance (0.25).
    let w = lopsy_core::working_space::luma(Gamut::Rec2020);
    let green = [0.0, 0.25 / w[1], 0.0];
    let steps = 64;
    let ramp: Vec<f32> = (0..steps)
        .flat_map(|i| {
            let t = i as f32 / (steps - 1) as f32;
            [0.25 + t * (green[0] - 0.25), 0.25 + t * (green[1] - 0.25), 0.25 + t * (green[2] - 0.25), 1.0]
        })
        .collect();
    let mut saturation = Vec::new();
    for target in [OutputTarget::Srgb, OutputTarget::DisplayP3] {
        let got = gpu_output(&mut engine, &ramp, &OutputSettings::sdr(target, Gamut::Rec2020, false));
        let linear: Vec<[f32; 3]> = got.chunks(4).map(|p| [srgb_decode(p[0]), srgb_decode(p[1]), srgb_decode(p[2])]).collect();
        // No channel is pinned at an end, and each moves one way along the
        // ramp: red and blue down, green up.
        for (i, pair) in linear.windows(2).enumerate() {
            let (a, b) = (pair[0], pair[1]);
            assert!(b[0] <= a[0] + 1e-4 && b[2] <= a[2] + 1e-4 && b[1] >= a[1] - 1e-4, "{target:?}: step {i} turns back: {a:?} -> {b:?}");
            assert!(b.iter().all(|&v| v > 0.0 && v < 1.0), "{target:?}: step {i} reaches an end: {b:?}");
        }
        // Its slope never collapses from one step to the next, as it does
        // where a channel is clipped.
        let chroma: Vec<f32> = linear.iter().map(|c| c[1] - c[0].min(c[2])).collect();
        let slopes: Vec<f32> = chroma.windows(2).map(|p| p[1] - p[0]).collect();
        for (i, s) in slopes.windows(2).enumerate() {
            assert!(s[1] > 0.0 && s[1] > 0.5 * s[0], "{target:?}: chroma slope drops from {} to {} at step {i}", s[0], s[1]);
        }
        // The most saturated end, in Rec. 2020: how far from its grey.
        let last = apply(&conversion(target.gamut(), Gamut::Rec2020), linear[steps - 1]);
        let y = w[0] * last[0] + w[1] * last[1] + w[2] * last[2];
        saturation.push((last[1] - y) / y);
    }
    eprintln!("Rec. 2020 green: saturation {:.3} in sRGB, {:.3} in Display P3", saturation[0], saturation[1]);
    assert!(saturation[1] > saturation[0] * 1.2, "{saturation:?}");
    assert_no_gpu_errors();
}

#[test]
fn a_grey_ramp_comes_out_grey_through_every_target() {
    let Some(mut engine) = engine(32, 4) else { return };
    let ramp: Vec<f32> = (0..64).flat_map(|i| { let v = i as f32 / 63.0 * 2.0; [v, v, v, 1.0] }).collect();
    for target in [OutputTarget::Srgb, OutputTarget::DisplayP3, OutputTarget::Rec2020] {
        let got = gpu_output(&mut engine, &ramp, &OutputSettings::sdr(target, Gamut::Rec2020, false));
        for (i, p) in got.chunks(4).enumerate() {
            let steps = [p[0], p[1], p[2]].map(|v| (v * 65535.0).round() as i32);
            assert!(steps.iter().max().unwrap() - steps.iter().min().unwrap() <= 1, "{target:?}: grey {i} came out {steps:?}");
        }
    }
    // And through the whole chain into each 16-bit export.
    commands::layer::add_layer(&mut engine, &layer_json("grey", 0, 0, 32, 4, 1.0)).expect("layer");
    let pixels: Vec<u8> = (0..128).flat_map(|i| { let v = (i % 32 * 8) as u8; [v, v, v, 255] }).collect();
    commands::layer::upload_layer_pixels(&mut engine, "grey", &pixels, 32, 4, 0, 0).expect("pixels");
    commands::develop::set_develop_working_space(&mut engine, true, 0).expect("working space");
    for target in [OutputTarget::Srgb, OutputTarget::DisplayP3, OutputTarget::Rec2020] {
        let out = now(compositor::composite_for_export_u16_to(&mut engine, target));
        for p in out.chunks(4) {
            let (lo, hi) = (p[0].min(p[1]).min(p[2]), p[0].max(p[1]).max(p[2]));
            assert!(hi - lo <= 1, "{target:?}: {p:?}");
        }
    }
    assert_no_gpu_errors();
}

#[test]
fn scene_luminance_through_tone_and_output_is_monotonic_with_no_step_at_white() {
    let Some(mut engine) = engine(4, 4) else { return };
    commands::develop::set_raw_develop_json(&mut engine, &serde_json::to_string(&develop_settings()).unwrap()).expect("develop");
    // Scene luminance 0..16, densest around the old clamp at 1, in grey and
    // in a warm colour.
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
    let src = float_texture(&mut engine, 16, &scene);
    let toned = engine.texture_pool.acquire(16, (scene.len() / 64) as u32).expect("texture");
    let state = engine.raw_develop.as_ref().expect("state");
    let (pass, _) = lopsy_engine::develop::tone::pass(&engine, &program, src, state);
    assert!(pass.draw(Target::Texture(toned)));
    let rendered = floats(&engine, toned);
    let shown = gpu_output(&mut engine, &rendered, &OutputSettings::sdr(OutputTarget::Srgb, Gamut::Rec2020, false));
    let w = lopsy_core::working_space::luma(Gamut::Rec2020);
    let y = |p: &[f32]| w[0] * p[0] + w[1] * p[1] + w[2] * p[2];
    for (name, start) in [("grey", 0), ("warm", n)] {
        let r: Vec<f32> = (start..start + n).map(|i| y(&rendered[i * 4..i * 4 + 3])).collect();
        // The output's luminance, decoded: a colour's channels may trade
        // places as it reaches white, its brightness may not fall.
        let ws = lopsy_core::working_space::luma(Gamut::Srgb);
        let s: Vec<f32> = (start..start + n)
            .map(|i| (0..3).map(|c| ws[c] * lopsy_core::working_space::srgb_decode(shown[i * 4 + c])).sum())
            .collect();
        for i in 1..n {
            assert!(r[i] >= r[i - 1], "{name}: rendered luminance falls at scene {}", lum[i]);
            assert!(s[i] >= s[i - 1] - 1e-4, "{name}: output falls at scene {}: {} -> {}", lum[i], s[i - 1], s[i]);
        }
        // Rendered values above white exist (HDR headroom), and below the
        // shoulder's ceiling.
        assert!(r[n - 1] > 1.2 && r[n - 1] < 4.0, "{name}: rendered at 16 is {}", r[n - 1]);
        // No step at the old clamp: the largest change between neighbours
        // around scene 1 is no bigger than the steps either side of it.
        let around: Vec<usize> = (1..n).filter(|&i| (0.8..1.25).contains(&lum[i])).collect();
        let jump = around.iter().map(|&i| r[i] - r[i - 1]).fold(0.0f32, f32::max);
        let below = r[around[0] - 1] - r[around[0] - 2];
        assert!(jump <= 2.0 * below.max(1e-4), "{name}: rendered jumps by {jump} at the old clamp (steps below {below})");
    }
    assert_no_gpu_errors();
}

#[test]
fn the_scene_raw_step_matches_its_cpu_reference() {
    let size = 16u32;
    let Some(mut engine) = engine(size, size) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("raw", 0, 0, size, size, 1.0)).expect("layer");
    let linear = linear_camera_rgb(size);
    commands::layer::upload_layer_pixels_f32_rect(&mut engine, "raw", size, size, 0, 0, size, size, &linear).expect("pixels");
    // No curve, saturation or desaturation: the tone step passes scene data through.
    let s = lopsy_core::raf::develop::RawDevelopSettings {
        wb_ratio: [1.1, 1.0, 0.9],
        base_curve: None,
        saturation: 1.0,
        highlight_desaturation: false,
        ..develop_settings()
    };
    commands::develop::set_raw_develop_json(&mut engine, &serde_json::to_string(&s).unwrap()).expect("develop");
    commands::develop::set_develop_working_space(&mut engine, true, 0).expect("working space");
    let got = now(commands::develop::read_rendered_f32(&mut engine));
    let expected = lopsy_core::raf::develop::scene_reference(&as_halves(&linear), &s);
    assert!(expected.iter().any(|&v| v < 0.0) && expected.iter().any(|&v| v > 1.0), "the picture leaves 0..1 in Rec. 2020");
    assert_within_halves("scene RAW step", &got, &as_halves(&expected), 4.0);
    assert_no_gpu_errors();
}

#[test]
fn an_unedited_photo_comes_back_out_as_it_went_in_alpha_included() {
    let (w, h) = (16u32, 8u32);
    let Some(mut engine) = engine(w, h) else { return };
    engine.set_background_color(0.0, 0.0, 0.0, 0.0);
    commands::layer::add_layer(&mut engine, &layer_json("photo", 0, 0, w, h, 1.0)).expect("layer");
    let pixels: Vec<u8> = (0..w * h)
        .flat_map(|i| {
            let alpha = [255u8, 255, 128, 37, 1, 255, 200, 0][i as usize % 8];
            [(i * 37 % 256) as u8, (i * 91 % 256) as u8, if i % 5 == 0 { 255 } else { (i * 13 % 256) as u8 }, alpha]
        })
        .collect();
    commands::layer::upload_layer_pixels(&mut engine, "photo", &pixels, w, h, 0, 0).expect("pixels");
    let before8 = now(compositor::composite_for_export(&mut engine));
    let before16 = now(compositor::composite_for_export_u16(&mut engine));
    for (source, target) in [(0u8, OutputTarget::Srgb), (1, OutputTarget::DisplayP3)] {
        commands::develop::set_develop_working_space(&mut engine, true, source).expect("working space");
        let after16 = now(compositor::composite_for_export_u16_to(&mut engine, target));
        let after8 = (source == 0).then(|| now(compositor::composite_for_export(&mut engine)));
        for i in 0..(w * h) as usize {
            let a = before8[i * 4 + 3];
            let channels = if a == 0 { 3..4 } else { 0..4 };
            for c in channels {
                let k = i * 4 + c;
                let d16 = (i32::from(after16[k]) - i32::from(before16[k])).abs();
                assert!(d16 <= 257, "source {source}, pixel {i} channel {c}: 16-bit {} against {}", after16[k], before16[k]);
                if let Some(after8) = &after8 {
                    let d8 = (i32::from(after8[k]) - i32::from(before8[k])).abs();
                    assert!(d8 <= 1, "pixel {i} channel {c}: 8-bit {} against {} (went in as {})", after8[k], before8[k], pixels[k]);
                }
            }
        }
    }
    assert_no_gpu_errors();
}

#[test]
fn statistics_read_the_srgb_output_whatever_the_screen_is() {
    let Some(mut engine) = engine(8, 4) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("art", 0, 0, 8, 4, 1.0)).expect("layer");
    let pixels: Vec<[u8; 4]> = (0..32).map(|i| if i % 8 < 4 { [230, 40, 30, 255] } else { [90, 160, 220, 255] }).collect();
    commands::layer::upload_layer_pixels(&mut engine, "art", pixels.as_flattened(), 8, 4, 0, 0).expect("pixels");
    commands::develop::set_develop_working_space(&mut engine, true, 0).expect("working space");
    let read = |engine: &mut EngineInner| {
        let histogram = now(commands::develop::read_develop_histogram(engine));
        let sample = now(commands::drawing::sample_color(engine, 1.0, 1.0, 1));
        let screen = now(engine.gpu().read_rgba(engine.composite_texture, 1, 1, 1, 1));
        (histogram, sample, screen)
    };
    engine.set_screen_output(false, false);
    let (h_srgb, s_srgb, screen_srgb) = read(&mut engine);
    engine.set_screen_output(true, false);
    let (h_p3, s_p3, screen_p3) = read(&mut engine);
    assert_ne!(screen_srgb, screen_p3, "the screen is rendered for its own space");
    assert_eq!(h_srgb, h_p3, "the histogram does not depend on the screen");
    assert_eq!(s_srgb, s_p3, "the readout does not depend on the screen");
    for c in 0..3 {
        assert!((i32::from(s_srgb[c]) - i32::from(pixels[9][c])).abs() <= 1, "{s_srgb:?} against {:?}", pixels[9]);
    }
    // The clipping warning, the area overlay and the mask view stay off the statistics.
    commands::develop::set_clipping_warning(&mut engine, true, true);
    assert_eq!(read(&mut engine).0, h_p3);
    assert_no_gpu_errors();
}

#[test]
fn with_the_working_space_screen_only_views_still_never_reach_exports() {
    let Some(mut engine) = engine(8, 4) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("art", 0, 0, 8, 4, 1.0)).expect("layer");
    let texels: Vec<[u8; 4]> = (0..32).map(|i| if i % 8 < 4 { [0, 0, 0, 255] } else { WHITE }).collect();
    commands::layer::upload_layer_pixels(&mut engine, "art", texels.as_flattened(), 8, 4, 0, 0).expect("pixels");
    commands::develop::set_develop_working_space(&mut engine, true, 0).expect("working space");
    commands::develop::set_image_detail(&mut engine, &[100.0, 1.0, 20.0, 0.0, 0.0, 0.0, 1.0]).expect("detail");
    let before = now(compositor::composite_for_export(&mut engine));
    let before_png = now(compositor::export_png_16(&mut engine, 2));
    compositor::render(&mut engine);
    let shown = now(engine.gpu().read_rgba(engine.composite_texture, 0, 0, 8, 4));
    commands::develop::set_clipping_warning(&mut engine, true, true);
    compositor::render(&mut engine);
    let warned = now(engine.gpu().read_rgba(engine.composite_texture, 0, 0, 8, 4));
    assert_ne!(warned, shown, "the live frame marks black and white as clipped");
    assert_eq!(&warned[..4], &[0, 0, 255, 255], "black is marked in blue");
    commands::develop::set_image_detail_mask_view(&mut engine, true);
    assert_eq!(now(compositor::composite_for_export(&mut engine)), before);
    assert_eq!(now(compositor::export_png_16(&mut engine, 2)), before_png);
    commands::develop::set_develop_working_space(&mut engine, false, 0).expect("off");
    assert!(engine.working_space.is_none());
    assert_no_gpu_errors();
}

// ---------------------------------------------------------------------------
// Tone, colour and curves on linear data: the tone pass's scene part and the
// look pass against their references, and what they must do
// ---------------------------------------------------------------------------

/// A radial area at (`cx`, `cy`) with radii (`rx`, `ry`), feather 0.5, and
/// its seven sliders: exposure, contrast, highlights, shadows,
/// temperature, tint, saturation.
fn radial_area(cx: f32, cy: f32, rx: f32, ry: f32, sliders: [f32; 7]) -> Vec<f32> {
    let mut v = vec![1.0, 0.0, 1.0, cx, cy, rx, ry, 0.0, 0.5];
    v.extend_from_slice(&sliders);
    v
}

/// The tone pass drawn over `scene` (16 wide) for the RAW state when `raw`,
/// or with no profile part.
fn gpu_tone(engine: &mut EngineInner, scene: &[f32], raw: bool) -> Vec<f32> {
    let program = engine.shaders.tone().expect("compiles");
    let src = float_texture(engine, 16, scene);
    let dst = engine.texture_pool.acquire(16, (scene.len() / 64) as u32).expect("texture");
    let state = if raw { engine.raw_develop.as_ref() } else { None };
    let (pass, _) = lopsy_engine::develop::tone::pass_for(engine, &program, src, state);
    assert!(pass.draw(Target::Texture(dst)));
    floats(engine, dst)
}

/// The CPU reference of the whole tone pass for the engine's settings.
fn cpu_tone(engine: &EngineInner, scene: &[f32], raw: Option<&lopsy_core::raf::develop::RawDevelopSettings>) -> Vec<f32> {
    let areas = lopsy_core::areas::parse_areas(engine.areas.as_deref().unwrap_or(&[])).unwrap().0;
    let area_tone = lopsy_engine::develop::tone::area_tone(engine);
    let sliders = engine.develop_tone.unwrap_or_default();
    let toned = lopsy_core::scene_tone::scene_tone_reference(scene, 16, scene.len() / 64, &sliders, &areas, &area_tone);
    match raw {
        Some(s) => lopsy_core::tone::tone_reference(&toned, &lopsy_core::raf::develop::tone_settings(s)),
        None => toned,
    }
}

#[test]
fn the_tone_pass_on_scene_data_matches_its_cpu_reference() {
    let Some(mut engine) = engine(16, 3) else { return };
    commands::develop::set_develop_working_space(&mut engine, true, 0).expect("working space");
    let s = develop_settings();
    commands::develop::set_raw_develop_json(&mut engine, &serde_json::to_string(&s).unwrap()).expect("develop");
    let mut areas = radial_area(8.0, 1.5, 5.0, 2.0, [0.7, 40.0, -60.0, 30.0, 50.0, -20.0, 0.0]);
    areas.extend(radial_area(3.0, 0.5, 3.0, 3.0, [-0.5, -30.0, 80.0, -40.0, -30.0, 40.0, 0.0]));
    commands::develop::set_image_areas(&mut engine, &areas).expect("areas");
    let mut layer = [0.0f32; commands::develop::AREA_LOOK_LEN];
    layer[0] = 60.0;
    layer[1] = -45.0;
    commands::develop::set_develop_area_look(&mut engine, 1, &layer).expect("area look");
    let scene = working_space_picture();
    // Every slider, both ends and between, RAW and not.
    let cases: [[f32; 8]; 4] = [
        [0.0, 0.0, 0.0, 35.0, -100.0, 60.0, 20.0, -30.0],
        [0.0, 0.0, 0.0, -100.0, 100.0, -100.0, -100.0, 100.0],
        [1.3, 40.0, -25.0, 100.0, -40.0, 100.0, 100.0, -100.0],
        [-0.8, -100.0, 100.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    ];
    for (n, values) in cases.iter().enumerate() {
        commands::develop::set_develop_tone(&mut engine, values).expect("tone");
        let raw = n % 2 == 0;
        let gpu = gpu_tone(&mut engine, &scene, raw);
        let expected = cpu_tone(&engine, &as_halves(&scene), raw.then_some(&s));
        // The GPU's log2 and exp2 are within a few units in the last place
        // of an f32; half-float output hides most of that, so 4 ulps of a
        // half, as for the profile's part alone.
        assert_within_halves(&format!("tone pass, case {n}"), &gpu, &as_halves(&expected), 4.0);
    }
    assert_no_gpu_errors();
}

#[test]
fn zero_on_every_tone_slider_and_an_area_of_zeros_change_nothing() {
    let Some(mut engine) = engine(16, 3) else { return };
    commands::develop::set_develop_working_space(&mut engine, true, 0).expect("working space");
    let s = develop_settings();
    commands::develop::set_raw_develop_json(&mut engine, &serde_json::to_string(&s).unwrap()).expect("develop");
    let scene = working_space_picture();
    let before = gpu_tone(&mut engine, &scene, true);
    commands::develop::set_develop_tone(&mut engine, &[0.0; 8]).expect("tone");
    commands::develop::set_image_areas(&mut engine, &radial_area(8.0, 1.5, 5.0, 2.0, [0.0; 7])).expect("areas");
    assert!(lopsy_engine::develop::tone::scene_is_active(&engine), "the scene part runs, for the area");
    assert_eq!(gpu_tone(&mut engine, &scene, true), before);
    assert_eq!(gpu_tone(&mut engine, &scene, false), as_halves(&scene), "no profile, no sliders: the identity");
    assert_no_gpu_errors();
}

#[test]
fn a_grey_ramp_stays_grey_through_tone_at_any_slider_values() {
    let Some(mut engine) = engine(16, 4) else { return };
    commands::develop::set_develop_working_space(&mut engine, true, 0).expect("working space");
    commands::develop::set_raw_develop_json(&mut engine, &serde_json::to_string(&develop_settings()).unwrap()).expect("develop");
    let ramp: Vec<f32> = (0..64).flat_map(|i| {
        let v = 8.0 * (i as f32 / 63.0).powi(3);
        [v, v, v, 1.0]
    }).collect();
    for values in [[0.0, 0.0, 0.0, 100.0, -100.0, 100.0, -100.0, 100.0], [2.0, 0.0, 0.0, -100.0, 100.0, -100.0, 100.0, -100.0]] {
        commands::develop::set_develop_tone(&mut engine, &values).expect("tone");
        for raw in [true, false] {
            for p in gpu_tone(&mut engine, &ramp, raw).chunks(4) {
                let ulp = p[1].abs().max(1.0 / 64.0) / 1024.0;
                assert!((p[0] - p[1]).abs() <= ulp && (p[2] - p[1]).abs() <= ulp, "{values:?}, raw {raw}: {p:?}");
            }
        }
    }
    assert_no_gpu_errors();
}

#[test]
fn highlights_down_recovers_three_stops_above_white_through_the_raw_curve() {
    let Some(mut engine) = engine(16, 4) else { return };
    commands::develop::set_develop_working_space(&mut engine, true, 0).expect("working space");
    commands::develop::set_raw_develop_json(&mut engine, &serde_json::to_string(&develop_settings()).unwrap()).expect("develop");
    // Scene luminance 0 to 8, three stops above white, grey.
    let ramp: Vec<f32> = (0..64).flat_map(|i| {
        let v = 8.0 * i as f32 / 63.0;
        [v, v, v, 1.0]
    }).collect();
    let srgb = OutputSettings::sdr(OutputTarget::Srgb, Gamut::Rec2020, false);
    let out = |engine: &mut EngineInner, highlights: f32| {
        commands::develop::set_develop_tone(engine, &[0.0, 0.0, 0.0, 0.0, highlights, 0.0, 0.0, 0.0]).expect("tone");
        let rendered = gpu_tone(engine, &ramp, true);
        gpu_output(engine, &rendered, &srgb).chunks(4).map(|p| p[1]).collect::<Vec<f32>>()
    };
    let flat = out(&mut engine, 0.0);
    let recovered = out(&mut engine, -100.0);
    // The pixels that were above white: scene 1 to 8.
    let above: Vec<usize> = (0..64).filter(|&i| 8.0 * i as f32 / 63.0 > 1.0).collect();
    assert!(flat[63] > 0.999, "Highlights 0 reaches white: {}", flat[63]);
    let step = 1.0 / 65535.0;
    for pair in above.windows(2) {
        let (a, b) = (recovered[pair[0]], recovered[pair[1]]);
        assert!(b > a + step, "scene pixels {} and {}: {a} then {b}, not distinct", pair[0], pair[1]);
    }
    assert!(recovered[63] < 0.99, "the top of the ramp comes back below white: {}", recovered[63]);
    eprintln!("Highlights -100: scene 1 -> {}, scene 8 -> {}", recovered[above[0]], recovered[63]);
    assert_no_gpu_errors();
}

#[test]
fn a_mask_with_exposure_plus_one_doubles_its_centre_and_leaves_outside_alone() {
    let Some(mut engine) = engine(16, 3) else { return };
    commands::develop::set_develop_working_space(&mut engine, true, 0).expect("working space");
    commands::develop::set_image_areas(&mut engine, &radial_area(3.5, 1.5, 2.0, 2.0, [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])).expect("areas");
    let flat: Vec<f32> = (0..48).flat_map(|_| [0.1f32, 0.25, 0.4, 1.0]).collect();
    let out = gpu_tone(&mut engine, &flat, false);
    let centre = (16 + 3) * 4;
    let flat_h = as_halves(&flat);
    for c in 0..3 {
        assert_eq!(out[centre + c], 2.0 * flat_h[centre + c], "channel {c} at the centre");
    }
    for x in 7..16 {
        for y in 0..3 {
            let i = (y * 16 + x) * 4;
            assert_eq!(out[i..i + 4], flat_h[i..i + 4], "pixel ({x}, {y}) is outside the mask");
        }
    }
    assert_no_gpu_errors();
}

/// The look pass drawn over `rendered` (16 wide) with the document's settings.
fn gpu_look(engine: &mut EngineInner, rendered: &[f32]) -> Vec<f32> {
    let program = engine.shaders.look().expect("compiles");
    let src = float_texture(engine, 16, rendered);
    let dst = engine.texture_pool.acquire(16, (rendered.len() / 64) as u32).expect("texture");
    let run = lopsy_engine::develop::look::document_run(engine);
    let (pass, _) = lopsy_engine::develop::look::pass(engine, &program, src, &run);
    assert!(pass.draw(Target::Texture(dst)));
    floats(engine, dst)
}

/// A curve table through (0, lift), (0.5, mid) and (1, top), straight between.
fn curve_table(lift: f32, mid: f32, top: f32) -> Vec<f32> {
    let n = lopsy_core::look::CURVE_ENTRIES;
    (0..n).map(|i| {
        let x = i as f32 / (n - 1) as f32;
        if x < 0.5 { lift + (mid - lift) * x * 2.0 } else { mid + (top - mid) * (x - 0.5) * 2.0 }
    }).collect()
}

#[test]
fn the_look_pass_matches_its_cpu_reference() {
    let Some(mut engine) = engine(16, 3) else { return };
    commands::develop::set_develop_working_space(&mut engine, true, 0).expect("working space");
    commands::develop::set_image_areas(&mut engine, &radial_area(8.0, 1.5, 5.0, 2.0, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -70.0])).expect("areas");
    let mut layer = [0.0f32; commands::develop::AREA_LOOK_LEN];
    layer[2] = 80.0;
    commands::develop::set_develop_area_look(&mut engine, 0, &layer).expect("area look");
    let mut look = vec![35.0f32, -20.0];
    look.extend((0..24).map(|k| [40.0, -60.0, 30.0, 0.0][k % 4] * if k % 3 == 0 { 1.0 } else { -0.5 }));
    // Lopsy's grade layout: warm shadows, cool highlights, balance and width.
    look.extend_from_slice(&[0.08, 0.0, -0.08, 0.05, 0.0, 0.0, 0.0, 0.0, -0.05, 0.0, 0.06, -0.03, 0.0, 0.0, 0.0, 0.0, 1.2, 0.2]);
    let rendered = working_space_picture();
    let identity = curve_table(0.0, 0.5, 1.0);
    let mut curves = curve_table(0.05, 0.55, 0.95);
    curves.extend(curve_table(0.0, 0.6, 1.0));
    curves.extend(identity.iter().copied());
    curves.extend(curve_table(0.1, 0.4, 1.0));
    let cases = [(look.clone(), None), (vec![0.0; 44], Some(&curves)), (look, Some(&curves))];
    for (n, (look, curves)) in cases.into_iter().enumerate() {
        commands::develop::set_develop_look(&mut engine, &look).expect("look");
        match curves {
            Some(c) => commands::develop::set_develop_curves(&mut engine, c).expect("curves"),
            None => commands::develop::clear_develop_curves(&mut engine),
        }
        let gpu = gpu_look(&mut engine, &rendered);
        // The CPU reads the tables as the half-float texture holds them.
        let all_identity = identity.repeat(4);
        let tables = lopsy_core::look::parse_curves(&as_halves(curves.map_or(&all_identity[..], |c| &c[..]))).unwrap();
        let tables = [0, 1, 2, 3].map(|k| if curves.is_some() && k != 2 { tables[k].clone() } else { None });
        let areas = lopsy_core::areas::parse_areas(engine.areas.as_deref().unwrap()).unwrap().0;
        let inputs = lopsy_core::look::LookInputs {
            settings: engine.develop_look.unwrap_or_default(),
            curves: &tables,
            areas: &areas,
            area_vibrance: &[80.0],
        };
        let expected = lopsy_core::look::look_reference(&as_halves(&rendered), 16, 3, &inputs);
        // The cube roots, the hue's atan2 and the matrices are a few f32
        // units in the last place apart; after the trip into OkLab and back
        // that stays under a half-float unit, so 4 of them.
        assert_within_halves(&format!("look pass, case {n}"), &gpu, &as_halves(&expected), 4.0);
    }
    assert_no_gpu_errors();
}

#[test]
fn saturation_down_gives_equal_channels_and_zero_looks_change_nothing() {
    let Some(mut engine) = engine(16, 3) else { return };
    commands::develop::set_develop_working_space(&mut engine, true, 0).expect("working space");
    let rendered = working_space_picture();
    commands::develop::set_develop_look(&mut engine, &[0.0; 44]).expect("look");
    let identity = curve_table(0.0, 0.5, 1.0).repeat(4);
    commands::develop::set_develop_curves(&mut engine, &identity).expect("curves");
    assert!(!compositor::look_draws(&engine), "nothing to draw");
    // An area makes the colour step run with values of 0 at its pixels.
    commands::develop::set_image_areas(&mut engine, &radial_area(8.0, 1.5, 5.0, 2.0, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1e-6])).expect("areas");
    let same = gpu_look(&mut engine, &rendered);
    let halves = as_halves(&rendered);
    for (i, (g, e)) in same.iter().zip(&halves).enumerate() {
        assert!((g - e).abs() <= e.abs().max(1.0 / 64.0) / 1024.0, "value {i}: {g} against {e}");
    }
    // Saturation −100 for the photo, and an area of −100 on a photo at 0:
    // both exactly grey.
    let mut grey = [0.0f32; 44];
    grey[1] = -100.0;
    commands::develop::clear_image_areas(&mut engine);
    commands::develop::set_develop_look(&mut engine, &grey).expect("look");
    for p in gpu_look(&mut engine, &rendered).chunks(4) {
        assert!(p[0] == p[1] && p[1] == p[2], "{p:?}");
    }
    commands::develop::set_develop_look(&mut engine, &[0.0; 44]).expect("look");
    commands::develop::set_image_areas(&mut engine, &radial_area(8.0, 1.5, 50.0, 50.0, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -100.0])).expect("areas");
    for p in gpu_look(&mut engine, &rendered).chunks(4) {
        assert!(p[0] == p[1] && p[1] == p[2], "{p:?}");
    }
    assert_no_gpu_errors();
}

#[test]
fn with_the_working_space_lopsys_adjustments_do_nothing_and_the_new_stages_do() {
    let Some(mut engine) = engine(8, 4) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("art", 0, 0, 8, 4, 1.0)).expect("layer");
    let texels: Vec<[u8; 4]> = (0..32).map(|i| [(i * 8) as u8, 120, 60, 255]).collect();
    commands::layer::upload_layer_pixels(&mut engine, "art", texels.as_flattened(), 8, 4, 0, 0).expect("pixels");
    let plain = now(compositor::composite_for_export_u16(&mut engine));
    commands::adjustment::set_image_contrast(&mut engine, 60.0);
    commands::develop::set_image_color_mixer(&mut engine, &[50.0; 24]).expect("mixer");
    assert_ne!(now(compositor::composite_for_export_u16(&mut engine)), plain, "Lopsy's adjustments act without the working space");
    commands::develop::set_develop_working_space(&mut engine, true, 0).expect("working space");
    let with_old = now(compositor::composite_for_export_u16(&mut engine));
    commands::adjustment::clear_image_adjustments(&mut engine);
    commands::develop::clear_image_color_mixer(&mut engine);
    assert_eq!(now(compositor::composite_for_export_u16(&mut engine)), with_old, "they do nothing with it");
    commands::develop::set_develop_tone(&mut engine, &[0.0, 0.0, 0.0, 60.0, 0.0, 0.0, 0.0, 0.0]).expect("tone");
    assert_ne!(now(compositor::composite_for_export_u16(&mut engine)), with_old, "the new contrast does");
    assert_no_gpu_errors();
}

#[test]
fn an_areas_layer_look_shows_through_its_mask_only_with_the_working_space() {
    let Some(mut engine) = engine(32, 8) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("art", 0, 0, 32, 8, 1.0)).expect("layer");
    let texels: Vec<[u8; 4]> = (0..32 * 8).map(|i| [(i % 32 * 7) as u8, 110, 90, 255]).collect();
    commands::layer::upload_layer_pixels(&mut engine, "art", texels.as_flattened(), 32, 8, 0, 0).expect("pixels");
    commands::develop::set_develop_working_space(&mut engine, true, 0).expect("working space");
    // A hard-edged radial area over x < 10 (centre 4, radius 6).
    let mut area = radial_area(4.0, 4.0, 6.0, 20.0, [0.0; 7]);
    area[8] = 0.0;
    commands::develop::set_image_areas(&mut engine, &area).expect("areas");
    let before = now(compositor::composite_for_export_u16(&mut engine));
    let mut layer = [0.0f32; commands::develop::AREA_LOOK_LEN];
    // Color by hue on every band, and a warm global grade.
    for k in 0..8 {
        layer[3 + k * 3 + 1] = 60.0;
    }
    layer[27 + 12] = 0.1;
    layer[27 + 16] = 1.0;
    layer[27 + 17] = 0.2;
    commands::develop::set_develop_area_look(&mut engine, 0, &layer).expect("area look");
    let after = now(compositor::composite_for_export_u16(&mut engine));
    let px = |v: &[u16], x: usize, y: usize| v[(y * 32 + x) * 4..(y * 32 + x) * 4 + 4].to_vec();
    for y in 0..8 {
        assert_ne!(px(&after, 3, y), px(&before, 3, y), "inside the area at row {y}");
        for x in 11..32 {
            assert_eq!(px(&after, x, y), px(&before, x, y), "outside the area at ({x}, {y})");
        }
    }
    // The old area-layer calls change nothing with the working space.
    commands::develop::clear_image_area_layer(&mut engine, 0);
    commands::develop::set_image_area_tone(&mut engine, 0, 50.0, -50.0, 50.0).expect("old area tone");
    assert_eq!(now(compositor::composite_for_export_u16(&mut engine)), before);
    assert_no_gpu_errors();
}

#[test]
fn scene_statistics_are_read_before_tone_with_the_exposure_applied() {
    let Some(mut engine) = engine(64, 32) else { return };
    commands::layer::add_layer(&mut engine, &layer_json("art", 0, 0, 64, 32, 1.0)).expect("layer");
    // Left half middle grey (sRGB 118 is linear 0.181), right half 2 stops
    // darker (sRGB 63 is 0.0497, about −1.86 stops).
    let texels: Vec<[u8; 4]> = (0..64 * 32).map(|i| if i % 64 < 32 { [118, 118, 118, 255] } else { [63, 63, 63, 255] }).collect();
    commands::layer::upload_layer_pixels(&mut engine, "art", texels.as_flattened(), 64, 32, 0, 0).expect("pixels");
    assert!(block_on(commands::develop::read_scene_statistics(&mut engine)).is_err(), "no working space, no statistics");
    commands::develop::set_develop_working_space(&mut engine, true, 0).expect("working space");
    let plain = now(commands::develop::read_scene_statistics(&mut engine));
    assert_eq!(plain.len(), lopsy_core::scene_stats::SCENE_STATS_LEN);
    assert_eq!(plain[0], 1.0);
    let grey = (0.181_f32 / 0.18).log2();
    assert!((plain[7] - grey).abs() < 0.02 && (plain[1] + 1.86).abs() < 0.03, "{plain:?}");
    // The tone sliders act after the read; the exposure is added.
    commands::develop::set_develop_tone(&mut engine, &[1.0, 0.0, 0.0, 80.0, -100.0, 50.0, 0.0, 0.0]).expect("tone");
    let brighter = now(commands::develop::read_scene_statistics(&mut engine));
    for k in 1..8 {
        assert!((brighter[k] - plain[k] - 1.0).abs() < 1e-5, "{plain:?} {brighter:?}");
    }
    assert!(engine.scene_capture.is_none());
    let tone = lopsy_core::scene_stats::auto_tone_scene(&brighter, &lopsy_core::develop_stats::ToneSettings { exposure: 1.0, ..Default::default() });
    assert!((tone.exposure - (1.0 - brighter[4])).abs() < 0.051, "the median goes to middle grey: {tone:?}");
    assert_no_gpu_errors();
}
