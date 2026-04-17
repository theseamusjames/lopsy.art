use web_sys::{WebGl2RenderingContext, WebGlTexture};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TextureHandle(pub usize);

struct TextureEntry {
    texture: WebGlTexture,
    width: u32,
    height: u32,
    in_use: bool,
}

/// Cap on the number of free entries kept around per (width,height) bucket.
/// Above this, released textures are queued for deletion instead of pooled.
/// Tuned for the common case: a few scratch textures per size are reused
/// repeatedly during paint strokes; long sessions don't accumulate orphans.
const MAX_FREE_PER_SIZE: usize = 4;

pub struct TexturePool {
    /// Slots are tombstoned with `None` after deletion so `TextureHandle`
    /// indices stay stable for the life of the pool.
    entries: Vec<Option<TextureEntry>>,
    /// Textures awaiting GL deletion. Drained at the start of `acquire`,
    /// where a `&WebGl2RenderingContext` is in scope.
    pending_deletions: Vec<WebGlTexture>,
    use_float: bool,
}

impl TexturePool {
    pub fn new(use_float: bool) -> Self {
        Self {
            entries: Vec::new(),
            pending_deletions: Vec::new(),
            use_float,
        }
    }

    /// Verify RGBA16F is actually renderable on this GPU.
    /// Some browsers report the extension but the FBO is incomplete.
    pub fn verify_float_renderable(gl: &WebGl2RenderingContext) -> bool {
        let tex = match gl.create_texture() {
            Some(t) => t,
            None => return false,
        };
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&tex));
        let _ = gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
            WebGl2RenderingContext::TEXTURE_2D,
            0,
            WebGl2RenderingContext::RGBA16F as i32,
            4, 4, 0,
            WebGl2RenderingContext::RGBA,
            WebGl2RenderingContext::FLOAT,
            None,
        );
        let fbo = match gl.create_framebuffer() {
            Some(f) => f,
            None => { gl.delete_texture(Some(&tex)); return false; }
        };
        gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
        gl.framebuffer_texture_2d(
            WebGl2RenderingContext::FRAMEBUFFER,
            WebGl2RenderingContext::COLOR_ATTACHMENT0,
            WebGl2RenderingContext::TEXTURE_2D,
            Some(&tex),
            0,
        );
        let status = gl.check_framebuffer_status(WebGl2RenderingContext::FRAMEBUFFER);
        gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
        gl.delete_framebuffer(Some(&fbo));
        gl.delete_texture(Some(&tex));
        status == WebGl2RenderingContext::FRAMEBUFFER_COMPLETE
    }

    pub fn use_float(&self) -> bool {
        self.use_float
    }

    fn internal_format(&self) -> i32 {
        if self.use_float {
            WebGl2RenderingContext::RGBA16F as i32
        } else {
            WebGl2RenderingContext::RGBA as i32
        }
    }

    fn pixel_type(&self) -> u32 {
        if self.use_float {
            WebGl2RenderingContext::FLOAT
        } else {
            WebGl2RenderingContext::UNSIGNED_BYTE
        }
    }

    /// Drain the pending-deletion queue. Called automatically at the start of
    /// `acquire`; can also be called manually (e.g., before sleep / unload).
    pub fn flush_deletions(&mut self, gl: &WebGl2RenderingContext) {
        for tex in self.pending_deletions.drain(..) {
            gl.delete_texture(Some(&tex));
        }
    }

    /// Free every GL resource held by the pool. Call once when tearing down
    /// the engine.
    pub fn destroy(&mut self, gl: &WebGl2RenderingContext) {
        self.flush_deletions(gl);
        for slot in self.entries.drain(..) {
            if let Some(entry) = slot {
                gl.delete_texture(Some(&entry.texture));
            }
        }
    }

    pub fn acquire(
        &mut self,
        gl: &WebGl2RenderingContext,
        width: u32,
        height: u32,
    ) -> Result<TextureHandle, String> {
        // Reclaim any GL textures freed since the last acquire.
        self.flush_deletions(gl);

        // Look for a free texture of matching size.
        for (i, slot) in self.entries.iter_mut().enumerate() {
            if let Some(entry) = slot {
                if !entry.in_use && entry.width == width && entry.height == height {
                    entry.in_use = true;
                    // Clear via temporary FBO (works for both RGBA8 and RGBA16F).
                    let fbo = gl.create_framebuffer().ok_or("Failed to create temp FBO for clear")?;
                    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
                    gl.framebuffer_texture_2d(
                        WebGl2RenderingContext::FRAMEBUFFER,
                        WebGl2RenderingContext::COLOR_ATTACHMENT0,
                        WebGl2RenderingContext::TEXTURE_2D,
                        Some(&entry.texture),
                        0,
                    );
                    gl.viewport(0, 0, width as i32, height as i32);
                    gl.clear_color(0.0, 0.0, 0.0, 0.0);
                    gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);
                    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
                    gl.delete_framebuffer(Some(&fbo));
                    return Ok(TextureHandle(i));
                }
            }
        }

        // Allocate a new texture.
        let texture = gl.create_texture().ok_or("Failed to create texture")?;
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&texture));
        gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
            WebGl2RenderingContext::TEXTURE_2D,
            0,
            self.internal_format(),
            width as i32,
            height as i32,
            0,
            WebGl2RenderingContext::RGBA,
            self.pixel_type(),
            None,
        ).map_err(|e| format!("tex_image_2d failed: {:?}", e))?;

        gl.tex_parameteri(
            WebGl2RenderingContext::TEXTURE_2D,
            WebGl2RenderingContext::TEXTURE_MIN_FILTER,
            WebGl2RenderingContext::LINEAR as i32,
        );
        gl.tex_parameteri(
            WebGl2RenderingContext::TEXTURE_2D,
            WebGl2RenderingContext::TEXTURE_MAG_FILTER,
            WebGl2RenderingContext::LINEAR as i32,
        );
        gl.tex_parameteri(
            WebGl2RenderingContext::TEXTURE_2D,
            WebGl2RenderingContext::TEXTURE_WRAP_S,
            WebGl2RenderingContext::CLAMP_TO_EDGE as i32,
        );
        gl.tex_parameteri(
            WebGl2RenderingContext::TEXTURE_2D,
            WebGl2RenderingContext::TEXTURE_WRAP_T,
            WebGl2RenderingContext::CLAMP_TO_EDGE as i32,
        );

        // Reuse a tombstoned slot if one exists, otherwise append.
        if let Some(idx) = self.entries.iter().position(|s| s.is_none()) {
            self.entries[idx] = Some(TextureEntry { texture, width, height, in_use: true });
            Ok(TextureHandle(idx))
        } else {
            let handle = TextureHandle(self.entries.len());
            self.entries.push(Some(TextureEntry { texture, width, height, in_use: true }));
            Ok(handle)
        }
    }

    /// Mark a texture as free. If the per-size free-pool is already saturated,
    /// the GL texture is queued for deletion (deleted on the next `acquire`).
    /// Idempotent — releasing the same handle twice or releasing a tombstoned
    /// slot is a no-op.
    pub fn release(&mut self, handle: TextureHandle) {
        let (w, h) = match self.entries.get(handle.0).and_then(|s| s.as_ref()) {
            Some(e) if e.in_use => (e.width, e.height),
            _ => return,
        };

        let same_size_free = self.entries.iter()
            .filter_map(|s| s.as_ref())
            .filter(|e| !e.in_use && e.width == w && e.height == h)
            .count();

        if same_size_free >= MAX_FREE_PER_SIZE {
            if let Some(entry) = self.entries[handle.0].take() {
                self.pending_deletions.push(entry.texture);
            }
        } else if let Some(entry) = self.entries.get_mut(handle.0).and_then(|s| s.as_mut()) {
            entry.in_use = false;
        }
    }

    pub fn get(&self, handle: TextureHandle) -> Option<&WebGlTexture> {
        self.entries.get(handle.0)
            .and_then(|s| s.as_ref())
            .map(|e| &e.texture)
    }

    pub fn get_size(&self, handle: TextureHandle) -> Option<(u32, u32)> {
        self.entries.get(handle.0)
            .and_then(|s| s.as_ref())
            .map(|e| (e.width, e.height))
    }

    /// Set NEAREST filtering on a texture (for system textures that are always
    /// sampled at exact texel centers — avoids interpolation precision issues).
    pub fn set_nearest_filter(&self, gl: &WebGl2RenderingContext, handle: TextureHandle) {
        if let Some(entry) = self.entries.get(handle.0).and_then(|s| s.as_ref()) {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&entry.texture));
            gl.tex_parameteri(
                WebGl2RenderingContext::TEXTURE_2D,
                WebGl2RenderingContext::TEXTURE_MIN_FILTER,
                WebGl2RenderingContext::NEAREST as i32,
            );
            gl.tex_parameteri(
                WebGl2RenderingContext::TEXTURE_2D,
                WebGl2RenderingContext::TEXTURE_MAG_FILTER,
                WebGl2RenderingContext::NEAREST as i32,
            );
        }
    }

    /// Upload u8 RGBA data to a texture, converting to f32 if using float textures.
    pub fn upload_rgba(
        &self,
        gl: &WebGl2RenderingContext,
        handle: TextureHandle,
        x: i32,
        y: i32,
        w: u32,
        h: u32,
        data: &[u8],
    ) -> Result<(), String> {
        let texture = self.get(handle).ok_or("Texture not found")?;
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(texture));

        if self.use_float {
            let f32_data: Vec<f32> = data.iter().map(|&b| b as f32 / 255.0).collect();
            tex_sub_image_2d_f32(gl, x, y, w, h, &f32_data)?;
        } else {
            gl.tex_sub_image_2d_with_i32_and_i32_and_u32_and_type_and_opt_u8_array(
                WebGl2RenderingContext::TEXTURE_2D,
                0, x, y,
                w as i32, h as i32,
                WebGl2RenderingContext::RGBA,
                WebGl2RenderingContext::UNSIGNED_BYTE,
                Some(data),
            ).map_err(|e| format!("tex_sub_image_2d failed: {:?}", e))?;
        }

        Ok(())
    }

    /// Upload f32 RGBA data directly, avoiding u8→f32 conversion for high-bit-depth sources.
    /// When the pool uses RGBA8 textures, clamps and quantizes to u8.
    pub fn upload_rgba_f32(
        &self,
        gl: &WebGl2RenderingContext,
        handle: TextureHandle,
        x: i32,
        y: i32,
        w: u32,
        h: u32,
        data: &[f32],
    ) -> Result<(), String> {
        let texture = self.get(handle).ok_or("Texture not found")?;
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(texture));

        if self.use_float {
            tex_sub_image_2d_f32(gl, x, y, w, h, data)?;
        } else {
            // Quantize f32 → u8 for RGBA8 textures.
            let u8_data: Vec<u8> = data.iter().map(|&v| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8).collect();
            gl.tex_sub_image_2d_with_i32_and_i32_and_u32_and_type_and_opt_u8_array(
                WebGl2RenderingContext::TEXTURE_2D,
                0, x, y,
                w as i32, h as i32,
                WebGl2RenderingContext::RGBA,
                WebGl2RenderingContext::UNSIGNED_BYTE,
                Some(&u8_data),
            ).map_err(|e| format!("tex_sub_image_2d failed: {:?}", e))?;
        }

        Ok(())
    }

    /// Upload pixels directly from an HtmlCanvasElement, avoiding the
    /// getImageData unpremultiply round-trip.
    pub fn upload_canvas(
        &self,
        gl: &WebGl2RenderingContext,
        handle: TextureHandle,
        canvas: &web_sys::HtmlCanvasElement,
        _w: u32,
        _h: u32,
    ) -> Result<(), String> {
        let texture = self.get(handle).ok_or("Texture not found")?;
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(texture));

        // UNPACK_PREMULTIPLY_ALPHA_WEBGL = false (default) so the browser
        // hands us straight-alpha data matching what upload_rgba provides.
        gl.pixel_storei(WebGl2RenderingContext::UNPACK_FLIP_Y_WEBGL, 0);

        if self.use_float {
            // For float textures: upload via texImage2D which converts u8→f16.
            gl.tex_image_2d_with_u32_and_u32_and_html_canvas_element(
                WebGl2RenderingContext::TEXTURE_2D,
                0,
                WebGl2RenderingContext::RGBA16F as i32,
                WebGl2RenderingContext::RGBA,
                WebGl2RenderingContext::FLOAT,
                canvas,
            ).map_err(|e| format!("tex_image_2d canvas float failed: {:?}", e))?;
        } else {
            gl.tex_sub_image_2d_with_u32_and_u32_and_html_canvas_element(
                WebGl2RenderingContext::TEXTURE_2D,
                0, 0, 0,
                WebGl2RenderingContext::RGBA,
                WebGl2RenderingContext::UNSIGNED_BYTE,
                canvas,
            ).map_err(|e| format!("tex_sub_image_2d canvas failed: {:?}", e))?;
        }

        Ok(())
    }

    /// Read pixels from the currently-bound FBO as u8 RGBA.
    /// Handles float→u8 conversion when using RGBA16F textures.
    pub fn read_rgba(
        &self,
        gl: &WebGl2RenderingContext,
        x: i32,
        y: i32,
        w: u32,
        h: u32,
    ) -> Result<Vec<u8>, String> {
        let count = (w * h * 4) as usize;

        if self.use_float {
            let f32_buf = js_sys::Float32Array::new_with_length(count as u32);
            gl.read_pixels_with_opt_array_buffer_view(
                x, y,
                w as i32, h as i32,
                WebGl2RenderingContext::RGBA,
                WebGl2RenderingContext::FLOAT,
                Some(&f32_buf),
            ).map_err(|e| format!("readPixels float failed: {:?}", e))?;
            let mut f32_data = vec![0f32; count];
            f32_buf.copy_to(&mut f32_data);
            let pixels: Vec<u8> = f32_data
                .iter()
                .map(|&v| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8)
                .collect();
            Ok(pixels)
        } else {
            let mut pixels = vec![0u8; count];
            gl.read_pixels_with_opt_u8_array(
                x, y,
                w as i32, h as i32,
                WebGl2RenderingContext::RGBA,
                WebGl2RenderingContext::UNSIGNED_BYTE,
                Some(&mut pixels),
            ).map_err(|e| format!("readPixels failed: {:?}", e))?;
            Ok(pixels)
        }
    }
}

/// SAFETY-scoped wrapper around `tex_sub_image_2d` for f32 data.
/// `Float32Array::view` returns a borrow into wasm linear memory; this helper
/// keeps the view's lifetime bounded by a single function body, so no
/// intervening allocation can relocate the underlying buffer between view
/// creation and the GL call. Lifting this out of the call sites makes the
/// safety guarantee structural rather than commented-only.
fn tex_sub_image_2d_f32(
    gl: &WebGl2RenderingContext,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    data: &[f32],
) -> Result<(), String> {
    // SAFETY: `view` is consumed by the GL call within this function body
    // before any allocation can occur — wasm memory cannot be relocated.
    let view = unsafe { js_sys::Float32Array::view(data) };
    gl.tex_sub_image_2d_with_i32_and_i32_and_u32_and_type_and_array_buffer_view_and_src_offset(
        WebGl2RenderingContext::TEXTURE_2D,
        0, x, y,
        w as i32, h as i32,
        WebGl2RenderingContext::RGBA,
        WebGl2RenderingContext::FLOAT,
        &view,
        0,
    ).map_err(|e| format!("tex_sub_image_2d float failed: {:?}", e))
}
