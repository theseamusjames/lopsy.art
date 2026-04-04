use web_sys::{WebGl2RenderingContext, WebGlTexture};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TextureHandle(pub usize);

struct TextureEntry {
    texture: WebGlTexture,
    width: u32,
    height: u32,
    in_use: bool,
}

pub struct TexturePool {
    entries: Vec<TextureEntry>,
    use_float: bool,
}

impl TexturePool {
    pub fn new(use_float: bool) -> Self {
        Self { entries: Vec::new(), use_float }
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

    pub fn acquire(
        &mut self,
        gl: &WebGl2RenderingContext,
        width: u32,
        height: u32,
    ) -> Result<TextureHandle, String> {
        // Look for a free texture of matching size
        for (i, entry) in self.entries.iter_mut().enumerate() {
            if !entry.in_use && entry.width == width && entry.height == height {
                entry.in_use = true;
                // Clear via temporary FBO (works for both RGBA8 and RGBA16F)
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

        // Allocate new texture
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

        let handle = TextureHandle(self.entries.len());
        self.entries.push(TextureEntry {
            texture,
            width,
            height,
            in_use: true,
        });

        Ok(handle)
    }

    pub fn release(&mut self, handle: TextureHandle) {
        if let Some(entry) = self.entries.get_mut(handle.0) {
            entry.in_use = false;
        }
    }

    pub fn get(&self, handle: TextureHandle) -> Option<&WebGlTexture> {
        self.entries.get(handle.0).map(|e| &e.texture)
    }

    pub fn get_size(&self, handle: TextureHandle) -> Option<(u32, u32)> {
        self.entries.get(handle.0).map(|e| (e.width, e.height))
    }

    /// Set NEAREST filtering on a texture (for system textures that are always
    /// sampled at exact texel centers — avoids interpolation precision issues).
    pub fn set_nearest_filter(&self, gl: &WebGl2RenderingContext, handle: TextureHandle) {
        if let Some(entry) = self.entries.get(handle.0) {
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
            // SAFETY: Float32Array view used immediately in the GL call with no
            // intervening allocations that could relocate wasm memory.
            let view = unsafe { js_sys::Float32Array::view(&f32_data) };
            gl.tex_sub_image_2d_with_i32_and_i32_and_u32_and_type_and_array_buffer_view_and_src_offset(
                WebGl2RenderingContext::TEXTURE_2D,
                0, x, y,
                w as i32, h as i32,
                WebGl2RenderingContext::RGBA,
                WebGl2RenderingContext::FLOAT,
                &view,
                0,
            ).map_err(|e| format!("tex_sub_image_2d float failed: {:?}", e))?;
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
            // Upload f32 data directly — no conversion needed
            let view = unsafe { js_sys::Float32Array::view(data) };
            gl.tex_sub_image_2d_with_i32_and_i32_and_u32_and_type_and_array_buffer_view_and_src_offset(
                WebGl2RenderingContext::TEXTURE_2D,
                0, x, y,
                w as i32, h as i32,
                WebGl2RenderingContext::RGBA,
                WebGl2RenderingContext::FLOAT,
                &view,
                0,
            ).map_err(|e| format!("tex_sub_image_2d float failed: {:?}", e))?;
        } else {
            // Quantize f32 → u8 for RGBA8 textures
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
        w: u32,
        h: u32,
    ) -> Result<(), String> {
        let texture = self.get(handle).ok_or("Texture not found")?;
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(texture));

        // UNPACK_PREMULTIPLY_ALPHA_WEBGL = false (default) so the browser
        // hands us straight-alpha data matching what upload_rgba provides.
        gl.pixel_storei(WebGl2RenderingContext::UNPACK_FLIP_Y_WEBGL, 0);

        if self.use_float {
            // For float textures: upload via texImage2D which converts u8→f16
            gl.tex_image_2d_with_u32_and_u32_and_html_canvas_element(
                WebGl2RenderingContext::TEXTURE_2D,
                0,
                WebGl2RenderingContext::RGBA16F as i32,
                WebGl2RenderingContext::RGBA,
                WebGl2RenderingContext::FLOAT,
                canvas,
            ).map_err(|e| format!("tex_image_2d canvas float failed: {:?}", e))?;

            // Resize entry if needed
            if let Some(entry) = self.entries.get(handle.0) {
                if entry.width != w || entry.height != h {
                    // entry is immutable here; sizes are already correct
                    // from the acquire/resize step in the caller
                }
            }
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
