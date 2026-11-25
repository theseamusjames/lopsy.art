//! Reads on WebGL that do not wait for the GPU.
//!
//! A plain `readPixels` blocks until the GPU has finished everything queued
//! before it. Right after a heavy submit (an undo's restore and recomposite,
//! the last composite of a stroke) a 24×24 thumbnail read paid for that whole
//! backlog: hundreds of milliseconds where the same read settled took a few
//! (#1767). No main-thread scheduling can tell when the GPU is done; a fence
//! can.
//!
//! Inside [`deferred`], a pass's readback copies into a pixel-pack buffer,
//! which queues the copy instead of stalling, and drops a fence behind it.
//! The [`Read`] stays pending until the fence has signalled; each pending
//! poll leaves a promise that resolves on the next animation frame
//! ([`take_waiting_on`]), and the host polls again then. Outside
//! [`deferred`] every read answers at once, as engine code that reads in the
//! middle of a command expects.

use std::cell::{Cell, RefCell};
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

use wasm_bindgen::{JsCast, JsValue};
use web_sys::{WebGl2RenderingContext as GL, WebGlBuffer, WebGlSync};

use crate::gpu::read::Read;

thread_local! {
    static IS_DEFERRING: Cell<bool> = const { Cell::new(false) };
    /// The promise the last pending poll is waiting for.
    static WAITING_ON: RefCell<Option<js_sys::Promise>> = const { RefCell::new(None) };
}

/// Run `start` with the reads it begins answering when the GPU has caught
/// up, not at once. Only for a command whose export hands a pending read to
/// the host (`deferred_readback_export!`) and that does nothing with the
/// pixels inside the engine before they arrive.
pub fn deferred<R>(start: impl FnOnce() -> R) -> R {
    let was = IS_DEFERRING.with(|d| d.replace(true));
    let result = start();
    IS_DEFERRING.with(|d| d.set(was));
    result
}

pub(super) fn is_deferring() -> bool {
    IS_DEFERRING.with(Cell::get)
}

/// The promise that resolves when a pending read is worth polling again:
/// after a task's poll returns pending, the host awaits this and polls.
pub fn take_waiting_on() -> Option<js_sys::Promise> {
    WAITING_ON.with(|waiting| waiting.borrow_mut().take())
}

/// A promise that resolves on the next animation frame, or after a zero
/// timeout where there is no window.
fn next_frame() -> js_sys::Promise {
    js_sys::Promise::new(&mut |resolve, _reject| {
        let scheduled = web_sys::window().map(|w| w.request_animation_frame(&resolve).is_ok());
        if scheduled != Some(true) {
            let global: JsValue = js_sys::global().into();
            if let Ok(set_timeout) = js_sys::Reflect::get(&global, &"setTimeout".into()) {
                if let Some(set_timeout) = set_timeout.dyn_ref::<js_sys::Function>() {
                    let _ = set_timeout.call2(&global, &resolve, &JsValue::from(0));
                }
            }
        }
    })
}

/// Start copying `w × h` texels of the bound read framebuffer into a pack
/// buffer, as `format`/`ty` with `len` bytes in all. `None` if the buffer,
/// the copy or the fence cannot be made; nothing is left allocated then.
pub(super) fn read_pixels_later(gl: &GL, w: u32, h: u32, format: u32, ty: u32, len: usize) -> Option<Read<Vec<u8>>> {
    let buffer = gl.create_buffer()?;
    gl.bind_buffer(GL::PIXEL_PACK_BUFFER, Some(&buffer));
    gl.buffer_data_with_i32(GL::PIXEL_PACK_BUFFER, len as i32, GL::STREAM_READ);
    let is_copied = gl.read_pixels_with_i32(0, 0, w as i32, h as i32, format, ty, 0).is_ok();
    gl.bind_buffer(GL::PIXEL_PACK_BUFFER, None);
    let sync = if is_copied { gl.fence_sync(GL::SYNC_GPU_COMMANDS_COMPLETE, 0) } else { None };
    let Some(sync) = sync else {
        gl.delete_buffer(Some(&buffer));
        return None;
    };
    // A fence only signals once the commands before it reach the GPU.
    gl.flush();
    Some(Read::later(Fenced { gl: gl.clone(), objects: Some((buffer, sync)), len }))
}

/// Waits for a fence, then copies the pack buffer out.
struct Fenced {
    gl: GL,
    /// Taken (and deleted) once the read has answered.
    objects: Option<(WebGlBuffer, WebGlSync)>,
    len: usize,
}

impl Fenced {
    fn release(&mut self) {
        if let Some((buffer, sync)) = self.objects.take() {
            self.gl.delete_sync(Some(&sync));
            self.gl.delete_buffer(Some(&buffer));
        }
    }
}

impl Future for Fenced {
    type Output = Result<Vec<u8>, String>;

    fn poll(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.get_mut();
        let Some((buffer, sync)) = this.objects.as_ref() else {
            return Poll::Ready(Err("Readback was already taken".into()));
        };
        if this.gl.is_context_lost() {
            // The context's objects are gone with it; nothing to delete.
            this.objects = None;
            return Poll::Ready(Err("WebGL context lost during a readback".into()));
        }
        match this.gl.client_wait_sync_with_u32(sync, 0, 0) {
            GL::ALREADY_SIGNALED | GL::CONDITION_SATISFIED => {
                let mut pixels = vec![0u8; this.len];
                this.gl.bind_buffer(GL::PIXEL_PACK_BUFFER, Some(buffer));
                this.gl.get_buffer_sub_data_with_i32_and_u8_array(GL::PIXEL_PACK_BUFFER, 0, &mut pixels);
                this.gl.bind_buffer(GL::PIXEL_PACK_BUFFER, None);
                this.release();
                Poll::Ready(Ok(pixels))
            }
            GL::WAIT_FAILED => {
                this.release();
                Poll::Ready(Err("Readback fence failed".into()))
            }
            _ => {
                WAITING_ON.with(|waiting| *waiting.borrow_mut() = Some(next_frame()));
                Poll::Pending
            }
        }
    }
}

impl Drop for Fenced {
    fn drop(&mut self) {
        if !self.gl.is_context_lost() {
            self.release();
        }
    }
}
