//! Reading a texture back on wgpu: copy it to a buffer, map the buffer,
//! and hand over the bytes once the map has completed.
//!
//! In the browser a map completes after the page has gone round its event
//! loop, so the future is pending until then and the host has to be told
//! what it is waiting for ([`take_waiting_on`]). Outside the browser the
//! device can be made to wait, and the future is ready on its first poll.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};
use std::task::{Context, Poll};

use lopsy_core::half::f16_to_f32;

use super::context::GpuContext;

/// A row of a texture-to-buffer copy starts on a multiple of this.
const ROW_ALIGNMENT: u32 = 256;

/// The most one readback buffer holds. A read of more is copied out in
/// bands of rows, one buffer each: a device rejects a buffer over its
/// `max_buffer_size` (256 MiB unless more is asked for, less than a 40
/// megapixel layer at 8 bytes a texel), and in the browser a mapped buffer
/// is copied into the wasm memory whole before it can be read.
const BAND_BYTES: u64 = 64 << 20;

/// Set by the map callback: whether the buffer mapped.
type Arrival = Arc<Mutex<Option<Result<(), String>>>>;

#[cfg(target_arch = "wasm32")]
thread_local! {
    /// The promise of the read the last pending poll was waiting for.
    static WAITING_ON: std::cell::RefCell<Option<js_sys::Promise>> = const { std::cell::RefCell::new(None) };
}

/// The promise that resolves when the read a task is waiting for has
/// arrived: after a task's poll returns pending, the host awaits this and
/// polls again.
#[cfg(target_arch = "wasm32")]
pub fn take_waiting_on() -> Option<js_sys::Promise> {
    WAITING_ON.with(|waiting| waiting.borrow_mut().take())
}

/// Waits for a buffer to map.
struct Mapped {
    arrival: Arrival,
    #[cfg(target_arch = "wasm32")]
    arrived: js_sys::Promise,
    #[cfg(not(target_arch = "wasm32"))]
    device: wgpu::Device,
}

impl Future for Mapped {
    type Output = Result<(), String>;

    fn poll(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Self::Output> {
        // Outside the browser nothing completes a map until the device is
        // polled, and it can simply be told to wait.
        #[cfg(not(target_arch = "wasm32"))]
        let _ = self.device.poll(wgpu::PollType::wait_indefinitely());

        if let Some(result) = self.arrival.lock().ok().and_then(|mut slot| slot.take()) {
            return Poll::Ready(result);
        }
        #[cfg(target_arch = "wasm32")]
        WAITING_ON.with(|waiting| *waiting.borrow_mut() = Some(self.arrived.clone()));
        Poll::Pending
    }
}

/// Start the map of `buffer` and return the future of its completion.
fn map(ctx: &GpuContext, buffer: &wgpu::Buffer) -> Mapped {
    let arrival: Arrival = Arc::new(Mutex::new(None));
    let slot = Arc::clone(&arrival);
    let deliver = move |result: Result<(), wgpu::BufferAsyncError>| {
        if let Ok(mut slot) = slot.lock() {
            *slot = Some(result.map_err(|e| format!("Readback failed: {e}")));
        }
    };

    #[cfg(target_arch = "wasm32")]
    {
        let _ = ctx;
        let mut resolve = None;
        let arrived = js_sys::Promise::new(&mut |resolve_fn, _reject| resolve = Some(resolve_fn));
        buffer.map_async(wgpu::MapMode::Read, .., move |result| {
            deliver(result);
            if let Some(resolve) = resolve {
                let _ = resolve.call0(&wasm_bindgen::JsValue::UNDEFINED);
            }
        });
        Mapped { arrival, arrived }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        buffer.map_async(wgpu::MapMode::Read, .., deliver);
        Mapped { arrival, device: ctx.device.clone() }
    }
}

/// The part of a wanted rect that lies inside a texture.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Inside {
    /// Where it starts in the texture.
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    /// Where it starts in the wanted rect.
    dx: u32,
    dy: u32,
}

/// Clip the `w` by `h` rect at `(x, y)` to a texture `tw` by `th`. WebGL
/// reads zeros where a rect leaves the texture; WebGPU rejects the copy.
fn inside(x: i32, y: i32, w: u32, h: u32, tw: u32, th: u32) -> Option<Inside> {
    let x0 = x.max(0) as i64;
    let y0 = y.max(0) as i64;
    let x1 = (x as i64 + w as i64).min(tw as i64);
    let y1 = (y as i64 + h as i64).min(th as i64);
    (x1 > x0 && y1 > y0).then(|| Inside {
        x: x0 as u32,
        y: y0 as u32,
        w: (x1 - x0) as u32,
        h: (y1 - y0) as u32,
        dx: (x0 - x as i64) as u32,
        dy: (y0 - y as i64) as u32,
    })
}

/// Split `rows` rows of `padded_row` bytes into bands of at most
/// `band_bytes` each, as `(first row, row count)`. A band is never less
/// than one row.
fn bands(rows: u32, padded_row: u32, band_bytes: u64) -> impl Iterator<Item = (u32, u32)> {
    let per_band = (band_bytes / u64::from(padded_row.max(1))).clamp(1, u64::from(u32::MAX)) as u32;
    (0..rows).step_by(per_band as usize).map(move |first| (first, per_band.min(rows - first)))
}

/// Copy the `w` by `h` texels of `texture` at `(x, y)` out of the GPU. The
/// future's bytes are `w * h` texels of `bytes_per_texel`, row after row
/// with no padding, and zero where the rect lies outside the texture. The
/// copy is taken now: what the texture holds later does not change it.
pub(in crate::gpu) fn read_texels(
    ctx: &GpuContext,
    texture: &wgpu::Texture,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    bytes_per_texel: u32,
) -> impl Future<Output = Result<Vec<u8>, String>> + 'static {
    let band_bytes = BAND_BYTES.min(ctx.device.limits().max_buffer_size);
    read_texels_in_bands(ctx, texture, x, y, w, h, bytes_per_texel, band_bytes)
}

/// [`read_texels`] with no buffer larger than `band_bytes`, or than one
/// row where a row is more.
#[allow(clippy::too_many_arguments)]
fn read_texels_in_bands(
    ctx: &GpuContext,
    texture: &wgpu::Texture,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    bytes_per_texel: u32,
    band_bytes: u64,
) -> impl Future<Output = Result<Vec<u8>, String>> + 'static {
    let len = w as usize * h as usize * bytes_per_texel as usize;
    let copy = inside(x, y, w, h, texture.width(), texture.height()).map(|area| {
        let padded_row = (area.w * bytes_per_texel).next_multiple_of(ROW_ALIGNMENT);
        let mut encoder = ctx.device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
        let buffers: Vec<(u32, u32, wgpu::Buffer)> = bands(area.h, padded_row, band_bytes)
            .map(|(first_row, rows)| {
                let buffer = ctx.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("readback"),
                    size: u64::from(padded_row) * u64::from(rows),
                    usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                    mapped_at_creation: false,
                });
                encoder.copy_texture_to_buffer(
                    wgpu::TexelCopyTextureInfo {
                        texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d { x: area.x, y: area.y + first_row, z: 0 },
                        aspect: wgpu::TextureAspect::All,
                    },
                    wgpu::TexelCopyBufferInfo {
                        buffer: &buffer,
                        layout: wgpu::TexelCopyBufferLayout {
                            offset: 0,
                            bytes_per_row: Some(padded_row),
                            rows_per_image: None,
                        },
                    },
                    wgpu::Extent3d { width: area.w, height: rows, depth_or_array_layers: 1 },
                );
                (first_row, rows, buffer)
            })
            .collect();
        ctx.queue.submit([encoder.finish()]);
        let read_bands: Vec<_> = buffers
            .into_iter()
            .map(|(first_row, rows, buffer)| {
                let mapped = map(ctx, &buffer);
                (first_row, rows, buffer, mapped)
            })
            .collect();
        (area, padded_row as usize, read_bands)
    });

    async move {
        let mut texels = vec![0u8; len];
        let Some((area, padded_row, read_bands)) = copy else {
            return Ok(texels);
        };
        let texel = bytes_per_texel as usize;
        let row_len = area.w as usize * texel;
        for (first_row, rows, buffer, mapped) in read_bands {
            mapped.await?;
            {
                let view = buffer.get_mapped_range(..).map_err(|e| format!("Readback failed: {e}"))?;
                for row in 0..rows as usize {
                    let from = row * padded_row;
                    let to = ((area.dy as usize + first_row as usize + row) * w as usize + area.dx as usize) * texel;
                    texels[to..to + row_len].copy_from_slice(&view[from..from + row_len]);
                }
            }
            buffer.unmap();
            buffer.destroy();
        }
        Ok(texels)
    }
}

/// Half-float texel bytes as 8-bit values: clamped to 0..1 and rounded, as
/// the WebGL backend converts the floats it reads.
pub(in crate::gpu) fn halves_to_u8(bytes: &[u8]) -> Vec<u8> {
    static TABLE: OnceLock<Box<[u8]>> = OnceLock::new();
    let table = TABLE.get_or_init(|| {
        (0..=u16::MAX).map(|half| (f16_to_f32(half).clamp(0.0, 1.0) * 255.0 + 0.5) as u8).collect()
    });
    bytes.chunks_exact(2).map(|b| table[usize::from(u16::from_le_bytes([b[0], b[1]]))]).collect()
}

/// Half-float texel bytes as 16-bit values, clamped and rounded likewise.
pub(in crate::gpu) fn halves_to_u16(bytes: &[u8]) -> Vec<u16> {
    static TABLE: OnceLock<Box<[u16]>> = OnceLock::new();
    let table = TABLE.get_or_init(|| {
        (0..=u16::MAX).map(|half| (f16_to_f32(half).clamp(0.0, 1.0) * 65535.0 + 0.5) as u16).collect()
    });
    bytes.chunks_exact(2).map(|b| table[usize::from(u16::from_le_bytes([b[0], b[1]]))]).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopsy_core::half::f32_to_f16;

    #[test]
    fn a_rect_inside_the_texture_is_copied_whole() {
        assert_eq!(inside(2, 3, 4, 5, 10, 10), Some(Inside { x: 2, y: 3, w: 4, h: 5, dx: 0, dy: 0 }));
    }

    #[test]
    fn a_rect_that_leaves_the_texture_is_clipped_and_placed() {
        // The eyedropper's 5x5 sample centred on texel (1, 0).
        assert_eq!(inside(-1, -2, 5, 5, 10, 10), Some(Inside { x: 0, y: 0, w: 4, h: 3, dx: 1, dy: 2 }));
        assert_eq!(inside(8, 8, 5, 5, 10, 10), Some(Inside { x: 8, y: 8, w: 2, h: 2, dx: 0, dy: 0 }));
        assert_eq!(inside(10, 0, 5, 5, 10, 10), None);
        assert_eq!(inside(-5, 0, 5, 5, 10, 10), None);
        assert_eq!(inside(0, 0, 0, 5, 10, 10), None);
    }

    #[test]
    fn rows_are_split_into_bands_no_larger_than_asked() {
        // The 7928x5352 layer the Magic Wand could not read: one buffer
        // would be 339,787,776 bytes, over the 268,435,456 a device allows.
        let padded_row = (7928u32 * 8).next_multiple_of(ROW_ALIGNMENT);
        let split: Vec<_> = bands(5352, padded_row, BAND_BYTES).collect();
        assert_eq!(split.first(), Some(&(0, 1057)));
        assert_eq!(split.last(), Some(&(5285, 67)));
        assert!(split.iter().all(|&(_, rows)| u64::from(rows) * u64::from(padded_row) <= BAND_BYTES));
        assert!(split.windows(2).all(|pair| pair[0].0 + pair[0].1 == pair[1].0));
        assert_eq!(split.iter().map(|&(_, rows)| rows).sum::<u32>(), 5352);
    }

    #[test]
    fn a_band_is_at_least_a_row_and_a_small_read_is_one_band() {
        assert_eq!(bands(3, 512, 100).collect::<Vec<_>>(), [(0, 1), (1, 1), (2, 1)]);
        assert_eq!(bands(5, 256, 512).collect::<Vec<_>>(), [(0, 2), (2, 2), (4, 1)]);
        assert_eq!(bands(4, 256, BAND_BYTES).collect::<Vec<_>>(), [(0, 4)]);
        assert_eq!(bands(0, 256, BAND_BYTES).count(), 0);
    }

    /// On a real GPU: `cargo test -p lopsy-engine --features native`.
    #[cfg(feature = "native")]
    #[test]
    fn a_read_in_bands_is_the_read_in_one_buffer() {
        fn block_on<F: Future>(future: F) -> F::Output {
            let mut future = std::pin::pin!(future);
            let mut cx = Context::from_waker(std::task::Waker::noop());
            loop {
                if let Poll::Ready(value) = future.as_mut().poll(&mut cx) {
                    return value;
                }
                std::thread::yield_now();
            }
        }
        let ctx = match block_on(GpuContext::headless()) {
            Ok(ctx) => ctx,
            Err(reason) => {
                eprintln!("skipped: no GPU for a readback test ({reason})");
                return;
            }
        };
        let (width, height) = (5u32, 7u32);
        let texture = ctx.device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let texels: Vec<u8> =
            (0..height).flat_map(|y| (0..width).flat_map(move |x| [x as u8, y as u8, 200, 255])).collect();
        ctx.queue.write_texture(
            texture.as_image_copy(),
            &texels,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(width * 4), rows_per_image: None },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );

        // A row pads to 256 bytes: two rows a band, then the odd one.
        let whole = block_on(read_texels_in_bands(&ctx, &texture, 0, 0, width, height, 4, BAND_BYTES));
        assert_eq!(whole.as_deref(), Ok(texels.as_slice()));
        let banded = block_on(read_texels_in_bands(&ctx, &texture, 0, 0, width, height, 4, 512));
        assert_eq!(banded.as_deref(), Ok(texels.as_slice()));

        // A rect that leaves the texture, split a row at a time.
        let around = block_on(read_texels_in_bands(&ctx, &texture, -1, 5, 3, 4, 4, 1)).expect("readback");
        let row = |y: u8| [[0, 0, 0, 0], [0, y, 200, 255], [1, y, 200, 255]].concat();
        assert_eq!(around, [row(5), row(6), vec![0; 12], vec![0; 12]].concat());
    }

    #[test]
    fn halves_convert_as_the_webgl_read_converts_floats() {
        let halves: Vec<u8> = [0.0f32, 1.0, 0.5, 2.0, -1.0, 128.0 / 255.0]
            .iter()
            .flat_map(|&v| f32_to_f16(v).to_le_bytes())
            .collect();
        assert_eq!(halves_to_u8(&halves), [0, 255, 128, 255, 0, 128]);
        assert_eq!(halves_to_u16(&halves)[..5], [0, 65535, 32768, 65535, 0]);
    }
}
