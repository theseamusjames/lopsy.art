use std::cell::RefCell;
use std::sync::Arc;

use web_sys::HtmlCanvasElement;

use super::framebuffer::FramebufferPool;
use super::program::Linker;
use super::texture_pool::TexturePool;
use crate::host::{self, LogLevel};

pub struct GpuContext {
    /// The device and its queue. Nothing outside `gpu/` can reach them:
    /// feature code draws through `gpu::pass` and allocates through the
    /// pools.
    pub(in crate::gpu) device: wgpu::Device,
    pub(in crate::gpu) queue: wgpu::Queue,
    screen: Screen,
    pub has_half_float: bool,
    pub has_float_blend: bool,
}

/// The canvas the engine presents to and the frame being drawn into it.
struct Screen {
    canvas: HtmlCanvasElement,
    surface: wgpu::Surface<'static>,
    config: RefCell<wgpu::SurfaceConfiguration>,
    /// The surface texture for the frame in progress, from the first screen
    /// pass until `present`.
    frame: RefCell<Option<wgpu::SurfaceTexture>>,
}

/// Where a screen pass draws, and whether it is the first into this frame:
/// the first one has nothing to keep and starts from a cleared texture.
pub(in crate::gpu) struct ScreenTarget {
    pub(in crate::gpu) view: wgpu::TextureView,
    pub(in crate::gpu) is_first_pass: bool,
}

impl GpuContext {
    /// WebGPU hands out its adapter and device through promises, so unlike
    /// the WebGL context this one is made asynchronously.
    pub async fn new(canvas: &HtmlCanvasElement) -> Result<Self, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let surface = canvas_surface(&instance, canvas)?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                compatible_surface: Some(&surface),
                ..Default::default()
            })
            .await
            .map_err(|e| format!("WebGPU adapter: {e}"))?;

        // WebGPU's default limit is 8192, below what the same GPU allows
        // through WebGL. Ask for everything the adapter offers.
        let max_texture_size = adapter.limits().max_texture_dimension_2d;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                required_limits: wgpu::Limits {
                    max_texture_dimension_2d: max_texture_size,
                    ..wgpu::Limits::default()
                },
                ..Default::default()
            })
            .await
            .map_err(|e| format!("WebGPU device: {e}"))?;
        device.on_uncaptured_error(Arc::new(|error| {
            host::log(LogLevel::Error, &format!("[Lopsy GPU] {error}"));
        }));

        let (width, height) = canvas_size(canvas);
        let mut config = surface
            .get_default_config(&adapter, width, height)
            .ok_or("The WebGPU adapter cannot draw to this canvas")?;
        // A WebGL canvas is premultiplied unless asked otherwise, and the
        // final blit writes the alpha the page shows through. wgpu lists
        // only `Opaque` for a canvas but configures it with this one.
        config.alpha_mode = wgpu::CompositeAlphaMode::PreMultiplied;
        surface.configure(&device, &config);

        host::log(
            LogLevel::Info,
            &format!(
                "[Lopsy GPU] wgpu {:?}: surface {:?} {:?}, max texture {max_texture_size}",
                adapter.get_info().backend,
                config.format,
                config.alpha_mode,
            ),
        );

        Ok(Self {
            device,
            queue,
            screen: Screen {
                canvas: canvas.clone(),
                surface,
                config: RefCell::new(config),
                frame: RefCell::new(None),
            },
            // WebGPU requires `rgba16float` to be renderable, blendable and
            // filterable, so there is nothing to probe.
            has_half_float: true,
            has_float_blend: true,
        })
    }

    /// The texture and framebuffer pools for this context.
    pub fn create_pools(&self) -> (TexturePool, FramebufferPool) {
        (
            TexturePool::new(&self.device, &self.queue, self.has_half_float, self.max_texture_size()),
            FramebufferPool::new(),
        )
    }

    /// What compiles this context's shaders.
    pub(in crate::gpu) fn linker(&self) -> Linker {
        Linker::new(&self.device)
    }

    /// Largest texture edge the device accepts.
    pub fn max_texture_size(&self) -> u32 {
        self.device.limits().max_texture_dimension_2d
    }

    /// Size of the canvas in device pixels.
    pub(in crate::gpu) fn screen_size(&self) -> (u32, u32) {
        canvas_size(&self.screen.canvas)
    }

    /// The view a screen pass draws into, starting a frame if none is in
    /// progress. `None` when the surface has no texture to give, which
    /// skips the frame.
    pub(in crate::gpu) fn screen_target(&self) -> Option<ScreenTarget> {
        let screen = &self.screen;
        let mut frame = screen.frame.borrow_mut();
        let is_first_pass = frame.is_none();
        if is_first_pass {
            screen.resize_to_canvas(&self.device);
            *frame = Some(screen.acquire()?);
        }
        let view = frame.as_ref()?.texture.create_view(&wgpu::TextureViewDescriptor::default());
        Some(ScreenTarget { view, is_first_pass })
    }

    /// Hand the frame in progress, if any, to the canvas.
    pub(in crate::gpu) fn present(&self) {
        if let Some(frame) = self.screen.frame.borrow_mut().take() {
            self.queue.present(frame);
        }
    }
}

impl Screen {
    /// A surface keeps the size it was configured with; the canvas is
    /// resized from JS without telling the engine.
    fn resize_to_canvas(&self, device: &wgpu::Device) {
        let (width, height) = canvas_size(&self.canvas);
        let mut config = self.config.borrow_mut();
        if (config.width, config.height) == (width, height) {
            return;
        }
        config.width = width;
        config.height = height;
        self.surface.configure(device, &config);
    }

    fn acquire(&self) -> Option<wgpu::SurfaceTexture> {
        match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => Some(frame),
            other => {
                host::log(LogLevel::Warn, &format!("[Lopsy GPU] no surface texture: {other:?}"));
                None
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
fn canvas_surface(instance: &wgpu::Instance, canvas: &HtmlCanvasElement) -> Result<wgpu::Surface<'static>, String> {
    instance
        .create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone()))
        .map_err(|e| format!("WebGPU surface: {e}"))
}

/// `cargo test` builds this backend for the machine it runs on, where no
/// canvas exists. The native host (6.10) will draw without a surface.
#[cfg(not(target_arch = "wasm32"))]
fn canvas_surface(_instance: &wgpu::Instance, _canvas: &HtmlCanvasElement) -> Result<wgpu::Surface<'static>, String> {
    Err("A canvas surface exists only in the browser".into())
}

/// A surface cannot be zero-sized, which a canvas is while it is hidden.
fn canvas_size(canvas: &HtmlCanvasElement) -> (u32, u32) {
    (canvas.width().max(1), canvas.height().max(1))
}
