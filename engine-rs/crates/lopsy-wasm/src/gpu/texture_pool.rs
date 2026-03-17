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
}

impl TexturePool {
    pub fn new() -> Self {
        Self { entries: Vec::new() }
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
                // Clear to zero
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&entry.texture));
                let zeros = vec![0u8; (width * height * 4) as usize];
                gl.tex_sub_image_2d_with_i32_and_i32_and_u32_and_type_and_opt_u8_array(
                    WebGl2RenderingContext::TEXTURE_2D,
                    0, 0, 0,
                    width as i32, height as i32,
                    WebGl2RenderingContext::RGBA,
                    WebGl2RenderingContext::UNSIGNED_BYTE,
                    Some(&zeros),
                ).map_err(|e| format!("tex_sub_image_2d failed: {:?}", e))?;
                return Ok(TextureHandle(i));
            }
        }

        // Allocate new texture
        let texture = gl.create_texture().ok_or("Failed to create texture")?;
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&texture));
        gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
            WebGl2RenderingContext::TEXTURE_2D,
            0,
            WebGl2RenderingContext::RGBA as i32,
            width as i32,
            height as i32,
            0,
            WebGl2RenderingContext::RGBA,
            WebGl2RenderingContext::UNSIGNED_BYTE,
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
}
