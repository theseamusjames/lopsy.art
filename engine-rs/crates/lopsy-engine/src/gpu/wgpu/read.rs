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
    let len = w as usize * h as usize * bytes_per_texel as usize;
    let copy = inside(x, y, w, h, texture.width(), texture.height()).map(|area| {
        let padded_row = (area.w * bytes_per_texel).next_multiple_of(ROW_ALIGNMENT);
        let buffer = ctx.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: u64::from(padded_row) * u64::from(area.h),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = ctx.device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d { x: area.x, y: area.y, z: 0 },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(padded_row), rows_per_image: None },
            },
            wgpu::Extent3d { width: area.w, height: area.h, depth_or_array_layers: 1 },
        );
        ctx.queue.submit([encoder.finish()]);
        let mapped = map(ctx, &buffer);
        (area, padded_row as usize, buffer, mapped)
    });

    async move {
        let mut texels = vec![0u8; len];
        let Some((area, padded_row, buffer, mapped)) = copy else {
            return Ok(texels);
        };
        mapped.await?;
        {
            let view = buffer.get_mapped_range(..).map_err(|e| format!("Readback failed: {e}"))?;
            let texel = bytes_per_texel as usize;
            let row_len = area.w as usize * texel;
            for row in 0..area.h as usize {
                let from = row * padded_row;
                let to = ((area.dy as usize + row) * w as usize + area.dx as usize) * texel;
                texels[to..to + row_len].copy_from_slice(&view[from..from + row_len]);
            }
        }
        buffer.unmap();
        buffer.destroy();
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
    fn halves_convert_as_the_webgl_read_converts_floats() {
        let halves: Vec<u8> = [0.0f32, 1.0, 0.5, 2.0, -1.0, 128.0 / 255.0]
            .iter()
            .flat_map(|&v| f32_to_f16(v).to_le_bytes())
            .collect();
        assert_eq!(halves_to_u8(&halves), [0, 255, 128, 255, 0, 128]);
        assert_eq!(halves_to_u16(&halves)[..5], [0, 65535, 32768, 65535, 0]);
    }
}
