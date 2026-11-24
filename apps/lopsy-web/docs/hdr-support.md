# HDR in Lopsy: what exists, and what full support needs

Lopsy can show HDR. It cannot yet edit in it. This note says where the
line is, so that "HDR" in the status bar is not read as more than it is.

> This note lives with the app because the app is where "HDR" is shown.
> Most of the work it lists is in the engine (`engine/`, at the
> repository root): full HDR support needs the engine to edit in HDR, not
> only to render it.

## What exists: HDR rendering

- **The canvas.** On the WebGPU engine, while the display the window is on
  reports high dynamic range (`(dynamic-range: high)`), the canvas is
  16-bit float with extended tone mapping. A value above 1.0 drawn to it
  shows brighter than white. The status bar reads `HDR` after the colour
  space. The WebGL engine's canvas is 8 bits a channel and never HDR.
- **One source of values above white in Lopsy.** The document's own
  adjustments (the root group's): what Exposure, Contrast, Highlights and
  Whites push above white is kept on screen instead of clipped. That is
  the only place in Lopsy's pipeline a value above 1.0 is produced.
  (Photonamous's develop working space is separate: it renders linear
  light with highlights above white, shows them on an HDR canvas through
  its output step, `setDevelopHdr`, and reads them for HDR files,
  `readHdrOutputF32`; Lopsy never turns it on. `screenIsHdr` says
  whether the canvas really is HDR.)

In Lopsy it is a display effect. Layers, group adjustments, filters, the
eyedropper, thumbnails and every export still clip at white, so an
exported file does not contain what the screen shows above white.

## What full HDR support needs: HDR editing

Everything in the document pipeline assumes values between 0 and 1. For
HDR editing, each of these has to change, and they have to change
together or a document renders differently depending on which path it
takes:

- **Decode.** RAF and DNG decoding clamps to 0..1 after demosaic, which
  throws away the highlight headroom a raw file has. An HDR image format
  (EXR, Radiance HDR, AVIF or JPEG with a gain map) has no importer.
- **Adjustments.** The adjustments shader clamps after the tone controls
  because Levels, Curves, Hue/Saturation, Color Balance, Channel Mixer,
  Gradient Map and Color Grading are all written for 0..1 (several index
  a 256-entry LUT). The HDR screen path sets the excess aside and adds it
  back at the end; real support needs each of them defined above 1.0.
- **Blending.** The blend modes are the standard display-referred ones.
  Screen, Overlay, Color Dodge and the rest have no agreed meaning above
  1.0, and Normal at partial opacity would mix HDR and SDR values in
  gamma-encoded space.
- **Working space.** Pixels are stored gamma-encoded. HDR compositing
  that looks right wants linear light, which is a change to every shader
  that blends or filters.
- **Tools.** Brush colours, the colour picker, gradients and fills stop
  at white. The eyedropper and the Info panel read 8-bit values.
- **Export.** PNG, JPEG, PSD and the `.lopsy` project format store 8 or
  16-bit integers clipped at white. HDR output needs a format that can
  carry it and a decision about what an SDR export of an HDR document
  shows.
- **The WebGL engine.** Its canvas would need `drawingBufferStorage` with
  a float format and its own tone-mapping control, or HDR stays a
  WebGPU-only feature.

None of this is started. The HDR canvas is the last step of that
pipeline, built first because it was cheap once the wgpu backend existed.
