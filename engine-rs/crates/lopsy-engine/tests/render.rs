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

use std::future::Future;
use std::sync::Mutex;
use std::task::{Context, Poll, Waker};

use lopsy_core::geometry::Rect;
use lopsy_engine::engine::EngineInner;
use lopsy_engine::gpu::context::GpuContext;
use lopsy_engine::gpu::params::core::BlitRegionParams;
use lopsy_engine::gpu::pass::{Blend, Scissor, Target};
use lopsy_engine::gpu::read::Read;
use lopsy_engine::gpu::shader::ShaderPrograms;
use lopsy_engine::gpu::texture_pool::TextureHandle;
use lopsy_engine::{commands, compositor, host, task};

/// Everything the engine logged as an error: GPU validation errors arrive
/// here through the device's uncaptured-error handler.
static ERRORS: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn record(level: host::LogLevel, message: &str) {
    if level == host::LogLevel::Error {
        ERRORS.lock().unwrap().push(message.to_string());
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
    let errors = ERRORS.lock().unwrap();
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
