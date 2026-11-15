use crate::gpu::uniforms::{UniformSink, UniformType};

/// A fragment shader ready to draw with.
pub(in crate::gpu) struct LinkedProgram {
    module: wgpu::ShaderModule,
}

/// What a uniform struct's values are handed to. No pass draws yet, so they
/// are not kept.
pub(in crate::gpu) struct ParamSink;

impl UniformSink for ParamSink {
    fn floats(&mut self, _ty: UniformType, _values: &[f32]) {}

    fn ints(&mut self, _ty: UniformType, _values: &[i32]) {}
}

/// Compiles fragment shaders for one device.
#[derive(Clone)]
pub(in crate::gpu) struct Linker {
    device: wgpu::Device,
}

impl Linker {
    pub(in crate::gpu) fn new(device: &wgpu::Device) -> Self {
        Self { device: device.clone() }
    }

    pub(in crate::gpu) fn link(&self, frag_src: &str) -> Result<LinkedProgram, String> {
        let module = self.device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: None,
            source: wgpu::ShaderSource::Wgsl(frag_src.into()),
        });
        Ok(LinkedProgram { module })
    }
}
