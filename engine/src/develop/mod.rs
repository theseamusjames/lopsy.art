//! The Photonamous develop chain: the GPU stages that turn a document's
//! composite into the developed picture, and the RAW stage that starts it.
//! Start here; each stage's maths lives in its CPU reference in `lopsy-core`.
//!
//! # Stage order
//!
//! Every stage is `None` (or off) by default; then nothing runs and the
//! composite is byte-identical to Lopsy's. Each pass reads the composite,
//! draws into scratch A and is copied back texel for texel. The chain is
//! run by `compositor::run_develop_chain` (stages 2–9) for the live frame
//! and every export alike; stages 3–9 are its `MIDDLE_STAGES`, and 2n, 2h
//! and 2t its entry to the working space (`compositor::enter_working_space`).
//!
//! **The working space.** A document that asks for it
//! (`setDevelopWorkingSpace`, [`working_space`]; Photonamous does for every
//! photo, Lopsy never) holds unclamped linear Rec. 2020 float from stage 2
//! (or 2i) to stage 11: "scene" data before the tone step, "rendered" after
//! it (1.0 is white, above it HDR headroom). The column "space" says what
//! each stage reads and writes then; without the working space every stage
//! reads and writes sRGB-encoded values in sRGB primaries, as it always has,
//! and stages 2i, 2n, 2h, 2t, D, D′ and 11 do not run.
//!
//! | # | Stage | Space (working space on) | Pass | Shader (`gpu/shaders/`) | CPU reference (`lopsy_core::`) |
//! |---|---|---|---|---|---|
//! | 1 | Layers composited | camera RGB (RAW) or the photo's encoding | `document::compositor` | `blend.wgsl` | — |
//! | 2 | RAW develop (a RAF or a DNG). Working space off: white balance, camera matrix, exposure, saturation, highlight desaturation, base curve, sRGB. On: white balance, camera matrix to Rec. 2020, exposure, nothing else. A DNG's matrix comes from its own calibration and is recomputed on the CPU for each white balance (`dng::camera_color`) | camera RGB → scene | this module | `develop/raw_develop.wgsl` | `raf::develop::develop_reference`, `raf::develop::scene_reference` |
//! | 2i | Input step, a photo that is not RAW: decode sRGB or Display P3 to linear Rec. 2020, no curve (rendered equals scene) | encoded → scene | `compositor::enter_working_space` | `develop/working_space.wgsl` | `working_space::input_reference` |
//! | 2n | Noise reduction on scene data. **Working space on only**: stage 3's algorithm inside a D and D′ of its own, a RAW photo's thresholds divided by `detail::NR_SCENE_THRESHOLD_SCALE` (data before the base curve), nothing clamped | scene, display-encoded | [`detail::apply_noise_reduction_scene`] | `develop/noise_reduce.wgsl` | `detail::noise_reduce_run_reference` |
//! | 2h | Haze on scene data. **Working space on only**: the blurred darkest channel is the veil, taken away softly with exposure compensation (or a veil of the neighbourhood's light added) | scene | [`detail::apply_haze`] | `develop/luminance_stats.wgsl`, then `develop/haze.wgsl` | `linear_detail::statistics`, `linear_detail::haze_reference` |
//! | 2t | Tone pass (the scene statistics are read just before it, after 2n and 2h). First tone on scene data: the photo's Exposure, Temperature and Tint (not RAW: the RAW step has a RAW photo's), Contrast, Highlights, Shadows, Whites and Blacks, with each area's Exposure, Temperature, Tint, Contrast, Highlights, Shadows and its layer's Whites and Blacks blended in through its mask; a gain, then the tone map on luminance in stops. Then a RAW photo's profile: saturation and the base curve with its shoulder above 1 (no highlight desaturation: the decode reconstructs clipped channels). A photo that is not RAW runs it only when tone on scene data has something to do | scene → rendered | [`tone`] | `develop/tone.wgsl` | `scene_tone::scene_tone_reference`, then `tone::tone_reference` |
//! | D | Into the display encoding, before the first `Display` stage of a run of them that draws: sRGB primaries, sRGB curve extended past 0..1 | rendered → display | `compositor::convert_composite` | `develop/working_space.wgsl` | `working_space::to_display_reference` |
//! | 3 | Noise reduction. **Working space off only** (on: 2n) | display | [`detail::apply_noise_reduction`] | `develop/noise_reduce.wgsl` | `detail::noise_reduce_reference` |
//! | 4 | Working space off: haze, large and small details on encoded values. On: large and small details only (haze is 2h), on log luminance in stops, each radius's detail shrunk by its neighbourhood's variance, one gain on all three channels | display (off); rendered (on) | [`detail::apply_local_contrast`] (off), [`detail::apply_local_contrast_linear`] (on) | `develop/local_contrast.wgsl` (off); `develop/luminance_stats.wgsl`, then `develop/local_contrast_log.wgsl` (on) | `detail::local_contrast_reference` (off); `linear_detail::statistics`, `linear_detail::local_contrast_log_reference` (on) |
//! | 5 | Image adjustments: tone, colour, curves, levels, colour grading. **Working space off only** | display | `imaging::adjustments` | `filters/adjustments.wgsl` | — (Lopsy's) |
//! | 6 | Colour by hue, on sRGB-encoded values. **Working space off only** | display | `compositor::apply_color_mixer` | `develop/color_mixer.wgsl` | `color_mixer::color_mixer_reference` |
//! | 6L | Look pass. **Working space on only**: Saturation and Vibrance (each area's Saturation and its layer's Vibrance blended in through its mask) and Color by hue in OkLab, colour grading, curves (4096-entry float tables) through the sRGB curve on Rec. 2020 primaries; unclamped | rendered | [`look`] | `develop/look.wgsl` | `look::look_reference` |
//! | 7 | Areas' built-in adjustments (linear and radial masks). **Working space off only**: with it they act in 2t and 6L | display | `compositor::apply_areas` | `develop/areas.wgsl` | `areas::areas_reference` |
//! | 7b | Each area's layer, through its mask. Working space off: stages 3–6, 8 and 9 again with the area's own settings. On: 6L with the area's Color by hue, grade and curves on rendered data, then its 3 inside D and D′, its haze (2h's maths) and its 4 on rendered data, then its 8 and 9 inside D and D′ (one D and D′ round all of 3, 8 and 9 when it has no local contrast or haze) | display (off); rendered, with its own D and D′ (on) | `compositor::apply_area_layers` | those stages' shaders, then `develop/area_layer.wgsl` | `areas::area_layer_reference` (the mix) |
//! | 8 | Sharpening | display | [`detail::apply_sharpening`] | `develop/detail_sharpen.wgsl` | `detail::sharpen_reference` |
//! | 9 | Finish: shaped vignette, grain | display | `compositor::apply_finish` | `develop/finish.wgsl` | `finish::finish_reference` |
//! | D′ | Back from the display encoding, after the last of 3–9 that drew | display → rendered | `compositor::convert_composite` | `develop/working_space.wgsl` | `working_space::from_display_reference` |
//! | 11 | Output: highlight roll-off, gamut mapping, the target's transfer curve, dither for 8 bits; for the screen (the space `setScreenOutput` said; the HDR canvas with the HDR view's peak while the screen is HDR and the view on) or the file (SDR, or linear Rec. 2020 up to a peak for an HDR file) | rendered → target | [`output`] | `develop/output.wgsl` | `output::output_reference` |
//! | 10 | Screen only, after 11: sharpening mask view (in place of 8), area mask overlay, clipping warning (at white, or at the peak in the HDR view) | screen | `compositor` (live frame) | `develop/detail_sharpen.wgsl`, `develop/areas.wgsl`, `develop/clip_warning.wgsl` | `areas::overlay_reference` |
//!
//! Blurs for stages 2n, 2h, 3, 4 and 8 are `develop/blur_axis.wgsl`, separable up
//! to σ = 4 working pixels and box-downscaled first above that
//! ([`detail`]). Radii are in full-resolution pixels times a `pixelScale`
//! (working width / full width), so the reduced working image and the
//! full-size export blur over the same part of the picture.
//!
//! With the working space, the stages that still assume sRGB-encoded
//! values (8, 9 and an area layer's own 3, 8 and 9) run between D and D′,
//! once each way for each run of consecutive ones that draw, and not at all
//! when none does; 4, 6L and 7b work on rendered data
//! (`compositor::MIDDLE_STAGES`, each stage's `space`). Noise reduction
//! (2n) runs between a D and D′ of its own on scene data, before haze (2h)
//! and the tone pass. The image adjustments (5), the old colour by hue (6)
//! and the old areas pass (7) do not run at all then, so nothing clamps the
//! image to sRGB any more and the output step maps whatever gamut it
//! reaches (`output::source_gamut`). Sharpening (8) and finish (9) still
//! clamp negative encoded values to 0 and keep the rest of a value above 1;
//! noise reduction keeps negative values with the working space.
//!
//! **Exports.** The 16-bit exports (`exportPng16`, `exportTiff16`) run stages
//! 1–9. The 8-bit `compositeForExport` and Flatten run 1–9 except 5:
//! they never applied the document's image adjustments in Lopsy, and that
//! is unchanged. Stage 10 never reaches an export. With the working space,
//! each export ends with stage 11 for its file's space: the 16-bit ones for
//! their `colorSpace` (0 sRGB, 1 Display P3, 2 Rec. 2020), not dithered; the
//! 8-bit one for sRGB, dithered when the photo is RAW; Flatten for sRGB, not
//! dithered (it is copied at the layer's precision).
//!
//! **The screen.** With the working space, the live frame's output step
//! renders for the screen (`output::live_settings`). While the screen
//! really is HDR (wgpu, `setScreenOutput` asked for it and the canvas could
//! be made `rgba16float` with extended tone mapping: `screenIsHdr`) and the
//! HDR view is on (`setDevelopHdr`, on by default at a peak of 4), it
//! renders for the HDR canvas: Display P3 or sRGB primaries as the screen
//! is, the sRGB curve continued past 1, highlights rolled off from white
//! toward the peak (`lopsy_core::output`, step 1). Otherwise, the HDR view
//! off included, it renders the SDR output for the screen's space, which
//! an HDR canvas shows with 1.0 at its SDR white. Nothing after the output
//! step clamps: the area overlay mixes toward red, the clipping warning
//! replaces a pixel, the final blit passes values through (it dithers only
//! an 8-bit screen), and every texture on the way is half float. On WebGL
//! the HDR request is ignored and `screenIsHdr` is false.
//!
//! **HDR files.** `readHdrOutputF32` runs the 8-bit export's chain at the
//! document's size and then stage 11 for linear Rec. 2020 up to a peak, and
//! reads it as f32: the HDR picture `encodePqPng` and `computeGainMap`
//! take, with `compositeForExport` as the gain map's SDR picture.
//! `readHdrOutputF32Sized` and `compositeForExportSized` are the pair at a
//! smaller output size (`compositor::render_export_sized`): the same chain
//! at the document's size, stopped before stage 11; the rendered linear
//! image box-reduced on the GPU (`thumbnail_box.wgsl`, which averages each
//! output pixel's whole footprint in premultiplied colour, through smaller
//! images first past 128 texels a pixel); then stage 11 on the reduced
//! image. Both pictures of one size come from the same reduced image, so
//! the gain map between them holds. Sharpening, grain and the blurs are
//! rendered at full size and reduced with the rest, as the resized 8-bit
//! export (a full-size export scaled down by the canvas) has them.
//!
//! **Tiles.** A document can be one rectangle of a larger picture
//! (`setDocumentRegion`, `EngineInner::document_region`,
//! `lopsy_core::tile`): a picture larger than the GPU's textures is
//! rendered tile by tile, and the tiles' kept parts assemble into what one
//! render of the whole gives, bit for bit (`tests/tiles.rs`). Everything
//! the host sets keeps the whole picture's coordinates. Per stage, with a
//! region: stage 1 moves each layer (and its mask) by the region's origin;
//! 2, 2i, 2t's profile, 5, 6, 6L's colour, D, D′ and 11's mapping are per
//! pixel and unchanged (5's vignette, Lopsy's, which Photonamous never
//! sets, stays the tile's own; so do layer effects); every area mask (2t, 6L, 7, 7b's mix) and 9's
//! vignette and grain evaluate at the pixel's place in the whole, the
//! vignette in a frame of the whole's size; 11's dither hashes the whole's
//! pixel (`include/region.wgsl`, `wholePoint`). Blurs (2n, 2h, 3, 4, 7b,
//! 8): up to σ = 4 they run on the tile as they always do; above it the
//! smaller image is the whole picture's (as large, on the same grid), with
//! only the texels the tile meets drawn (`thumbnail_box.wgsl`'s region,
//! `tile::low_rect`), and the combining shader reads it at the whole
//! render's own coordinate (`blurUv`). Every stage still clamps at the
//! tile's edge, so a tile carries an apron of real pixels, the sum of the
//! reaches of the neighbourhood stages that run (`tile::apron`,
//! `developApron`), and ends exactly at a picture edge. With no region
//! every shader takes the branch that is the arithmetic it always had.
//!
//! **Statistics.** With the working space, the live frame keeps its
//! rendered image (after D′, before 11) in the working space's own texture,
//! from the first read of it on (`compositor::want_rendered`, which draws
//! the frame again then): an engine that only exports never holds it.
//! The histogram (`readDevelopHistogram`, and so Auto tone) and the pixel
//! readout (`sampleColor`) read that image through stage 11 for sRGB with no
//! dither (`compositor::statistics_image`), whatever the screen is and
//! without stage 10. The HDR histogram (`readHdrHistogram`) reads it through
//! stage 11 for the HDR canvas in sRGB primaries with the peak it is given
//! (`compositor::hdr_statistics_image`), the same way. `readRenderedF32` reads it as it is. The kept image is
//! always the photo: while the sharpening mask view (stage 10) draws, the
//! live chain splits at stage 8, keeps the result of real sharpening and
//! the stages after it, and then draws the mask for the screen from the
//! same point (`compositor::run_live_develop_chain`); with the view off the
//! frame runs the chain once. The white balance
//! picker (`sampleNeutralWhiteBalance`) reads stage 1, as before.
//!
//! **Lazily compiled.** Every shader under `gpu/shaders/develop/` (raw
//! develop, colour mixer, areas, blur, noise reduction, sharpening, local
//! contrast, its linear version and its statistics, haze, finish, clipping
//! warning, working space, tone, look, output) is compiled the first time a stage
//! asks for it through `ShaderPrograms::<name>()`, never in `compile_all`,
//! so a Lopsy session never links them and a driver that rejects one cannot
//! stop the engine from starting.
//!
//! # The JS API (wasm exports)
//!
//! Any RAW format (`hosts/wasm/src/api/raw.rs`, `lopsy_core::raw`), what the
//! app's RAW path uses: `rawFormatOf(bytes)`; `rawPrepare(bytes)` (its
//! `describeJson`, `paramsJson`, `binnedLinear(minLongEdge)`, `takePlane()`);
//! `rawPlanBands`, `rawRenderLinearBand`, `rawRenderFinishedBand` (rows come
//! back as a `RawRenderedBand`); `rawWhiteBalance`,
//! `rawTemperatureForKelvin`; `rawAutoWhiteBalance(linearRgba, clipLevels)`.
//! The description's `profiles` carry each entry's `role`, `menuName`,
//! `listed`, `sameAs` and `makerStandard` (`lopsy_core::raf::develop::DevelopProfile`).
//! The format calls below stay for Lopsy and older paths.
//!
//! RAF (`hosts/wasm/src/api/raf.rs`, `develop.rs`):
//! - `rafRenderLinearBand(src, paramsJson, y0, y1, srcY0, srcY1)`: a band in linear camera RGB, unclamped, clipped channels reconstructed.
//! - `rafRenderBinnedLinear(src, paramsJson, minLongEdge)` and `RafPrepared.binnedLinear(minLongEdge)`: the binned first view, no demosaic, reconstructed the same way.
//! - `rafPrepare(bytes)`: its `paramsJson` and `metaJson` carry `clipLevels`, each channel's clip level `[r, g, b]` in those renders' units (linear camera RGB at the as-shot balance); `paramsJson` also carries `whiteLevel` (raw units) and `highlightChroma` (what the renders reconstruct with; `lopsy_core::raf::highlights`).
//! - `rafDevelopDefaults(paramsJson)`: the settings that reproduce Lopsy's import look.
//! - `rafDevelopProfiles(paramsJson)`: the Profile menu (camera, the film-simulation looks, neutral, monochrome).
//! - `setRawDevelop(engine, json)`, `clearRawDevelop(engine)`.
//!
//! DNG as a RAW photo (`hosts/wasm/src/api/dng.rs`; `lopsy_core::dng::linear`), the RAF calls' twins in the same units:
//! - `dngPrepare(bytes)`: `paramsJson`, `metaJson` (`width`, `height`, `mosaicWidth`, `mosaicHeight`, `samplesPerPixel` 3 for LinearRaw or 1 for Bayer, `clipLevels`, `kind`, `cameraModel`, `asShotKelvin`, `asShotTint`, `baselineExposure`, `notApplied`), `binnedLinear(minLongEdge)`, `takeMosaic()`. An error ("DNG cannot open as RAW: …") means the app opens it with `decodeAndUploadDng`, the baked decode, as before.
//! - `dngRenderLinearBand(src, paramsJson, y0, y1, srcY0, srcY1)` with bands from `rafPlanBands`; `src` is rows of the plane, `mosaicWidth · samplesPerPixel` values a row.
//! - `dngRenderBinnedLinear(src, paramsJson, minLongEdge)`.
//! - `dngDevelopDefaults(paramsJson)`: `setRawDevelop`'s JSON at the as-shot balance, the file's baseline exposure, the neutral base curve.
//! - `dngWhiteBalance(paramsJson, wbRatio)` and `dngWhiteBalanceKelvin(paramsJson, kelvin, tint)`: `{ wbRatio, camToRgb, kelvin, tint, whiteXy }`; a DNG's `camToRgb` follows its white balance, so the app sends both to `setRawDevelop` together.
//!
//! Working space (`develop.rs`, `lib.rs`):
//! - `setDevelopWorkingSpace(engine, on, sourceSpace)`: on or off; `sourceSpace` 0 sRGB, 1 Display P3 for a photo that is not RAW.
//! - `setScreenOutput(engine, isDisplayP3, wantsHdr)`: the screen's space, which the live frame's output step renders for (on WebGL too).
//! - `readRenderedF32(engine)` (readback): the rendered image, linear Rec. 2020 RGBA f32, unclamped.
//! - `screenIsHdr(engine)` (`lib.rs`): whether the canvas really is HDR now; false on WebGL.
//! - `setDevelopHdr(engine, on, peak)`: the HDR view of the live frame, on by default; `peak` in units of SDR white (4.0 to start, 1..=64).
//! - `readHdrOutputF32(engine, peak)` (readback): the HDR picture for a file, linear Rec. 2020 RGBA f32 at the document's size, 1.0 = SDR white, up to `peak`.
//! - `readHdrOutputF32Sized(engine, peak, width, height)` (readback): the same at `width × height` (each at most the document's, neither 0), `width × height × 4` floats; `compositeForExportSized(engine, width, height)` (readback): `compositeForExport` at that size, `width × height × 4` bytes of 8-bit sRGB, its SDR twin for a gain map. Both re-composite the document (the next frame rebuilds the live composite), so neither is an any-time read.
//!
//! Tiles (`develop.rs`, `layer.rs`):
//! - `setDocumentRegion(engine, x, y, wholeWidth, wholeHeight)`: the
//!   document is the rectangle at (`x`, `y`), of its own size, of a
//!   `wholeWidth` × `wholeHeight` picture, in whole-document pixels after
//!   the crop; throws when it would leave the picture. Set it after
//!   `setDocumentSize`, which clears it. `clearDocumentRegion(engine)`.
//! - `developApron(engine)`: pixels a tile needs on each side that is not
//!   a picture edge, for the current settings (`tile::apron`).
//! - `uploadLayerPixelsF32Window(engine, layer, windowX, windowY,
//!   windowWidth, windowHeight, bandX, bandY, bandWidth, bandHeight,
//!   pixels)`: the part of a band (frame pixels, RGBA f32 rows as
//!   `uploadLayerPixelsF32Rect` takes) inside a window of the frame, into
//!   a layer texture that is the window; a band outside it does nothing.
//!
//! White balance and statistics:
//! - `rafAutoWhiteBalance(linearRgba)`: near-neutral-pixel white balance, as `wbRatio`.
//! - `rafAutoWhiteBalanceClipped(linearRgba, clipLevels)`: the same, leaving out clipped and reconstructed pixels; `rawAutoWhiteBalance` is the same call for any format.
//! - `rafWhiteBalancePresets(rafBytes)`, `rafWhiteBalanceKelvin(rafBytes)`: the camera's presets read from the file, in recipe units (clamped to Temperature and Tint's ±200), and the Kelvin scale, a line fitted through the camera's whites for illuminants A and D65, which the file also carries (a RAF's one matrix does not follow the white, so its Kelvin is a readout, not a measured colour temperature). A DNG's Kelvin is real: `dngWhiteBalance` and `dngWhiteBalanceKelvin`.
//! - `sampleNeutralWhiteBalance(engine, x, y, radius)` (readback): the picker; leaves out clipped and reconstructed pixels when `setRawDevelop`'s JSON has `clipLevels`.
//! - `readDevelopHistogram(engine)` (readback): 4 × 256 bins of the displayed result; with the working space, of the sRGB output.
//! - `readHdrHistogram(engine, peak)` (readback, working space only): 4 × 256 bins of the HDR rendering for the HDR canvas in sRGB primaries, encoded values from black (bin 0) to the peak (bin 255); `hdrHistogramWhiteBin(peak)` is where white falls (139.7 for 4).
//! - `sampleColor(engine, x, y, size)` (readback, `drawing.rs`): the pixel readout; with the working space, of the sRGB output.
//! - `autoTone(histogram, currentJson)`: Auto tone from the displayed
//!   histogram (`develop_stats::auto_tone`), kept until the app has moved.
//! - `readSceneStatistics(engine)` (readback, working space only): 8 floats,
//!   the share counted and seven luminance percentiles in stops of the scene
//!   before the tone pass, current exposure applied; with
//!   `autoToneScene(stats, currentJson)`, Auto tone on linear statistics
//!   (`lopsy_core::scene_stats`), the one to use with the working space.
//!
//! Tone, colour and curves with the working space (`develop.rs`; all zeros
//! is the identity, and each acts only with the working space):
//! - `setDevelopTone(engine, Float32Array(8))`: exposure EV, temperature,
//!   tint, contrast, highlights, shadows, whites, blacks (recipe units:
//!   exposure clamped to ±10 EV, temperature and tint to ±200,
//!   `scene_tone::WB_SLIDER_END`, the rest to ±150, `scene_tone::SLIDER_END`);
//!   exposure, temperature and tint 0 for a RAW photo.
//! - `setDevelopLook(engine, Float32Array(44))`: vibrance and saturation
//!   (−100..150), Color by hue's 24 (hue and luminance ±150, saturation
//!   −100..150), a grade's 18 (as compiled, not clamped).
//! - `setDevelopCurves(engine, Float32Array(16384))`: master, red, green,
//!   blue, 4096 entries each; `clearDevelopCurves(engine)`.
//! - `clearDevelopAdjustments(engine)`: the three above off.
//! - `setDevelopAreaLook(engine, index, Float32Array(45))`: an area layer's
//!   whites and blacks (±150), vibrance (−100..150), Color by hue's 24, a
//!   grade's 18;
//!   `setDevelopAreaCurves(engine, index, Float32Array(16384))`.
//!
//! With the working space these older calls change nothing (they still
//! work without it): Lopsy's image adjustments (`setImageExposure` …
//! `setImageVibrance`, `setImagePhotoFilter`, `setImageCurvesLut`,
//! `setImageColorGrading`), `setImageColorMixer`, and an area layer's
//! `setImageAreaTone`, `setImageAreaCurvesLut`, `setImageAreaColorGrading`
//! and `setImageAreaColorMixer`. An area's seven built-in sliders keep
//! `setImageAreas`' layout and act in the tone and look passes.
//!
//! Colour without the working space: `setImageColorMixer` /
//! `clearImageColorMixer` (24 floats), `setImageColorGrading` /
//! `clearImageColorGrading` (Lopsy's 18 floats, on the document's image
//! adjustments).
//!
//! Detail: `setImageDetail` / `clearImageDetail` (7 floats: sharpening
//! 0..150, radius, edges 0..150, noise reduction's luminance 0..150 (past
//! 100 a wider range, the mix whole), colour and keep detail 0..100),
//! `setImageLocalContrast` / `clearImageLocalContrast` (4 floats: large and
//! small details −100..150, haze −150..100, pixel scale). With the
//! working space the same values drive 2n (noise reduction), 2h (haze) and
//! the linear 4 (large and small details); their layouts are unchanged.
//!
//! Areas: `setImageAreas` / `clearImageAreas` (16 floats an area, at most 8;
//! the six signed sliders ±150, saturation −100..150; stage 7, without the
//! working space, holds them to ±100, `areas::LEGACY_LIMIT`).
//! An area's layer, by the area's index: `setImageAreaTone` (whites,
//! blacks, vibrance), `setImageAreaCurvesLut`, `setImageAreaColorGrading`,
//! `setImageAreaColorMixer`, `setImageAreaDetail`,
//! `setImageAreaLocalContrast`, `setImageAreaFinish`, each with its
//! document-wide twin's values; `clearImageAreaLayer(engine, index)` and
//! `clearImageAreaLayers`.
//!
//! Finish: `setImageFinish` / `clearImageFinish` (9 floats; grain's amount
//! and size 0..150, the vignette's controls and roughness to 100).
//!
//! **Slider limits.** A slider whose 100 was only a cap takes values to 150
//! (`lopsy_core::scene_tone::SLIDER_END`); every mapping from it is linear
//! in it or a power of two of it, so 150 is one and a half times as far
//! along the same curve and a value within ±100 renders as it always did.
//! Temperature and Tint, the photo's and a mask's, run to 200
//! (`scene_tone::WB_SLIDER_END`): a camera's own presets reach that far.
//! The ends that stayed are real ones: Saturation, Vibrance and a band's
//! saturation at −100 (grey), the details at −100 (removed exactly), haze at
//! +100 (the whole veil), noise reduction's colour and keep detail at 100,
//! the vignette's amount, midpoint, roundness and feather, and grain's
//! roughness. Lopsy's calls (`setImageExposure` … and the old Color by hue,
//! `setImageColorMixer`) keep ±100.
//!
//! Views, screen only: `setImageAreaOverlay(engine, index)`,
//! `setClippingWarning(engine, shadows, highlights)`,
//! `setImageDetailMaskView(engine, on)`.
//!
//! Export: `exportPng16(engine, colorSpace)` and `exportTiff16(engine,
//! colorSpace)` (readbacks, `lib.rs`; `lopsy_core::tiff` for the TIFF),
//! `colorSpace` 0 sRGB, 1 Display P3, 2 Rec. 2020; `compositeForExport`
//! (sRGB, 8-bit), and `compositeForExportSized` at an output size.
//!
//! Each export's layout and units are in its doc comment and in the
//! command in `commands/develop.rs` (or `commands/adjustment.rs`).
//!
//! # Deviations from spec 6.10
//!
//! This is a proof of concept on Lopsy's compositor, not the scene-referred
//! pipeline the spec describes:
//! - Without the working space, everything after the RAW stage is
//!   display-referred (sRGB-encoded) in sRGB primaries. With it, noise
//!   reduction (2n), haze (2h) and tone (2t) act on scene data, and local
//!   contrast (4), colour, grading and curves (6L) on rendered linear data,
//!   but noise reduction is still today's algorithm inside a display
//!   encoding, and sharpening and finish still run on one (D, D′).
//! - Large and small details are a Wiener filter on log luminance at two
//!   fixed radii (`lopsy_core::linear_detail`), not a multi-scale or
//!   bilateral decomposition: a strong edge's halo is bounded (about
//!   `a · 2ε / S` stops for a step of `S` stops) rather than absent.
//! - Haze's veil is the darkest channel blurred (a mean, not the dark
//!   channel prior's minimum filter), and there is no airlight estimate:
//!   removal pivots on the veil plus middle grey and never brightens a
//!   channel. Its blur is not edge-aware, so a dark object against a hazy
//!   sky is darkened a little more near its edge, and the sky beside it a
//!   little less.
//! - Highlights and Shadows are a per-pixel curve on luminance, not the
//!   spec's edge-aware version, so they cannot make halos but do not
//!   separate local from global contrast.
//! - An area's built-in sliders and its layer's Whites, Blacks and Vibrance
//!   are blended into the photo's own values through the mask and the maths
//!   is evaluated once; its layer's Color by hue, grade and curves run over
//!   a copy and are laid back through the mask.
//! - The HDR output's peak is fixed by the app (4 times SDR white to
//!   start), not the display's headroom, which a page cannot learn; the
//!   browser limits what the display cannot show. The gamut mapping is a
//!   compression toward the neutral axis (`lopsy_core::output`), not a
//!   perceptual mapping.
//! - For a RAF the camera matrix does not follow the white balance (one
//!   daylight matrix per sensor generation, no true Kelvin; the Kelvin
//!   readout is a fit through the camera's A and D65 whites). For a DNG it does: the DNG
//!   specification's method (two calibrations interpolated by inverse
//!   colour temperature, forward matrices or Bradford to D50) in
//!   `lopsy_core::dng::camera_color`, with Kelvin and tint from
//!   `lopsy_core::cct`; the matrix is computed on the CPU for each white
//!   balance and the GPU stage is the same. A DNG's opcode lists, gain
//!   table map, hue/saturation and look tables, tone curve and default
//!   crop are not applied (`dng::linear`). Clipped channels of a RAF are reconstructed on the
//!   CPU, once, in the linear decode (`lopsy_core::raf::highlights`), not
//!   by a GPU stage: which samples clipped is fixed by the file, and the
//!   RAW stage's white balance is a gain on the reconstructed data.
//! - Without the working space, noise reduction and local contrast run on
//!   encoded values before the tone controls, because tone, colour and
//!   curves are one pass (stage 5), and areas apply their own adjustments
//!   after the global colour stages (7) rather than re-running stages 3–12
//!   per area; the large-details control is not offered per area.
//! - An area's further settings (its layer, stage 7b) run over the whole
//!   composite once per area that has any: a copy of the composite, the
//!   stages the area set, and the mix. Its noise reduction and haze
//!   therefore work on rendered data after the document's tone and colour,
//!   not on scene data as 2n and 2h do, and its local contrast after the
//!   document's colour (6L), not before it as 4 does.
//! - There is no stage caching: a frame runs every active stage.
//! - The RAW stage develops the whole composite, so anything else in the
//!   document (other layers, the background colour) is developed too. On a
//!   WebGL context without float render targets the composite is 8-bit,
//!   which clips and bands linear values: develop only on RGBA16F.
//! - Lab documents are not handled by these stages.
//!
//! # This module: the RAW stage
//!
//! A RAW document's layer holds linear camera RGB at the as-shot white
//! balance (`lopsy_core::raf::develop::render_linear_band` for a RAF,
//! `lopsy_core::dng::linear::render_linear_band` for a DNG). With a
//! [`RawDevelopState`], stage 2 develops it. For a RAF, the settings from
//! `raf::develop::develop_defaults` match Lopsy's baked RAF decode without
//! its capture sharpening; for a DNG, `dng::linear::develop_defaults` gives
//! the file's own colour and baseline exposure, which differ from Lopsy's
//! baked DNG decode (that one stretches levels to fill 0..1).

pub mod assembly;
pub mod detail;
pub mod look;
pub mod output;
pub mod tile;
pub mod tone;
pub mod working_space;

use lopsy_core::raf::develop::RawDevelopSettings;

use crate::engine::EngineInner;
use crate::gpu::params::develop::RawDevelopParams;
use crate::gpu::pass::Pass;
use crate::gpu::shader::ShaderProgram;
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::uniforms::Mat3;

/// Texels per row of the base-curve LUT texture. Entry `i` is texel
/// `(i % CURVE_WIDTH, i / CURVE_WIDTH)`, so a 4096-entry curve is 256×16,
/// inside every WebGL2 texture size limit.
pub const CURVE_WIDTH: u32 = 256;

/// The develop settings of a document, and the LUT texture of its base curve.
pub struct RawDevelopState {
    pub settings: RawDevelopSettings,
    /// The base curve, one entry per texel in the red channel, when the
    /// settings have one.
    pub curve_texture: Option<TextureHandle>,
    /// Entries in `curve_texture`.
    pub curve_size: u32,
}

/// The curve as RGBA f32 texels: each entry in R, G and B, alpha 1, padded
/// with the last entry to whole rows of `CURVE_WIDTH`. Returns the texels
/// and the texture's height.
pub fn curve_texels(curve: &[f32]) -> (Vec<f32>, u32) {
    let rows = (curve.len() as u32).div_ceil(CURVE_WIDTH).max(1);
    let last = curve.last().copied().unwrap_or(0.0);
    let mut texels = Vec::with_capacity((rows * CURVE_WIDTH * 4) as usize);
    for i in 0..(rows * CURVE_WIDTH) as usize {
        let v = curve.get(i).copied().unwrap_or(last);
        texels.extend_from_slice(&[v, v, v, 1.0]);
    }
    (texels, rows)
}

/// The shader's uniforms for `state`. With `scene`, the stage stops at
/// scene data in linear Rec. 2020, for the working space.
pub fn params(state: &RawDevelopState, scene: bool) -> RawDevelopParams {
    let s = &state.settings;
    let m = if scene { lopsy_core::raf::develop::cam_to_working(s) } else { s.cam_to_rgb };
    let has_curve = state.curve_texture.is_some() && state.curve_size >= 2;
    RawDevelopParams {
        // Row-major in the settings, column-major in the shader.
        cam_to_rgb: Mat3([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]),
        wb_ratio: s.wb_ratio,
        exposure_gain: s.exposure_ev.exp2(),
        saturation: s.saturation,
        highlight_desat: i32::from(s.highlight_desaturation),
        curve_size: if has_curve { state.curve_size as i32 } else { 0 },
        curve_width: CURVE_WIDTH as i32,
        scene_only: i32::from(scene),
    }
}

/// The develop pass over `source`, with `program` from
/// `engine.shaders.raw_develop()`: to scene data when the document has the
/// working space, to sRGB otherwise. Without a curve, the LUT sampler
/// points at unit 0, the source, so it cannot alias the render target.
/// Returns the pass and how many texture units it bound.
pub fn pass<'a>(
    engine: &'a EngineInner,
    program: &'a ShaderProgram<RawDevelopParams>,
    source: TextureHandle,
    state: &RawDevelopState,
) -> (Pass<'a, RawDevelopParams>, u32) {
    let pass = engine.pass(program, params(state, engine.working_space.is_some())).texture("u_tex", source);
    match state.curve_texture.filter(|&h| engine.gpu().has_texture(h)) {
        Some(lut) => (pass.texture("u_curveLut", lut), 2),
        None => (pass.sampler_unit("u_curveLut", 0), 1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curve_texels_pad_whole_rows() {
        let curve: Vec<f32> = (0..300).map(|i| i as f32 / 299.0).collect();
        let (texels, rows) = curve_texels(&curve);
        assert_eq!(rows, 2);
        assert_eq!(texels.len(), (2 * CURVE_WIDTH * 4) as usize);
        assert_eq!(texels[299 * 4], 1.0);
        assert_eq!(texels[511 * 4], 1.0);
        assert_eq!(texels[3], 1.0);
    }

    #[test]
    fn develop_shader_keeps_the_reference_order() {
        let src = include_str!("../gpu/shaders/develop/raw_develop.wgsl");
        let code: String = src.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        let at = |needle: &str| code.find(needle).unwrap_or_else(|| panic!("missing {needle}"));
        let order = [
            "params.u_wbRatio",
            "params.u_exposureGain",
            "params.u_saturation",
            "params.u_highlightDesat",
            "params.u_curveSize",
            "linearToSrgb(rgb.r)",
        ];
        for pair in order.windows(2) {
            assert!(at(pair[0]) < at(pair[1]), "{} must come before {}", pair[0], pair[1]);
        }
    }
}
