//! wgpu programs: a fragment shader module with the layout its resources
//! bind through, the render pipelines made from it, and the packing of a
//! uniform struct into the bytes of the shader's `Params`.
//!
//! The build script opens each shader's WGSL with one comment line of
//! reflection (`lopsy_shaderc::Reflection::header`): the size and member
//! offsets of `Params`, and every texture and sampler the shader declares.
//! [`Linker::link`] reads it back, so nothing parses WGSL at run time.

use std::cell::RefCell;
use std::collections::HashMap;
use std::num::NonZeroU64;
use std::rc::Rc;

use crate::gpu::pass::Blend;
use crate::gpu::uniforms::{UniformSink, UniformType};

/// The vertex stage every program shares: one triangle that covers the
/// viewport, with `uv` running 0 to 1 across it.
///
/// `quad` places the triangle. For a texture target `scale.y` is -1: WebGPU
/// puts row 0 of a render target at the top of clip space and WebGL at the
/// bottom, and flipping the triangle keeps texel (0, 0) under `uv` (0, 0)
/// on both. The screen keeps y up, as on WebGL. A viewport that reaches
/// outside its target cannot be set on WebGPU; the pass then draws with the
/// whole target as viewport and `quad` shrinks and moves the triangle to
/// where the viewport would have put it.
const VERTEX_SHADER: &str = r#"
struct Quad {
    scale: vec2<f32>,
    offset: vec2<f32>,
}
@group(1) @binding(0) var<uniform> quad: Quad;

struct VsOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VsOut {
    let id = i32(index);
    let x = f32((id & 1) << 2u) - 1.0;
    let y = f32((id & 2) << 1u) - 1.0;
    var out: VsOut;
    out.uv = vec2<f32>(x * 0.5 + 0.5, y * 0.5 + 0.5);
    out.position = vec4<f32>(vec2<f32>(x, y) * quad.scale + quad.offset, 0.0, 1.0);
    return out;
}
"#;

/// Byte size of the vertex stage's `Quad`.
pub(in crate::gpu) const QUAD_SIZE: u64 = 16;

/// Fills what it draws with one colour: a clear that honours a scissor,
/// which a WebGPU render pass's own clear does not.
const FILL_SHADER: &str = "//#reflect size=16 members=u_color:0 bindings=
struct Params {
    u_color: vec4<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;

@fragment
fn fs_main() -> @location(0) vec4<f32> {
    return params.u_color;
}
";

const REFLECTION_PREFIX: &str = "//#reflect ";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::gpu) enum BindingKind {
    Texture,
    /// A sampler, and the binding of the texture it is named after
    /// (`u_tex_sampler` samples `u_tex`), if the shader declares one.
    Sampler { texture: Option<u32> },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::gpu) struct Binding {
    pub(in crate::gpu) index: u32,
    pub(in crate::gpu) kind: BindingKind,
    pub(in crate::gpu) name: String,
}

/// A shader's `@group(0)` resources.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(in crate::gpu) struct Reflection {
    /// Byte size of `Params`; 0 for a shader without one.
    pub(in crate::gpu) params_size: u32,
    /// Each `Params` member and its byte offset.
    pub(in crate::gpu) members: Vec<(String, u32)>,
    pub(in crate::gpu) bindings: Vec<Binding>,
}

impl Reflection {
    /// Read the reflection line that opens a shader's source.
    pub(in crate::gpu) fn parse(source: &str) -> Result<Self, String> {
        let line = source.lines().next().unwrap_or("");
        let fields = line.strip_prefix(REFLECTION_PREFIX).ok_or("shader source does not open with its reflection")?;
        let mut reflection = Reflection::default();
        for field in fields.split_whitespace() {
            let (key, value) = field.split_once('=').ok_or_else(|| format!("unreadable reflection field `{field}`"))?;
            match key {
                "size" => reflection.params_size = value.parse().map_err(|_| format!("unreadable size `{value}`"))?,
                "members" => {
                    for member in value.split(',').filter(|m| !m.is_empty()) {
                        let (name, offset) = member.split_once(':').ok_or_else(|| format!("unreadable member `{member}`"))?;
                        let offset = offset.parse().map_err(|_| format!("unreadable offset in `{member}`"))?;
                        reflection.members.push((name.to_string(), offset));
                    }
                }
                "bindings" => {
                    for binding in value.split(',').filter(|b| !b.is_empty()) {
                        let mut parts = binding.splitn(3, ':');
                        let (Some(index), Some(kind), Some(name)) = (parts.next(), parts.next(), parts.next()) else {
                            return Err(format!("unreadable binding `{binding}`"));
                        };
                        let index = index.parse().map_err(|_| format!("unreadable index in `{binding}`"))?;
                        let kind = match kind {
                            "t" => BindingKind::Texture,
                            "s" => BindingKind::Sampler { texture: None },
                            _ => return Err(format!("unknown binding kind in `{binding}`")),
                        };
                        reflection.bindings.push(Binding { index, kind, name: name.to_string() });
                    }
                }
                _ => return Err(format!("unknown reflection field `{key}`")),
            }
        }
        reflection.pair_samplers();
        Ok(reflection)
    }

    fn pair_samplers(&mut self) {
        let textures: Vec<(String, u32)> = self
            .bindings
            .iter()
            .filter(|b| b.kind == BindingKind::Texture)
            .map(|b| (format!("{}_sampler", b.name), b.index))
            .collect();
        for binding in &mut self.bindings {
            if let BindingKind::Sampler { texture } = &mut binding.kind {
                *texture = textures.iter().find(|(sampler, _)| *sampler == binding.name).map(|(_, index)| *index);
            }
        }
    }

    /// The binding of the texture named `name`.
    pub(in crate::gpu) fn texture_binding(&self, name: &str) -> Option<u32> {
        self.bindings.iter().find(|b| b.kind == BindingKind::Texture && b.name == name).map(|b| b.index)
    }
}

/// What every program on a device shares.
struct Shared {
    device: wgpu::Device,
    vertex: wgpu::ShaderModule,
    /// Layout of `@group(1)`, the vertex stage's `Quad`.
    quad_layout: wgpu::BindGroupLayout,
}

/// A fragment shader ready to draw with.
pub(in crate::gpu) struct LinkedProgram {
    shared: Rc<Shared>,
    module: wgpu::ShaderModule,
    pub(in crate::gpu) reflection: Reflection,
    pub(in crate::gpu) layout: wgpu::BindGroupLayout,
    pipeline_layout: wgpu::PipelineLayout,
    /// One pipeline per blend and target format the program has drawn with.
    pipelines: RefCell<HashMap<(u8, wgpu::TextureFormat), wgpu::RenderPipeline>>,
}

impl LinkedProgram {
    /// The pipeline that draws this program with `blend` into a target of
    /// `format`, made the first time it is asked for.
    pub(in crate::gpu) fn pipeline(&self, blend: Blend, format: wgpu::TextureFormat) -> wgpu::RenderPipeline {
        let key = (blend_key(blend), format);
        if let Some(pipeline) = self.pipelines.borrow().get(&key) {
            return pipeline.clone();
        }
        let pipeline = self.shared.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None,
            layout: Some(&self.pipeline_layout),
            vertex: wgpu::VertexState {
                module: &self.shared.vertex,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &self.module,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: blend_state(blend),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        self.pipelines.borrow_mut().insert(key, pipeline.clone());
        pipeline
    }
}

fn blend_key(blend: Blend) -> u8 {
    match blend {
        Blend::Off => 0,
        Blend::PremulOver => 1,
        Blend::Max => 2,
        Blend::OverKeepAlpha => 3,
    }
}

/// The same equations the WebGL backend sets (`gpu/webgl/pass.rs`).
fn blend_state(blend: Blend) -> Option<wgpu::BlendState> {
    use wgpu::{BlendComponent, BlendFactor, BlendOperation};
    let component = |src_factor, dst_factor, operation| BlendComponent { src_factor, dst_factor, operation };
    match blend {
        Blend::Off => None,
        Blend::PremulOver => {
            let over = component(BlendFactor::One, BlendFactor::OneMinusSrcAlpha, BlendOperation::Add);
            Some(wgpu::BlendState { color: over, alpha: over })
        }
        Blend::Max => {
            let max = component(BlendFactor::One, BlendFactor::One, BlendOperation::Max);
            Some(wgpu::BlendState { color: max, alpha: max })
        }
        Blend::OverKeepAlpha => Some(wgpu::BlendState {
            color: component(BlendFactor::SrcAlpha, BlendFactor::OneMinusSrcAlpha, BlendOperation::Add),
            alpha: component(BlendFactor::Zero, BlendFactor::One, BlendOperation::Add),
        }),
    }
}

/// Packs a uniform struct's values into the bytes of a WGSL `Params`
/// struct, by the layout `uniforms::wgsl_layout` describes.
pub(in crate::gpu) struct ParamSink<'a> {
    bytes: &'a mut Vec<u8>,
    end: usize,
    align: usize,
}

impl<'a> ParamSink<'a> {
    /// Run `put` and leave the packed struct in `bytes`.
    pub(in crate::gpu) fn pack(bytes: &'a mut Vec<u8>, put: &dyn Fn(&mut ParamSink)) {
        bytes.clear();
        let mut sink = ParamSink { bytes, end: 0, align: 1 };
        put(&mut sink);
        let size = sink.end.next_multiple_of(sink.align);
        sink.bytes.resize(size, 0);
    }

    /// Make room for a member of type `ty` and return where it starts.
    fn place(&mut self, ty: UniformType) -> usize {
        let (align, size) = ty.wgsl_align_and_size();
        let offset = self.end.next_multiple_of(align as usize);
        self.end = offset + size as usize;
        self.align = self.align.max(align as usize);
        self.bytes.resize(self.end, 0);
        offset
    }

    fn write(&mut self, offset: usize, words: impl Iterator<Item = [u8; 4]>) {
        for (slot, word) in self.bytes[offset..].chunks_exact_mut(4).zip(words) {
            slot.copy_from_slice(&word);
        }
    }
}

impl UniformSink for ParamSink<'_> {
    fn floats(&mut self, ty: UniformType, values: &[f32]) {
        let offset = self.place(ty);
        match ty {
            // Each vec3 column sits in a 16-byte slot.
            UniformType::Mat3 => {
                for (column, values) in values.chunks_exact(3).enumerate() {
                    self.write(offset + column * 16, values.iter().map(|v| v.to_le_bytes()));
                }
            }
            _ => self.write(offset, values.iter().map(|v| v.to_le_bytes())),
        }
    }

    fn ints(&mut self, ty: UniformType, values: &[i32]) {
        let offset = self.place(ty);
        self.write(offset, values.iter().map(|v| v.to_le_bytes()));
    }
}

/// Compiles fragment shaders for one device.
#[derive(Clone)]
pub(in crate::gpu) struct Linker {
    shared: Rc<Shared>,
}

impl Linker {
    pub(in crate::gpu) fn new(device: &wgpu::Device) -> Self {
        let vertex = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("fullscreen triangle"),
            source: wgpu::ShaderSource::Wgsl(VERTEX_SHADER.into()),
        });
        let quad_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: uniform_binding(QUAD_SIZE),
                count: None,
            }],
        });
        Self { shared: Rc::new(Shared { device: device.clone(), vertex, quad_layout }) }
    }

    /// Layout of the bind group that holds the vertex stage's `Quad`.
    pub(in crate::gpu) fn quad_layout(&self) -> &wgpu::BindGroupLayout {
        &self.shared.quad_layout
    }

    /// The program behind clears that cover part of a target.
    pub(in crate::gpu) fn link_fill(&self) -> Result<LinkedProgram, String> {
        self.link(FILL_SHADER)
    }

    pub(in crate::gpu) fn link(&self, frag_src: &str) -> Result<LinkedProgram, String> {
        let reflection = Reflection::parse(frag_src)?;
        let device = &self.shared.device;
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: None,
            source: wgpu::ShaderSource::Wgsl(frag_src.into()),
        });

        let mut entries = Vec::with_capacity(reflection.bindings.len() + 1);
        if reflection.params_size > 0 {
            entries.push(wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: uniform_binding(reflection.params_size as u64),
                count: None,
            });
        }
        for binding in &reflection.bindings {
            let ty = match binding.kind {
                BindingKind::Texture => wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                BindingKind::Sampler { .. } => wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
            };
            entries.push(wgpu::BindGroupLayoutEntry {
                binding: binding.index,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty,
                count: None,
            });
        }
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: None, entries: &entries });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[Some(&layout), Some(&self.shared.quad_layout)],
            immediate_size: 0,
        });
        Ok(LinkedProgram {
            shared: Rc::clone(&self.shared),
            module,
            reflection,
            layout,
            pipeline_layout,
            pipelines: RefCell::new(HashMap::new()),
        })
    }
}

/// A uniform struct of `size` bytes, placed in a shared buffer by a
/// dynamic offset.
fn uniform_binding(size: u64) -> wgpu::BindingType {
    wgpu::BindingType::Buffer {
        ty: wgpu::BufferBindingType::Uniform,
        has_dynamic_offset: true,
        min_binding_size: NonZeroU64::new(size),
    }
}

#[cfg(test)]
pub(in crate::gpu) mod check {
    //! That a uniform struct packs to the bytes its shader's `Params` reads,
    //! for the per-shader test in `gpu::shader`.

    use super::*;
    use crate::gpu::uniforms::{glsl_name, wgsl_layout, Uniforms};

    /// `P`'s fields must be the members of `source`'s `Params`, at the
    /// offsets and total size naga computed for it.
    pub fn struct_matches_source<P: Uniforms>(source: &str) -> Result<(), String> {
        let reflection = Reflection::parse(source)?;
        let (offsets, size) = wgsl_layout(P::FIELDS);
        let packed: Vec<(String, u32)> =
            P::FIELDS.iter().zip(offsets).map(|(field, offset)| (glsl_name(field.name), offset)).collect();
        if packed != reflection.members {
            return Err(format!("struct packs {packed:?} but the shader reads {:?}", reflection.members));
        }
        let expected = if P::FIELDS.is_empty() { 0 } else { size };
        if expected != reflection.params_size {
            return Err(format!("struct packs to {expected} bytes but `Params` is {}", reflection.params_size));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gpu::uniforms::{Mat3, UniformValue};

    #[test]
    fn a_reflection_line_is_read_back() {
        let reflection = Reflection::parse(
            "//#reflect size=32 members=u_a:0,u_b:16 bindings=1:t:u_tex,2:s:u_tex_sampler,3:t:u_maskTex\nfn x() {}",
        )
        .unwrap();
        assert_eq!(reflection.params_size, 32);
        assert_eq!(reflection.members, [("u_a".to_string(), 0), ("u_b".to_string(), 16)]);
        assert_eq!(reflection.texture_binding("u_maskTex"), Some(3));
        assert_eq!(reflection.texture_binding("u_tex_sampler"), None);
        assert_eq!(reflection.bindings[1].kind, BindingKind::Sampler { texture: Some(1) });
    }

    #[test]
    fn a_shader_with_no_resources_reflects_empty() {
        let reflection = Reflection::parse("//#reflect size=0 members= bindings=\n").unwrap();
        assert_eq!(reflection, Reflection::default());
        assert!(Reflection::parse("struct Params {}").is_err());
    }

    #[test]
    fn the_fill_shader_declares_its_own_reflection() {
        let reflection = Reflection::parse(FILL_SHADER).unwrap();
        assert_eq!(reflection.params_size, 16);
        assert!(reflection.bindings.is_empty());
    }

    #[test]
    fn values_are_packed_at_wgsl_offsets() {
        let mut bytes = Vec::new();
        ParamSink::pack(&mut bytes, &|sink| {
            1.0f32.put(sink);
            [2.0f32, 3.0].put(sink);
            [4.0f32, 5.0, 6.0].put(sink);
            7i32.put(sink);
        });
        // f32 @0, vec2 @8, vec3 @16, i32 @28 (it fits in the vec3's tail).
        assert_eq!(bytes.len(), 32);
        let word = |offset: usize| f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
        assert_eq!([word(0), word(8), word(12), word(16), word(20), word(24)], [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        assert_eq!(i32::from_le_bytes(bytes[28..32].try_into().unwrap()), 7);
        assert_eq!(word(4), 0.0);
    }

    #[test]
    fn a_mat3_column_takes_sixteen_bytes() {
        let mut bytes = Vec::new();
        ParamSink::pack(&mut bytes, &|sink| Mat3([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]).put(sink));
        assert_eq!(bytes.len(), 48);
        let word = |offset: usize| f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
        assert_eq!([word(0), word(4), word(8), word(12)], [1.0, 2.0, 3.0, 0.0]);
        assert_eq!([word(16), word(32), word(40)], [4.0, 7.0, 9.0]);
    }
}
