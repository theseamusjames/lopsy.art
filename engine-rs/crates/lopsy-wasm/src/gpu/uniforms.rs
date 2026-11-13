//! Typed uniforms: one struct per shader, matching the shader's `Params`
//! block member for member (docs/engine-migration-plan.md, Phase 2).
//!
//! A shader declares every non-sampler uniform in one block:
//!
//! ```glsl
//! layout(std140) uniform Params {
//!     float u_levels;
//! };
//! ```
//!
//! and [`uniforms!`] declares the struct a pass hands over for it:
//!
//! ```ignore
//! uniforms! {
//!     pub struct PosterizeParams {
//!         pub levels: f32,
//!     }
//! }
//! ```
//!
//! A field `layer_offset` feeds the member `u_layerOffset`. Fields and
//! members are in the same order with matching types, which a unit test
//! checks for every typed shader, so a backend may upload the struct as the
//! block's bytes or member by member.
//!
//! The WebGL backend uploads member by member: it compiles the block as
//! plain uniforms ([`flatten_params_block`]) and sets the ones whose value
//! changed. Measured on ANGLE, a uniform buffer rewritten for every draw
//! costs the same as plain uniforms at a few dozen draws a frame, about
//! twice as much at brush-dab rates, and with `bufferSubData` on the
//! OpenGL backend thirteen times as much.

/// The GLSL type of one `Params` member.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UniformType {
    Float,
    Int,
    Uint,
    Bool,
    Vec2,
    Vec3,
    Vec4,
    IVec2,
    Mat2,
    Mat3,
    FloatArray(usize),
    Vec4Array(usize),
}

impl UniformType {
    /// How the member is spelled in GLSL, and its array length.
    pub fn glsl(self) -> (&'static str, Option<usize>) {
        match self {
            UniformType::Float => ("float", None),
            UniformType::Int => ("int", None),
            UniformType::Uint => ("uint", None),
            UniformType::Bool => ("bool", None),
            UniformType::Vec2 => ("vec2", None),
            UniformType::Vec3 => ("vec3", None),
            UniformType::Vec4 => ("vec4", None),
            UniformType::IVec2 => ("ivec2", None),
            UniformType::Mat2 => ("mat2", None),
            UniformType::Mat3 => ("mat3", None),
            UniformType::FloatArray(n) => ("float", Some(n)),
            UniformType::Vec4Array(n) => ("vec4", Some(n)),
        }
    }

    /// How many 32-bit values the member holds.
    pub fn components(self) -> usize {
        match self {
            UniformType::Float | UniformType::Int | UniformType::Uint | UniformType::Bool => 1,
            UniformType::Vec2 | UniformType::IVec2 => 2,
            UniformType::Vec3 => 3,
            UniformType::Vec4 | UniformType::Mat2 => 4,
            UniformType::Mat3 => 9,
            UniformType::FloatArray(n) => n,
            UniformType::Vec4Array(n) => 4 * n,
        }
    }
}

/// One field of a uniform struct.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Field {
    /// The Rust field name; [`glsl_name`] gives the member it feeds.
    pub name: &'static str,
    pub ty: UniformType,
}

/// Receives a uniform struct's values, one call per field in field order.
pub trait UniformSink {
    fn floats(&mut self, ty: UniformType, values: &[f32]);
    fn ints(&mut self, ty: UniformType, values: &[i32]);
}

/// A Rust type that can be a field of a uniform struct.
pub trait UniformValue {
    const TYPE: UniformType;
    fn put(&self, sink: &mut impl UniformSink);
}

/// The values of one shader's `Params` block. Implemented by [`uniforms!`];
/// `()` is the struct of a shader that has no block.
pub trait Uniforms: 'static {
    const FIELDS: &'static [Field];
    fn put(&self, sink: &mut impl UniformSink);
}

impl Uniforms for () {
    const FIELDS: &'static [Field] = &[];
    fn put(&self, _sink: &mut impl UniformSink) {}
}

impl UniformValue for f32 {
    const TYPE: UniformType = UniformType::Float;
    fn put(&self, sink: &mut impl UniformSink) {
        sink.floats(Self::TYPE, &[*self]);
    }
}

impl UniformValue for i32 {
    const TYPE: UniformType = UniformType::Int;
    fn put(&self, sink: &mut impl UniformSink) {
        sink.ints(Self::TYPE, &[*self]);
    }
}

impl UniformValue for u32 {
    const TYPE: UniformType = UniformType::Uint;
    fn put(&self, sink: &mut impl UniformSink) {
        sink.ints(Self::TYPE, &[*self as i32]);
    }
}

impl UniformValue for bool {
    const TYPE: UniformType = UniformType::Bool;
    fn put(&self, sink: &mut impl UniformSink) {
        sink.ints(Self::TYPE, &[i32::from(*self)]);
    }
}

impl UniformValue for [f32; 2] {
    const TYPE: UniformType = UniformType::Vec2;
    fn put(&self, sink: &mut impl UniformSink) {
        sink.floats(Self::TYPE, self);
    }
}

impl UniformValue for [f32; 3] {
    const TYPE: UniformType = UniformType::Vec3;
    fn put(&self, sink: &mut impl UniformSink) {
        sink.floats(Self::TYPE, self);
    }
}

impl UniformValue for [f32; 4] {
    const TYPE: UniformType = UniformType::Vec4;
    fn put(&self, sink: &mut impl UniformSink) {
        sink.floats(Self::TYPE, self);
    }
}

impl UniformValue for [i32; 2] {
    const TYPE: UniformType = UniformType::IVec2;
    fn put(&self, sink: &mut impl UniformSink) {
        sink.ints(Self::TYPE, self);
    }
}

/// A column-major 2×2 matrix.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mat2(pub [f32; 4]);

impl UniformValue for Mat2 {
    const TYPE: UniformType = UniformType::Mat2;
    fn put(&self, sink: &mut impl UniformSink) {
        sink.floats(Self::TYPE, &self.0);
    }
}

/// A column-major 3×3 matrix.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mat3(pub [f32; 9]);

impl UniformValue for Mat3 {
    const TYPE: UniformType = UniformType::Mat3;
    fn put(&self, sink: &mut impl UniformSink) {
        sink.floats(Self::TYPE, &self.0);
    }
}

/// A `float name[N]` member.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FloatArray<const N: usize>(pub [f32; N]);

impl<const N: usize> UniformValue for FloatArray<N> {
    const TYPE: UniformType = UniformType::FloatArray(N);
    fn put(&self, sink: &mut impl UniformSink) {
        sink.floats(Self::TYPE, &self.0);
    }
}

/// A `vec4 name[N]` member.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Vec4Array<const N: usize>(pub [[f32; 4]; N]);

impl<const N: usize> UniformValue for Vec4Array<N> {
    const TYPE: UniformType = UniformType::Vec4Array(N);
    fn put(&self, sink: &mut impl UniformSink) {
        sink.floats(Self::TYPE, self.0.as_flattened());
    }
}

/// Declares a uniform struct: a plain struct whose fields are, in order,
/// the members of one shader's `Params` block.
macro_rules! uniforms {
    (
        $(#[$meta:meta])*
        $vis:vis struct $name:ident {
            $( $(#[$field_meta:meta])* $field_vis:vis $field:ident : $ty:ty ),* $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq)]
        $vis struct $name {
            $( $(#[$field_meta])* $field_vis $field: $ty ),*
        }

        impl $crate::gpu::uniforms::Uniforms for $name {
            const FIELDS: &'static [$crate::gpu::uniforms::Field] = &[
                $( $crate::gpu::uniforms::Field {
                    name: stringify!($field),
                    ty: <$ty as $crate::gpu::uniforms::UniformValue>::TYPE,
                } ),*
            ];

            fn put(&self, sink: &mut impl $crate::gpu::uniforms::UniformSink) {
                $( $crate::gpu::uniforms::UniformValue::put(&self.$field, sink); )*
            }
        }
    };
}
pub(crate) use uniforms;

/// The `Params` member a field feeds: `layer_offset` → `u_layerOffset`.
pub fn glsl_name(field: &str) -> String {
    let mut name = String::with_capacity(field.len() + 2);
    name.push_str("u_");
    let mut is_word_start = false;
    for c in field.chars() {
        if c == '_' {
            is_word_start = true;
        } else if is_word_start {
            name.extend(c.to_uppercase());
            is_word_start = false;
        } else {
            name.push(c);
        }
    }
    name
}

const BLOCK_OPEN: &str = "layout(std140) uniform Params {";
const BLOCK_CLOSE: &str = "};";

/// Rewrites a shader's `Params` block as plain uniforms, keeping every line
/// where it was so compile errors still point at the source. Members of an
/// unnamed block are already global names, so the rest of the shader reads
/// the same either way.
pub fn flatten_params_block(src: &str) -> String {
    let mut out = String::with_capacity(src.len() + 256);
    let mut is_in_block = false;
    for line in src.split_inclusive('\n') {
        let code = line.trim();
        if !is_in_block {
            if code == BLOCK_OPEN {
                is_in_block = true;
                out.push('\n');
            } else {
                out.push_str(line);
            }
        } else if code == BLOCK_CLOSE {
            is_in_block = false;
            out.push('\n');
        } else if code.is_empty() || code.starts_with("//") || code.starts_with('#') {
            out.push_str(line);
        } else {
            out.push_str("uniform ");
            out.push_str(line.trim_start());
        }
    }
    out
}

#[cfg(test)]
pub mod check {
    //! What a typed shader's source must look like, for the per-shader
    //! test in `gpu::shader`.

    use super::*;

    #[derive(Debug, PartialEq, Eq)]
    struct Member {
        ty: String,
        name: String,
        len: Option<usize>,
    }

    /// `float u_name;` or `vec4 u_name[16];`, with an optional trailing
    /// comment.
    fn parse_member(code: &str) -> Result<Member, String> {
        let declaration = code.split("//").next().unwrap_or("").trim();
        let declaration = declaration
            .strip_suffix(';')
            .ok_or_else(|| format!("block member is not one declaration: `{code}`"))?;
        let (ty, rest) = declaration
            .split_once(char::is_whitespace)
            .ok_or_else(|| format!("block member has no name: `{code}`"))?;
        let rest = rest.trim();
        let (name, len) = match rest.split_once('[') {
            Some((name, len)) => {
                let len = len
                    .strip_suffix(']')
                    .and_then(|n| n.trim().parse().ok())
                    .ok_or_else(|| format!("unreadable array length: `{code}`"))?;
                (name.trim(), Some(len))
            }
            None => (rest, None),
        };
        if name.is_empty() || !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Err(format!("block member is not one declaration: `{code}`"));
        }
        Ok(Member { ty: ty.to_string(), name: name.to_string(), len })
    }

    /// The members of the source's `Params` block, and any non-sampler
    /// uniform declared outside it.
    fn read_source(src: &str) -> Result<(Vec<Member>, Vec<String>), String> {
        let mut members = Vec::new();
        let mut loose = Vec::new();
        let mut is_in_block = false;
        let mut block_count = 0;
        for line in src.lines() {
            let code = line.trim();
            if !is_in_block {
                if code == BLOCK_OPEN {
                    is_in_block = true;
                    block_count += 1;
                } else if code.contains("uniform Params") {
                    return Err(format!("the block must open with exactly `{BLOCK_OPEN}`, found `{code}`"));
                } else if let Some(rest) = code.strip_prefix("uniform ") {
                    if !rest.trim_start().starts_with("sampler") {
                        loose.push(code.to_string());
                    }
                }
            } else if code == BLOCK_CLOSE {
                is_in_block = false;
            } else if code.starts_with('#') {
                return Err(format!("preprocessor line inside the Params block: `{code}`"));
            } else if !code.is_empty() && !code.starts_with("//") {
                members.push(parse_member(code)?);
            }
        }
        if is_in_block {
            return Err("the Params block is never closed with a line reading `};`".into());
        }
        if block_count > 1 {
            return Err("more than one Params block".into());
        }
        Ok((members, loose))
    }

    /// Checks that `src` declares exactly `P`'s fields, in order, as its
    /// `Params` block, and no other non-sampler uniform.
    pub fn struct_matches_source<P: Uniforms>(src: &str) -> Result<(), String> {
        let (members, loose) = read_source(src)?;
        if !loose.is_empty() {
            return Err(format!("uniforms declared outside the Params block: {loose:?}"));
        }
        let expected: Vec<Member> = P::FIELDS
            .iter()
            .map(|field| {
                let (ty, len) = field.ty.glsl();
                Member { ty: ty.to_string(), name: glsl_name(field.name), len }
            })
            .collect();
        if members != expected {
            return Err(format!("struct and block differ.\n  struct: {expected:?}\n  block:  {members:?}"));
        }
        let flattened = flatten_params_block(src);
        if flattened.lines().count() != src.lines().count() {
            return Err("flattening the block moved lines".into());
        }
        if flattened.contains("Params") {
            return Err("flattening left the block in place".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::check::struct_matches_source;
    use super::*;

    uniforms! {
        struct Example {
            levels: f32,
            layer_offset: [f32; 2],
            tint: [f32; 4],
            radius: i32,
            is_wrapped: bool,
            stops: Vec4Array<2>,
            weights: FloatArray<3>,
        }
    }

    const EXAMPLE: &str = "#version 300 es
uniform sampler2D u_tex;
layout(std140) uniform Params {
    float u_levels;
    vec2 u_layerOffset; // texels
    vec4 u_tint;
    int u_radius;
    bool u_isWrapped;
    vec4 u_stops[2];
    float u_weights[3];
};
void main() {}
";

    #[derive(Default)]
    struct Recorder(Vec<(UniformType, Vec<u32>)>);

    impl UniformSink for Recorder {
        fn floats(&mut self, ty: UniformType, values: &[f32]) {
            self.0.push((ty, values.iter().map(|v| v.to_bits()).collect()));
        }
        fn ints(&mut self, ty: UniformType, values: &[i32]) {
            self.0.push((ty, values.iter().map(|v| *v as u32).collect()));
        }
    }

    #[test]
    fn field_names_map_to_member_names() {
        assert_eq!(glsl_name("levels"), "u_levels");
        assert_eq!(glsl_name("layer_offset"), "u_layerOffset");
        assert_eq!(glsl_name("has_sel_mask"), "u_hasSelMask");
    }

    #[test]
    fn a_struct_lists_its_fields_in_order() {
        let names: Vec<&str> = Example::FIELDS.iter().map(|f| f.name).collect();
        assert_eq!(names, ["levels", "layer_offset", "tint", "radius", "is_wrapped", "stops", "weights"]);
        assert_eq!(Example::FIELDS[5].ty, UniformType::Vec4Array(2));
        assert_eq!(Example::FIELDS[6].ty, UniformType::FloatArray(3));
    }

    #[test]
    fn a_struct_hands_over_one_value_per_field_sized_by_its_type() {
        let example = Example {
            levels: 4.0,
            layer_offset: [1.0, 2.0],
            tint: [0.1, 0.2, 0.3, 0.4],
            radius: -3,
            is_wrapped: true,
            stops: Vec4Array([[1.0; 4], [2.0; 4]]),
            weights: FloatArray([0.25, 0.5, 0.25]),
        };
        let mut recorder = Recorder::default();
        example.put(&mut recorder);
        assert_eq!(recorder.0.len(), Example::FIELDS.len());
        for ((ty, values), field) in recorder.0.iter().zip(Example::FIELDS) {
            assert_eq!(*ty, field.ty);
            assert_eq!(values.len(), field.ty.components());
        }
        assert_eq!(recorder.0[3].1, [(-3i32) as u32]);
        assert_eq!(recorder.0[4].1, [1]);
    }

    #[test]
    fn a_matching_struct_and_block_pass() {
        assert_eq!(struct_matches_source::<Example>(EXAMPLE), Ok(()));
    }

    #[test]
    fn a_reordered_or_retyped_member_fails() {
        let reordered = EXAMPLE.replace("    float u_levels;\n    vec2 u_layerOffset; // texels\n", "    vec2 u_layerOffset;\n    float u_levels;\n");
        assert!(struct_matches_source::<Example>(&reordered).is_err());
        let retyped = EXAMPLE.replace("int u_radius;", "float u_radius;");
        assert!(struct_matches_source::<Example>(&retyped).is_err());
        let resized = EXAMPLE.replace("u_weights[3]", "u_weights[4]");
        assert!(struct_matches_source::<Example>(&resized).is_err());
    }

    #[test]
    fn a_uniform_left_outside_the_block_fails() {
        let stray = EXAMPLE.replace("void main", "uniform float u_extra;\nvoid main");
        assert!(struct_matches_source::<Example>(&stray).is_err());
    }

    #[test]
    fn a_shader_with_no_block_matches_the_unit_struct() {
        let src = "#version 300 es\nuniform sampler2D u_tex;\nvoid main() {}\n";
        assert_eq!(struct_matches_source::<()>(src), Ok(()));
        assert!(struct_matches_source::<Example>(src).is_err());
    }

    #[test]
    fn flattening_turns_members_into_plain_uniforms_line_for_line() {
        let flattened = flatten_params_block(EXAMPLE);
        let lines: Vec<&str> = flattened.lines().collect();
        assert_eq!(lines.len(), EXAMPLE.lines().count());
        assert_eq!(lines[1], "uniform sampler2D u_tex;");
        assert_eq!(lines[2], "");
        assert_eq!(lines[3], "uniform float u_levels;");
        assert_eq!(lines[4], "uniform vec2 u_layerOffset; // texels");
        assert_eq!(lines[9], "uniform float u_weights[3];");
        assert_eq!(lines[10], "");
        assert_eq!(lines[11], "void main() {}");
    }

    #[test]
    fn flattening_leaves_a_shader_without_a_block_alone() {
        let src = "#version 300 es\nuniform sampler2D u_tex;\nvoid main() {}\n";
        assert_eq!(flatten_params_block(src), src);
    }
}
