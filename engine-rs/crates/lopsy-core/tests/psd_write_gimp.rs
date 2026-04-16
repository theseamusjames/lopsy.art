use lopsy_core::color::BlendMode;
use lopsy_core::psd::types::*;
use lopsy_core::psd::writer::write_psd;
use lopsy_core::psd::reader::read_psd;
use std::fs;

/// Generate multi-layer PSDs and write to /tmp for external validation.
#[test]
fn generate_test_psd_8bit() {
    let doc = build_test_doc_8bit();
    let psd = write_psd(&doc);
    fs::write("/tmp/lopsy_test_8bit.psd", &psd).unwrap();
    eprintln!("Wrote /tmp/lopsy_test_8bit.psd ({} bytes)", psd.len());
}

#[test]
fn generate_test_psd_16bit() {
    let doc = build_test_doc_16bit();
    let psd = write_psd(&doc);
    fs::write("/tmp/lopsy_test_16bit.psd", &psd).unwrap();
    eprintln!("Wrote /tmp/lopsy_test_16bit.psd ({} bytes)", psd.len());
}

/// Full roundtrip: write → read → compare for 8-bit multi-layer document with all features.
#[test]
fn roundtrip_8bit_full() {
    let original = build_test_doc_8bit();
    let psd_bytes = write_psd(&original);
    let parsed = read_psd(&psd_bytes).unwrap();

    assert_eq!(parsed.width, original.width);
    assert_eq!(parsed.height, original.height);
    assert_eq!(parsed.depth, PsdDepth::Eight);
    assert_eq!(parsed.layers.len(), original.layers.len());

    for (orig, parsed) in original.layers.iter().zip(parsed.layers.iter()) {
        assert_eq!(parsed.name, orig.name, "name mismatch for layer '{}'", orig.name);
        assert_eq!(parsed.opacity, orig.opacity, "opacity mismatch for '{}'", orig.name);
        assert_eq!(parsed.blend_mode, orig.blend_mode, "blend mode mismatch for '{}'", orig.name);
        assert_eq!(parsed.visible, orig.visible, "visibility mismatch for '{}'", orig.name);
        assert_eq!(parsed.group_kind, orig.group_kind, "group_kind mismatch for '{}'", orig.name);
        assert_eq!(parsed.rect, orig.rect, "rect mismatch for '{}'", orig.name);
        assert_eq!(parsed.pixel_data, orig.pixel_data, "pixel data mismatch for '{}'", orig.name);
    }
}

/// Full roundtrip: write → read → compare for 16-bit document.
#[test]
fn roundtrip_16bit_full() {
    let original = build_test_doc_16bit();
    let psd_bytes = write_psd(&original);
    let parsed = read_psd(&psd_bytes).unwrap();

    assert_eq!(parsed.width, original.width);
    assert_eq!(parsed.height, original.height);
    assert_eq!(parsed.depth, PsdDepth::Sixteen);
    assert_eq!(parsed.layers.len(), original.layers.len());

    for (orig, parsed) in original.layers.iter().zip(parsed.layers.iter()) {
        assert_eq!(parsed.name, orig.name);
        assert_eq!(parsed.opacity, orig.opacity);
        assert_eq!(parsed.blend_mode, orig.blend_mode);
        assert_eq!(parsed.pixel_data, orig.pixel_data, "16-bit pixel data mismatch for '{}'", orig.name);
    }
}

/// Roundtrip with layer masks.
#[test]
fn roundtrip_with_mask() {
    let w = 8u32;
    let h = 8u32;

    // Build a checkerboard mask
    let mut mask_data = Vec::with_capacity(64);
    for y in 0..8u32 {
        for x in 0..8u32 {
            mask_data.push(if (x + y) % 2 == 0 { 255 } else { 0 });
        }
    }

    let layer = PsdLayer {
        name: "Masked Layer".to_string(),
        visible: true,
        opacity: 255,
        blend_mode: BlendMode::Normal,
        clip_to_below: false,
        rect: PsdRect::from_xywh(0, 0, w, h),
        pixel_data: vec![255, 128, 0, 255].repeat(64),
        mask: Some(PsdMask {
            rect: PsdRect::from_xywh(0, 0, w, h),
            data: mask_data.clone(),
            default_color: 0,
        }),
        group_kind: GroupKind::Normal,
    };

    let doc = PsdDocument {
        width: w,
        height: h,
        depth: PsdDepth::Eight,
        layers: vec![layer],
        icc_profile: None,
    };

    let psd_bytes = write_psd(&doc);
    let parsed = read_psd(&psd_bytes).unwrap();

    assert_eq!(parsed.layers.len(), 1);
    let parsed_layer = &parsed.layers[0];
    assert_eq!(parsed_layer.name, "Masked Layer");
    assert_eq!(parsed_layer.pixel_data, doc.layers[0].pixel_data);

    let parsed_mask = parsed_layer.mask.as_ref().expect("mask should be present");
    assert_eq!(parsed_mask.rect, PsdRect::from_xywh(0, 0, w, h));
    assert_eq!(parsed_mask.data, mask_data);
}

/// Roundtrip with all 16 blend modes.
#[test]
fn roundtrip_all_blend_modes() {
    let modes = [
        BlendMode::Normal, BlendMode::Multiply, BlendMode::Screen, BlendMode::Overlay,
        BlendMode::Darken, BlendMode::Lighten, BlendMode::ColorDodge, BlendMode::ColorBurn,
        BlendMode::HardLight, BlendMode::SoftLight, BlendMode::Difference, BlendMode::Exclusion,
        BlendMode::Hue, BlendMode::Saturation, BlendMode::Color, BlendMode::Luminosity,
    ];

    let mut layers = Vec::new();
    for (i, mode) in modes.iter().enumerate() {
        layers.push(solid_layer_8bit(
            &format!("{mode:?}"), 0, 0, 4, 4,
            i as u8 * 16, 128, 255, 255,
            *mode, 200,
        ));
    }

    let doc = PsdDocument {
        width: 4,
        height: 4,
        depth: PsdDepth::Eight,
        layers,
        icc_profile: None,
    };

    let psd_bytes = write_psd(&doc);
    let parsed = read_psd(&psd_bytes).unwrap();

    assert_eq!(parsed.layers.len(), 16);
    for (orig, parsed) in doc.layers.iter().zip(parsed.layers.iter()) {
        assert_eq!(parsed.blend_mode, orig.blend_mode);
        assert_eq!(parsed.opacity, orig.opacity);
        assert_eq!(parsed.pixel_data, orig.pixel_data);
    }
}

/// 16-bit gradient roundtrip — tests precision across full value range.
#[test]
fn roundtrip_16bit_gradient() {
    let w = 256u32;
    let h = 1u32;
    let mut data = Vec::with_capacity(256 * 8);
    for i in 0..256u16 {
        let val = i * 257; // maps 0-255 to 0-65535 evenly
        data.extend_from_slice(&val.to_be_bytes()); // R
        data.extend_from_slice(&(65535 - val).to_be_bytes()); // G
        data.extend_from_slice(&(val / 2).to_be_bytes()); // B
        data.extend_from_slice(&[0xFF, 0xFF]); // A
    }

    let doc = PsdDocument {
        width: w,
        height: h,
        depth: PsdDepth::Sixteen,
        layers: vec![PsdLayer {
            name: "Gradient".to_string(),
            visible: true,
            opacity: 255,
            blend_mode: BlendMode::Normal,
            clip_to_below: false,
            rect: PsdRect::from_xywh(0, 0, w, h),
            pixel_data: data.clone(),
            mask: None,
            group_kind: GroupKind::Normal,
        }],
        icc_profile: None,
    };

    let psd_bytes = write_psd(&doc);
    let parsed = read_psd(&psd_bytes).unwrap();

    assert_eq!(parsed.layers[0].pixel_data, data, "16-bit gradient pixel data should be exact");
}

// ─── Test doc builders ─────────────────────────────────────────────────

fn build_test_doc_8bit() -> PsdDocument {
    let w = 64u32;
    let h = 64u32;

    let bg = solid_layer_8bit("Background", 0, 0, w, h, 0, 0, 255, 255, BlendMode::Normal, 255);
    let red = solid_layer_8bit("Red Overlay", 10, 10, 32, 32, 255, 0, 0, 255, BlendMode::Normal, 192);
    let green = solid_layer_8bit("Green Multiply", 20, 20, 40, 40, 0, 255, 0, 255, BlendMode::Multiply, 255);

    let group_end = PsdLayer {
        name: "".to_string(),
        visible: true,
        opacity: 255,
        blend_mode: BlendMode::Normal,
        clip_to_below: false,
        rect: PsdRect::new(0, 0, 0, 0),
        pixel_data: Vec::new(),
        mask: None,
        group_kind: GroupKind::GroupEnd,
    };

    let gradient = gradient_layer_8bit("Gradient", 0, 0, w, h);

    let group_open = PsdLayer {
        name: "Test Group".to_string(),
        visible: true,
        opacity: 255,
        blend_mode: BlendMode::Normal,
        clip_to_below: false,
        rect: PsdRect::new(0, 0, 0, 0),
        pixel_data: Vec::new(),
        mask: None,
        group_kind: GroupKind::GroupOpen,
    };

    PsdDocument {
        width: w,
        height: h,
        depth: PsdDepth::Eight,
        layers: vec![bg, red, green, group_end, gradient, group_open],
        icc_profile: None,
    }
}

fn build_test_doc_16bit() -> PsdDocument {
    let w = 32u32;
    let h = 32u32;

    let bg = solid_layer_16bit("Background", 0, 0, w, h, 65535, 65535, 65535, 65535, BlendMode::Normal, 255);
    let red = solid_layer_16bit("Red 50%", 0, 0, w, h, 65535, 0, 0, 65535, BlendMode::Normal, 128);

    PsdDocument {
        width: w,
        height: h,
        depth: PsdDepth::Sixteen,
        layers: vec![bg, red],
        icc_profile: None,
    }
}

fn solid_layer_8bit(
    name: &str, x: i32, y: i32, w: u32, h: u32,
    r: u8, g: u8, b: u8, a: u8,
    mode: BlendMode, opacity: u8,
) -> PsdLayer {
    let pixel_count = (w * h) as usize;
    let mut data = Vec::with_capacity(pixel_count * 4);
    for _ in 0..pixel_count {
        data.extend_from_slice(&[r, g, b, a]);
    }
    PsdLayer {
        name: name.to_string(),
        visible: true,
        opacity,
        blend_mode: mode,
        clip_to_below: false,
        rect: PsdRect::from_xywh(x, y, w, h),
        pixel_data: data,
        mask: None,
        group_kind: GroupKind::Normal,
    }
}

fn solid_layer_16bit(
    name: &str, x: i32, y: i32, w: u32, h: u32,
    r: u16, g: u16, b: u16, a: u16,
    mode: BlendMode, opacity: u8,
) -> PsdLayer {
    let pixel_count = (w * h) as usize;
    let mut data = Vec::with_capacity(pixel_count * 8);
    for _ in 0..pixel_count {
        data.extend_from_slice(&r.to_be_bytes());
        data.extend_from_slice(&g.to_be_bytes());
        data.extend_from_slice(&b.to_be_bytes());
        data.extend_from_slice(&a.to_be_bytes());
    }
    PsdLayer {
        name: name.to_string(),
        visible: true,
        opacity,
        blend_mode: mode,
        clip_to_below: false,
        rect: PsdRect::from_xywh(x, y, w, h),
        pixel_data: data,
        mask: None,
        group_kind: GroupKind::Normal,
    }
}

fn gradient_layer_8bit(name: &str, x: i32, y: i32, w: u32, h: u32) -> PsdLayer {
    let pixel_count = (w * h) as usize;
    let mut data = Vec::with_capacity(pixel_count * 4);
    for py in 0..h {
        for px in 0..w {
            let r = ((px as f32 / w as f32) * 255.0) as u8;
            let g = ((py as f32 / h as f32) * 255.0) as u8;
            let b = 128u8;
            data.extend_from_slice(&[r, g, b, 255]);
        }
    }
    PsdLayer {
        name: name.to_string(),
        visible: true,
        opacity: 255,
        blend_mode: BlendMode::Normal,
        clip_to_below: false,
        rect: PsdRect::from_xywh(x, y, w, h),
        pixel_data: data,
        mask: None,
        group_kind: GroupKind::Normal,
    }
}
