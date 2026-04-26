use crate::color::BlendMode;

/// Bit depth of a PSD document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PsdDepth {
    Eight,
    Sixteen,
}

impl PsdDepth {
    pub fn bits_per_channel(self) -> u16 {
        match self {
            PsdDepth::Eight => 8,
            PsdDepth::Sixteen => 16,
        }
    }

    pub fn bytes_per_channel(self) -> usize {
        match self {
            PsdDepth::Eight => 1,
            PsdDepth::Sixteen => 2,
        }
    }
}

/// Role of a layer in the PSD group hierarchy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GroupKind {
    /// Normal raster/content layer.
    Normal,
    /// Group start marker (open folder in Photoshop).
    GroupOpen,
    /// Group start marker (closed folder).
    GroupClosed,
    /// Group end / bounding section divider.
    GroupEnd,
}

/// Axis-aligned rectangle in document coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PsdRect {
    pub top: i32,
    pub left: i32,
    pub bottom: i32,
    pub right: i32,
}

impl PsdRect {
    pub fn new(top: i32, left: i32, bottom: i32, right: i32) -> Self {
        Self { top, left, bottom, right }
    }

    pub fn from_xywh(x: i32, y: i32, w: u32, h: u32) -> Self {
        Self {
            top: y,
            left: x,
            bottom: y + h as i32,
            right: x + w as i32,
        }
    }

    pub fn width(self) -> u32 {
        (self.right - self.left).max(0) as u32
    }

    pub fn height(self) -> u32 {
        (self.bottom - self.top).max(0) as u32
    }

    pub fn is_empty(self) -> bool {
        self.width() == 0 || self.height() == 0
    }
}

/// Layer mask data.
#[derive(Debug, Clone)]
pub struct PsdMask {
    pub rect: PsdRect,
    /// Grayscale mask data, one byte per pixel, row-major.
    pub data: Vec<u8>,
    /// Default color for pixels outside the mask rect (0 or 255).
    pub default_color: u8,
}

/// A single layer in a PSD document.
#[derive(Debug, Clone)]
pub struct PsdLayer {
    pub name: String,
    pub visible: bool,
    /// 0–255
    pub opacity: u8,
    pub blend_mode: BlendMode,
    pub clip_to_below: bool,
    pub rect: PsdRect,
    /// Interleaved RGBA pixel data covering `rect`.
    /// For 8-bit: one byte per component (len = w * h * 4).
    /// For 16-bit: big-endian u16 pairs, two bytes per component (len = w * h * 8).
    pub pixel_data: Vec<u8>,
    pub mask: Option<PsdMask>,
    pub group_kind: GroupKind,
    /// Opaque JSON blob for layer effects (Lopsy-specific).
    /// Stored in a custom ALI block (`lyEf`) so it survives PSD round-trips.
    pub effects_json: Option<String>,
}

/// A PSD document ready to be written or just read.
#[derive(Debug, Clone)]
pub struct PsdDocument {
    pub width: u32,
    pub height: u32,
    pub depth: PsdDepth,
    pub layers: Vec<PsdLayer>,
    pub icc_profile: Option<Vec<u8>>,
}

/// Errors that can occur when reading a PSD file.
#[derive(Debug)]
pub enum PsdError {
    InvalidSignature,
    UnsupportedVersion(u16),
    UnsupportedColorMode(u16),
    UnsupportedDepth(u16),
    TruncatedData,
    InvalidLayerData(String),
    DecompressionFailed(String),
}

impl std::fmt::Display for PsdError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PsdError::InvalidSignature => write!(f, "not a PSD file (invalid signature)"),
            PsdError::UnsupportedVersion(v) => write!(f, "unsupported PSD version {v}"),
            PsdError::UnsupportedColorMode(m) => write!(f, "unsupported color mode {m} (only RGB is supported)"),
            PsdError::UnsupportedDepth(d) => write!(f, "unsupported bit depth {d} (only 8 and 16 are supported)"),
            PsdError::TruncatedData => write!(f, "unexpected end of file"),
            PsdError::InvalidLayerData(msg) => write!(f, "invalid layer data: {msg}"),
            PsdError::DecompressionFailed(msg) => write!(f, "decompression failed: {msg}"),
        }
    }
}

impl std::error::Error for PsdError {}
