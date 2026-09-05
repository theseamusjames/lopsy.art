# Lopsy Feature Catalog

## Drawing & Painting Tools

### Brush

The toolbar exposes Size, Opacity, Hardness, Fade, and the symmetry toggle. Everything else (preset gallery, brush-tip import, dynamics, texture) lives in the **Brushes modal**.

**The Brushes modal.** Opened by clicking the brush-tip thumbnail at the left of the Brush options bar — note that button only renders while a preset is active, so deleting the active preset removes this entry point (the canvas right-click **Define Brush Preset** is the only other way in, and it needs a selection). The modal is a fixed 640 × 600 centered dialog, draggable by its title bar, closed with the ✕ (there is no Escape-to-close and no backdrop — the canvas stays fully interactive behind it). Its body is a **vertical five-tab rail** on the left — **Presets, Shape, Dynamics, Texture, Sub-Brushes** — with the active tab's controls to the right. Two things sit outside the tabs and are visible from every one of them:

- **Live stroke preview** — a canvas strip below the tab area that redraws a cubic-Bézier S-stroke through the *whole* current parameter set: size, spacing, hardness, opacity, scatter, angle, tip bitmap, all four jitters, speed-size, taper, and the texture with its blend mode and scale. Updates are debounced ~200 ms, and the randomization uses a fixed xorshift seed so the preview is stable between redraws rather than reshuffling on every keystroke. Velocity is simulated as slow at both ends and fastest mid-stroke, so Speed Size is visible here.
- **Footer** — **Export** (opens the Export Brushes modal, below) and **Save Current**, which prompts for a name and snapshots the live brush — tip, size, hardness, spacing, scatter, angle, opacity, fade, taper, all four jitters, the speed-size settings, and any sub-brushes — as a new custom preset, which it then makes active. Texture is deliberately *not* captured.

**Core parameters**
- **Size**: 1 - 2000 px (auto-scaled by document size). **The two places that edit this number do not share a ceiling**: the Brushes modal's Shape tab runs to `max(2000, 1.5 × longest-document-side)` while the **options-bar** Size slider stops at `max(200, …)` — both write the same `settings.brush.size`. A size dialed above 200 in the modal survives (sliders clamp on interaction, not on render) until you next touch the options-bar slider, which clamps it back down to its own maximum.
- **Opacity**: 1 - 100%. For the default circular tip and for **alpha** tip bitmaps this is a **ceiling, not a rate**: dabs accumulate into a per-layer stroke texture under `blend_equation(MAX)`, so each pixel simply takes the highest alpha any overlapping dab produced and one continuous stroke can never drive alpha past the slider value — going back and forth over the same spot without lifting the pen darkens nothing further. The ceiling resets at pointer-up, so a *second* stroke does build on the first. **A color tip is the exception**: `brush_has_tip && brush_tip_is_color` switches the accumulation to premultiplied "over" compositing (`FUNC_ADD`, `ONE` / `ONE_MINUS_SRC_ALPHA`), deliberately, because per-channel MAX on colored dabs invents colors that are in neither dab (the code's example: blue + orange reading out as pink). The cost of that correctness fix is that **overlapping dabs from a color tip do compound within a single stroke**, so the same Opacity value behaves as a ceiling with one tip and as a rate with another. (The Eraser compounds too, for an unrelated reason — see [Eraser](#eraser).)
- **Hardness**: 0 - 100%
- **Fade**: 0 - 2000 px (opacity fade-out distance, exposed on the options bar)
- **Taper**: 0 - 2000 px base range, auto-scaled by document size like Size (the modal's Shape-tab slider max is `1.5 × longest-document-side`, capped at 5000 px) — size taper-out distance: brush dabs shrink toward zero over this many pixels of stroke length, independent of the Fade opacity rolloff
- **Spacing**: 1 - 200% of brush size
- **Scatter**: 0 - 100%
- **Angle**: 0 - 360 degrees (set via the modal's angle dial)
- **Symmetry**: horizontal, vertical, both (4-way), or radial (2 - 32 segments). The horizontal/vertical toggles and the **Radial Symmetry** control (with its segment-count number input) all live in the Brush options bar; see the Symmetry section for full behavior.

**Shape tab** (Brushes modal). Holds the Size / Spacing / Hardness / Opacity / Taper sliders, an angle dial, and its own copy of the preset grid.
- **The Shape tab's grid changes the tip only.** Clicking a preset here swaps the brush's bitmap and leaves every other parameter — size, spacing, jitters, sub-brushes — exactly as you set it. That is the opposite of the **Presets** tab, where clicking applies the entire preset and overwrites the current settings. Use Shape to audition tips without losing a brush you've dialed in.
- **Angle dial**: a 64 px circle; press anywhere inside it and drag to set the angle from the pointer's bearing relative to the center, rounded to whole degrees, with the value shown numerically beside it. It is exposed as a `slider` role and is keyboard-focusable.
- **Dab preview**: a static single-dab render sits next to the dial, showing the current tip at the current size, hardness, opacity, and angle.
- Slider drag ranges are pinned shorter than their true maxima — Size drags to 300 and Taper to 1000 — while each slider's numeric input still accepts anything up to the document-scaled maximum.

**Dynamics** (Brushes modal → Dynamics tab). Scatter also lives on this tab.

The four jitters are **not implemented the same way**, and the difference shows up in the stroke. **Angle Jitter** and **Opacity Jitter** are applied **GPU-side**, hashed from each dab's center position (`dabHash(u_center, …)` in `brush_dab_footer.glsl`) — every dab is randomized independently, and because the hash is purely positional the result is **deterministic**: the same path re-painted produces the same variation. **Size Jitter** and **Hardness Jitter** are applied **CPU-side** before the dab is emitted (`advanceJitterWalk`, `paint-handlers.ts`), and they are a smooth **random walk along the stroke** rather than per-dab noise — a new target is drawn every 30 – 120 px of travel for size and every 80 – 280 px for hardness, and the value smoothsteps toward it in between. Those targets come from `Math.random()`, so these two are **not** deterministic: the same path painted twice varies. (The GPU's own size-jitter uniform is passed 0 on this path, so the jitter is never applied twice.)

- **Size Jitter**: 0 - 100% — how far the size walk may dip below the base size
- **Hardness Jitter**: 0 - 100% — how far the hardness walk may dip (varies the softness of the dab falloff)
- **Angle Jitter**: 0 - 100% — per-dab rotation randomization (most visible with non-circular tips)
- **Opacity Jitter**: 0 - 100% — per-dab transparency randomization
- **Speed Size**: stroke velocity modulates brush size. A `Faster is` toggle picks the direction (`Thinner`: faster strokes shrink toward 1 px, range 0 – 100%; `Wider`: faster strokes grow up to 3× the base size, range 0 – 300%; switching back to `Thinner` clamps a value above 100 down to 100). Raw velocity is normalized against a 5 px/ms ceiling and clamped to 1, then averaged over a sliding window — and **that window length is what the `Sensitivity` toggle sets**: Low = 6 samples, Med = 3, High = 2, so Low is the most damped and High the twitchiest. The resulting size *scale* is then eased toward its target by a further 0.25 blend per dab, which is what keeps the width from stepping visibly.

**Texture** (Brushes modal → Texture tab). The tab shows a texture dropdown and an Import button; the blend-mode dropdown and the Scale slider appear **only once a texture is selected**.
- **Built-in textures**: Noise, Canvas, Grain (128×128 grayscale tiles generated procedurally from seamless value noise) — `No Texture` disables texturing
- **Import custom texture**: accepts any image the browser can decode (the picker is `image/*`, not just grayscale files) and converts it to a grayscale tile with Rec.601 luma weights. Imported textures join the dropdown next to the built-ins; the **Delete** button appears only while an imported texture is selected, so built-ins can't be removed.
- **Texture blend mode**: Multiply, Subtract, or Overlay. The texture modulates the **dab's alpha (coverage)** — with the color channels carried along premultiplied — rather than blending against the brush color: Multiply scales coverage by the tile value, Subtract by its inverse, Overlay applies the standard overlay curve to coverage.
- **Scale**: 10 - 300% (tile size relative to the source tile)
- **Each stroke gets its own tile grid.** The tiling is anchored at the stroke's **first dab** and rotated by a fresh random angle chosen when the stroke begins (`begin_stroke`, seeded from the layer id XOR the current time). Adjacent strokes therefore deliberately do *not* line up on a shared pattern grid — that is what stops a textured brush from showing an obvious repeating lattice across a filled area. The trade-off is that a texture pass is not reproducible: the same stroke re-painted gets a different rotation.
- **Texture is not part of a preset.** `Save Current` doesn't record it, and selecting any preset **resets the texture to none** (blend mode back to Multiply, scale back to 100%). Pick the preset first, then the texture.

**Sub-brushes** (Brushes modal → Sub-Brushes tab). Each sub-brush emits an additional dab co-located with every primary dab, so a single stroke can layer multiple textures, sizes, and rotations at once. A tip can carry any number of sub-brushes (there is no cap); each sub-brush picks its own tip from the same preset grid as the primary brush, and each gets its own **Remove** button. **Add Sub-Brush** appends one with no tip, Size Ratio 50%, Hardness 100, Opacity Ratio 50%, and Angle Offset and all three jitters at 0.
- **Size Ratio**: 10 - 200% (sub-brush size relative to the primary brush)
- **Hardness**: 0 - 100% (independent hardness for the sub-brush)
- **Opacity Ratio**: 1 - 100% of the primary brush opacity
- **Angle Offset**: 0 - 360° relative to the primary brush angle
- **Size / Angle / Opacity Jitter**: 0 - 100% per-dab randomization, independent from the primary brush's dynamics

**Tips & presets** (Brushes modal → Presets tab)
- **Tip kinds**: procedural circle (no bitmap), **alpha tip** (1 byte/pixel grayscale, brush color tints the dab), or **color tip** (4 byte/pixel RGBA, color comes from the bitmap itself). Color-tip dabs use premultiplied-alpha "over" compositing so overlapping rotated dabs layer correctly.
- **Custom brush tips**: import grayscale bitmaps as alpha tips. PNG/JPG/WebP supported.
- **Brush from Selection** — **Edit → Define Brush…** (alpha) and **Edit → Define Color Brush…** (RGBA), both disabled without an active selection. Each prompts for a name, then adds the tip as a custom preset and makes it active, sized to the longer edge of the captured bitmap. Two variants:
  - **Grayscale (alpha) capture**: inverts the source so dark pixels paint opaquely (Photoshop convention) and the selection mask crops to the marquee bounds.
  - **Color capture**: preserves full RGBA so the tip stamps the original colors of the selection (useful for stamp-pattern brushes).
  - The canvas right-click **Define Brush Preset** is a *separate* path with different behavior — it skips the name prompt (the tip is always called "Custom Brush") and opens the Brushes modal afterwards.
- **ABR import**: Adobe Brush file support — drops every brush in the file into the preset grid as new tips. Parsing runs in a Web Worker, so a large `.abr` doesn't stall the UI.
- **Import** (Presets tab): one button handling both formats — `.abr` brush files and `.json` preset libraries.
- **Export** (footer) opens a dedicated **Export Brushes** modal: a checkbox gallery of every preset with **Select All** / **Select None**, a live "*N* selected" count, and an Export button disabled at zero selection. Note it starts with **everything selected, built-ins included** — this is a "choose what to ship" dialog, not a custom-presets-only dump. The selection is written to `lopsy-brushes.json` as `{version: 1, presets: […]}` with Base64-encoded bitmap data plus every dynamic / sub-brush parameter. Re-importing on any machine restores them; imported presets always come back flagged custom, so a re-imported built-in becomes deletable.
- **Built-in presets** come from two independent sources that share one grid:
  - **11 procedural presets defined in TypeScript** — Hard Round, Soft Round, Airbrush, Square, Cross Hatch, Diamond, Star, Slash, Chalk, Spray, Leaf — whose tips are generated in code at startup. All ship with spacing standardized to 1% of brush size so they paint smooth strokes by default.
  - **9 bitmap tips embedded in the Rust engine** — Bubbles, Caligraphic Angle, Caligraphic Rounded, Calligraphic Split, Light Offset, Oblong, Smooth, Star, Triangle. Every PNG in `engine-rs/brushes/` is compiled into the WASM binary by `build.rs` (`include_bytes!`), so adding a file there is all it takes to ship a new tip. They load asynchronously once the engine is up and are appended to the grid, decoded to alpha with the same dark-pixels-paint-opaquely inversion, at size 30 / hardness 100 / spacing 1.
- **Delete**: removes the active preset, after a confirm prompt. Only enabled for custom presets (imported or user-saved), never built-ins.

**Shape-aware hardness**
- Tip hardness is implemented as an inner-glow falloff: the tip alpha is inverted, Gaussian-blurred, normalized, then multiplied back in as an opacity mask. This preserves the tip silhouette while softening edges — corners and straight edges soften proportionally to their distance from the interior, so non-circular tips (Square, Star, Slash, Leaf) don't degenerate into circular blobs when hardness is reduced.

**Stroke modifiers**
- **Shift+click**: draws a straight line from the previous stroke endpoint to the click point (see Straight-Line Strokes below for the shared cross-tool behavior, the live preview, and the 15° snap)
- **Hold-to-smooth**: pause the cursor mid-stroke for ~1500 ms and the recorded freehand path is auto-smoothed and re-rasterized in place. The path is first tested for straightness — if every point lies within a tolerance of the first→last line it is replaced with a perfect straight segment; the tolerance is the larger of **4 px** or **10% of the stroke length**, so long strokes with small relative wobble still snap straight. Otherwise the path is simplified with Ramer-Douglas-Peucker (9 px epsilon) and re-interpolated as a Catmull-Rom spline. Undo restores the freehand version first, then the pre-stroke state.
  - **Applies to the Brush only**, requires the GPU stroke path, and is disabled while `maskMode` is set — so it never fires when painting a layer mask or in Quick Mask.
  - **The stroke ends the moment smoothing fires.** The interaction state is reset as part of the re-raster even though the pointer button is still held: further cursor movement paints nothing more and the eventual mouse-up is a no-op, so continuing the stroke means lifting and pressing again. The timer is also only armed once the stroke has recorded at least **3 points**.
  - **The re-raster does not carry every brush parameter.** It emits uniform dabs carrying size, hardness, opacity, color, and symmetry only: angle jitter and opacity jitter are hard-coded to zero, and taper, fade, scatter, and sub-brushes are not routed through at all. A heavily scattered / jittered / tapered / sub-brush tip therefore visibly changes character the moment hold-to-smooth fires.

### Pencil
- **Size**: 1 - 100 px (base range; auto-scaled by document size). The slider knob's draggable range is capped at 250 px — matching the convention the other size sliders use (Brush and Eraser cap at 300, Spray at 500) — while the numeric input still accepts anything up to the document-scaled maximum.
- **Symmetry**: horizontal, vertical, or both
- Pixel-perfect Bresenham lines (no anti-aliasing)
- **Shift+click**: draws a straight pixel-perfect line from the previous stroke endpoint

### Eraser
- **Size**: 1 - 200 px (base range; auto-scaled by document size)
- **Opacity**: 1 - 100%
- **Hardness**: fixed internal soft falloff (0.8) — there is no user-facing hardness control; the options bar exposes only Size and Opacity
- **Shift+click**: erases a straight line from the previous stroke endpoint

**The eraser is a separate dab engine, not the brush running in a subtract mode.** The brush's dab is *procedural* — `circleStamp` in `brush_dab_header.glsl` computes the falloff analytically per fragment from `u_hardness`. The eraser instead rasterizes a stamp on the **CPU** (`lopsy_core::brush::generate_brush_stamp`, called with `size.ceil()` and the fixed hardness 0.8), quantizes it to 8-bit, uploads it as an RGBA8 texture once per batch, and `eraser_dab.glsl` samples that bitmap through `u_stampTex` with LINEAR filtering. The two falloff curves do agree where they overlap — both are `1 − smoothstep((t − hardness) / (1 − hardness))` — but the shader multiplies in a 1 px anti-aliased rim (`edge = 1 − smoothstep(radius − 1, radius, dist)`) that the CPU stamp has no equivalent of, and the CPU stamp truncates rather than rounds on the way to `u8`.

- **Only Size and Opacity reach the dab.** `eraser-stroke.ts` reads exactly those two settings; hardness is the hard-coded `0.8` and spacing is a hard-coded `Math.max(1, size * 0.25)`. The **Spacing setting, the tip bitmap, all four jitters, scatter, angle, texture, flow, fade, taper, speed-size, and sub-brushes are all dropped** — the same shape of gap as [mask editing](#editing-a-layer-mask), and for the same reason: this is a second implementation that was never grown to match. Symmetry and the active selection *are* honored (`mirrorBatchPoints`, and `u_hasSelection` in the shader, which additionally modulates the erase amount by the mask value so a feathered selection erases softly).
- **Opacity does not behave like the Brush's.** A brush stroke with a circular or alpha tip accumulates into a stroke texture under `blend_equation(MAX)`, so overlapping dabs within one stroke cannot push alpha past the opacity ceiling — a single pass lands at exactly the slider value. The eraser has no stroke texture: `eraser_dab.glsl` reads the layer, writes `existing.a * (1 − stamp × opacity)`, and blits the result straight back over the layer **once per dab**, so every dab sees the previous dab's output and the erasure **compounds multiplicatively**. With spacing pinned at 25 % of size, roughly four dabs cover any given pixel in one pass, so an Opacity of 50 % removes about `1 − 0.5⁴ ≈ 94 %` of a pixel's alpha in a single stroke rather than 50 %. Opacity on the eraser is therefore closer to a rate than a ceiling.
- **Every eraser dab costs two full-texture passes.** The brush scissors each dab to its bounding box — the code's own note is that without it a dab "discards >99.98% of invocations for a typical brush size" — and `draw_pencil_line` does the same. `apply_eraser_dab_batch` enables no scissor at all: per point in the batch it sets `gl.viewport(0, 0, w, h)` and draws a fullscreen quad into `scratch_fbo_a`, then blits the entire scratch texture back over the layer. On a large layer that pair of full-canvas passes, not the erasing itself, is the dominant cost — the same pattern already documented for [mask dabs](#editing-a-layer-mask).
- **Known defect — the scratch texture is document-sized, but the eraser's viewport is layer-sized.** `scratch_texture_a` is allocated at document dimensions, while the eraser's viewport and its blit both use the *layer* texture's dimensions. `end_stroke` guards precisely this case for brush strokes (its comment: the shared scratch texture is only doc-sized, so it allocates a temporary "when the layer has been expanded beyond the doc"); the eraser path has no equivalent guard, so erasing on a layer that has been expanded past the document bounds samples and writes beyond the scratch texture's extent. This is the same defect shape as the mask dab batches.
- The eraser body also never sets or clears GL blend state, inheriting whatever the previous operation left bound. It happens to be correct today only because `apply_dab_batch` disables blending on its way out, so the read-modify-write lands as a plain replace.

### Dodge / Burn
- **Mode**: dodge or burn (default **dodge**)
- **Exposure**: 1 - 100% (default 50) — reaches the shader as `exposure / 100`, linear, with no further scaling
- Shortcut: `O`
- **Size**: 1 - 200 px (base range; auto-scaled by document size). **This is the Brush's size setting, not a separate one** — the Dodge options bar binds `settings.brush.size` directly, so resizing here (by slider or by `[` / `]`) resizes the Brush too, and vice versa. Exposure and Mode are the only settings Dodge/Burn owns.
- **Shift+click**: applies dodge/burn along a straight line from the previous stroke endpoint
- **Hardness is a hard-coded 0.5** and spacing a hard-coded 25 % of size (`DODGE_HARDNESS`, `dodgeSize * 0.25` in `dodge-interaction.ts`). Neither is exposed, and the Brush's Spacing setting does not reach it — see [Dab Engines](#dab-engines-shared-across-paint-tools).
- **This is the best-built of the non-brush dab engines.** It is the only one besides Sponge that opens a real stroke: `begin_dodge_burn_stroke` allocates a per-stroke *coverage* texture, each dab MAX-accumulates its scalar strength (`stamp × exposure`) into it, and the compositor renders a **live preview** from that coverage without touching the layer. The layer is only mutated at pointer-up, when `end_dodge_burn_stroke` bakes the coverage in once. Consequences: **overlapping dabs within one stroke do not compound** — dragging back and forth over the same spot in a single stroke is exactly as strong as one pass, and pushing further requires releasing and stroking again — and an active **selection is honored** (the dab shader samples the selection mask in document space, using the layer offset).
- **The math is a plain screen / multiply against white and black.** Dodge is `rgb += (1 − rgb) × strength`, burn is `rgb *= (1 − strength)` (`dodge_burn.glsl`). Both apply to **every tone equally — there is no Range control** (shadows / midtones / highlights) of the kind Photoshop's dodge and burn have, so the tool cannot be aimed at one part of the tonal range.
- The dab's falloff is `hardness + (1 − hardness)(1 − t²)`, i.e. **1.0 at the center decaying only to 0.5 at the rim**, with a 1 px `smoothstep` feather doing the final drop to zero. It is much harder-edged than the name "soft" suggests.
- **Exposure 100 is a wipe, not a strong nudge.** Coverage is `clamp(stamp × exposure, 0, 1)` and `stamp` is exactly 1.0 at the dab center, so the slider's top writes coverage 1.0 — and `rgb += (1 − rgb) × 1` / `rgb *= (1 − 1)` takes those pixels to **pure white or pure black**, in a single stroke, over whatever was underneath. The top of the [Sponge](#sponge)'s identically-plumbed slider reaches only 0.25; see [one code path, two labels](#the-inverse--one-code-path-two-labels-dodges-exposure-and-sponges-strength).
- **The live preview and the final bake agree.** `render_dodge_burn_preview` and `end_dodge_burn_stroke` both run `dodge_burn.glsl` with the same coverage texture, the same `u_mode`, and `u_exposure = 1.0` (the exposure is already baked into the coverage), so what you see during the drag is what lands on pointer-up. Sponge's pair matches in the same way. The preview is skipped, leaving the raw layer visible, only if the layer texture has been resized since the stroke began.

### Sponge
- **Mode**: saturate or desaturate (default **desaturate** — the one tool in this family whose default mode is the subtractive one)
- **Strength**: 1 - 100 (default 50)
- **Size**: 1 px – document-scaled max (default 30; base cap 200 px)
- Shortcut: `Y`
- Converts each affected pixel to HSL, adds (saturate) or subtracts (desaturate) from the saturation channel with a clamp to 0 – 1, and writes back to RGB. Internal hardness is fixed at 0.5; dab spacing is 25% of the brush size.
- **Strength is neither linear nor a saturation delta.** `scaleSpongeStrength` squares the normalized slider and scales it by a quarter — `(slider / 100)² × 0.25` — so the delta actually applied at the center of a dab is **0.25 at Strength 100** and **0.0625 at Strength 50**. Halving the slider gives a *quarter* of the effect, and the tool can never shift saturation by more than 25 points in a single stroke. The other slider labeled **Strength** — [Smudge](#smudge)'s — is plain `raw / 100` with a maximum of 1.0, so the same displayed number is **eight times** stronger there. The closer comparison is [Dodge / Burn's **Exposure**](#the-inverse--one-code-path-two-labels-dodges-exposure-and-sponges-strength), which is *the same uniform in the same shader* and still 8× apart at the shared default of 50 — 400× apart at 1.
- The falloff is **not Gaussian and does not reach 0 at the edge**: it is `hardness + (1 − hardness)(1 − t²)` with hardness 0.5, so a dab is at full strength in the center and still at **half strength at the rim**, where a 1 px `smoothstep` feather takes it the rest of the way down. Sponge shares `dodge_burn_dab.glsl` with Dodge / Burn for this — the uniform the shader calls `u_exposure` is what the Sponge options bar calls Strength.
- **Same stroke architecture as Dodge / Burn**: a per-stroke coverage texture, MAX-accumulated, previewed live by the compositor and baked into the layer only at pointer-up. So **overlapping dabs within one stroke do not compound**, and an active **selection is honored**.
- **Known defect — the engine's teardown forgets the Sponge's half of that architecture.** The two tools keep structurally identical state (`stroke_{dodge,sponge}_textures`, `_preview_textures`, `_modes`), and `end_sponge_stroke` is the *only* place the Sponge's is released. `clear_all_layers` — which runs on **New Document** and on **Open** — drains the dodge triple and never touches the sponge triple. The JS side is symmetric (`finalizePendingStrokeGlobal` ends a pending dodge or sponge stroke alike), but neither `createDocument` nor `openImageAsDocument` calls it before `clearEngine()`, so that Rust fallback is the only thing between an in-flight stroke and a leak — and it covers one of the two tools. Replacing the document mid-sponge-stroke therefore strands two full-canvas textures in the pool for the life of the session. Nothing renders wrongly: layer ids are UUIDs, so the orphaned map entries can never be matched to a layer in the new document.
- **Fully transparent pixels are skipped** (`c.a < 0.001` returns the pixel untouched), so sponging over empty canvas does nothing — unlike Dodge / Burn, which does not check alpha.
- **A full desaturation takes four strokes.** The 0.25 ceiling is on the *stroke*, not the tool: coverage is MAX-accumulated and applied once, so no amount of scrubbing within one gesture moves saturation further than 25 points. Releasing and stroking again applies another 0.25 to the new pixel values.
- **`[` / `]` do not resize the Sponge** — the size shortcut has no branch for this tool, so its Size is slider-only (see [Single-Key Shortcuts](#single-key-shortcuts)).
- **Shift+click**: applies the sponge along a straight line from the previous stroke endpoint

### Clone Stamp
- **Size**: 1 - 200 px (base range; auto-scaled by document size)
- **Alt/Cmd+click**: set the source sample point
- **Shift+click**: stamps along a straight line from the previous stroke endpoint, preserving source offset
- **Cursor**: a circular brush-size cursor (no crosshair fallback). Once a source point is set, the cursor becomes a live **source preview** — the pixels under the source offset are drawn at 70% opacity, clipped to the brush circle, with a white outline ring around the cursor and a small crosshair marking the current source point. The preview tracks the source offset as you move, so you can see exactly what will be stamped before painting.
- **Size is the only setting that reaches the dab.** There is no opacity, flow, or hardness control, and none is read: hardness is a **literal `0.8` written into `clone_stamp.glsl`** rather than a uniform, and spacing is the usual hard-coded 25 % of size. Every dab therefore stamps the source at full strength.
- **The Clone Stamp ignores the active selection.** `clone_stamp.glsl` declares no selection uniform and `clone_stamp_gpu.rs` sets none, so a marquee does not confine it — cloning paints straight across the selection edge. Same for Symmetry. See [Dab Engines](#dab-engines-shared-across-paint-tools).
- **The source is the layer as it is being written, not a snapshot taken at pointer-down.** Each dab renders into the scratch texture and is blitted back over the layer before the next dab runs, and the shader samples that same layer texture for its source. When the source and destination circles overlap, dab *n+1* clones dab *n*'s output — the classic smearing feedback — rather than repeatedly copying the original pixels.

### Healing Brush
- **Size**: 1 px – document-scaled max (default 20; base cap 200 px, scales with canvas size). **This is the only paint-tool Size slider whose drag track is uncapped** — it passes no `sliderMax`, so the knob spans the entire document-scaled range (up to 5000 px) while every sibling's knob stops at 300. Given that a healing dab is the most expensive in the app (two synchronous readbacks each, below), this is the worst tool to make a 5000 px dab easy to reach. See [Controls That Share a Label](#controls-that-share-a-label-but-not-a-meaning).
- **Opacity**: 1 - 100% (default 100). **A rate, not a ceiling** — each dab blends `healed × a + existing × (1 − a)` back onto the layer with `a = source.a × stamp × opacity`, and the next dab reads that result, so overlapping dabs compound toward full replacement (the same read-modify-write property that makes the [Eraser](#eraser)'s Opacity a rate).
- **Alt/Cmd+click**: set the healing source sample point
- **Shift+click**: heals along a straight line from the previous stroke endpoint, preserving source offset
- Color-correction healing: subtracts the source mean color and adds the destination mean color, so texture is borrowed from the source while tone matches the destination
- Soft quadratic falloff at the dab edge for seamless blending (`(1 − t²)` plus a 1 px `smoothstep` rim — this one really does reach zero at the edge, unlike Dodge / Burn and Sponge)
- **Every dab costs two synchronous GPU→CPU readbacks.** The two means are not computed on the CPU and not kept on the GPU: `compute_region_mean` renders `healing_mean.glsl` into a **1 × 1** viewport and then calls `gl.readPixels` to fetch the single resulting pixel — once for the source region and once for the destination — before the dab itself can be drawn. A `readPixels` stalls the pipeline until the GPU drains, so a healing stroke pays **two full pipeline stalls per dab**, on top of the two full-texture passes every dab in this family already costs. This is by a wide margin the most expensive paint tool in the app.
- **The "mean" is a 32-tap estimate, quantized to 8 bits.** `healing_mean.glsl` averages a fixed 32-point Poisson-disk sample of the region (skipping fully transparent taps), not every pixel under the dab, so the correction is a stochastic estimate — deterministic, but biased for small radii where 32 taps land on a handful of pixels. The result is then read back as `UNSIGNED_BYTE`, so both means are rounded to 8 bits per channel before they reach the shader — despite the function's own header comment claiming the path exists to preserve FP16 precision.
- **The Healing Brush ignores the active selection**, and Symmetry, for the same reason as the Clone Stamp: `healing_dab.glsl` declares no selection uniform. It also samples its source from the progressively updated layer, so overlapping source and destination smear the same way.
- **Cursor**: the same circular brush-size cursor and live **source preview** as the Clone Stamp — once a source point is set, the source pixels render at 70% opacity inside the brush circle with a white outline ring and a crosshair at the source point (previously the heal brush fell through to a plain crosshair).

### Smudge
- **Size**: 1 - 200 px (base range; auto-scaled by document size)
- **Strength**: 0 - 100% (how far pixels are pulled along the stroke)
- Shortcut: `R`
- Pulls colors along the stroke direction, blending neighbouring pixels. Each fragment samples the pixel that sat at `fragPos − (center − prev)` and mixes toward it by `falloff × strength`, which is what produces the drag.
- The falloff is **quartic** — `(1 − d²)²` — plus a 1 px edge feather, deliberately weighting the center so the outer ring fades out instead of ending on a visible circular silhouette.
- **Smudge ignores the active selection** (`smudge_dab.glsl` declares no selection uniform) and Symmetry.
- **Smudge is the only read-modify-write dab engine that guards its layer size.** It calls `ensure_layer_full_size` before dabbing, with a comment naming the exact failure the others still have: the dispatch writes to a document-sized scratch FBO with the viewport set to the *layer* texture size, so a layer smaller than the scratch blits back garbage as full-width streaks. The Eraser, Clone Stamp, and Healing Brush take the same route without the guard — see [Dab Engines](#dab-engines-shared-across-paint-tools).
- **Shift+click**: the straight-line smudge is implemented but does not fire after a smudge stroke — smudge is not registered as a paint tool, so its strokes never record a line origin. See the Smudge caveat under Straight-Line Strokes.

### Spray
- **Size**: 1 - 500 px (base range; auto-scaled by document size; default 40) — **this is the diameter of the spray cloud, not of the marks it makes.** It is halved into a scatter radius, and dots land inside that circle at `dist = √random × radius`, which spreads them at uniform *area* density rather than bunching them toward the center.
- **Density**: 1 - 100 (default 20) — a raw **count of dots per emission**, not a dots-per-area rate. Since Size grows the cloud's area quadratically while the count stays fixed, raising Size at a constant Density makes the spray progressively **thinner**, not bigger-and-equally-solid.
- **Opacity**: 1 - 100% (default 60) — a ceiling that individual dots reach only by chance: each dot gets `opacity × (0.4 + 0.6 × random) × (1 − 0.3 × dist/radius)`, so dots carry 40 - 100% of the setting, and dots at the rim are scaled by a further 0.7.
- **Softness**: 0 - 100% (default 30) — **the label is inverted.** The value is `settings.spray.hardness`, and it reaches the brush dab shader's `u_hardness` with no transformation (`hardness = hardnessPct / 100`, passed through `applyBrushDab`'s sixth parameter and assigned to the uniform verbatim). In `circleStamp`, a *higher* `u_hardness` means a *larger* fully-opaque core — everything inside `t ≤ u_hardness` is painted at full strength — so **Softness 100 paints the hardest possible dots and Softness 0 the softest.** The [Brush](#brush) exposes the identical field, normalization and uniform under the label "Hardness" and is the one that reads correctly; only the Spray options bar names it backwards. The default of 30 is soft-ish, which is consistent with either reading — likely why the inversion has gone unnoticed.
- **The grain scales with Size, but only above Size 100.** Each dot's radius is drawn uniformly from `[max(1, 0.02 × R), max(2, 0.12 × R)]`, rounded to a whole pixel, and stamped as a dab of diameter `2 × radius`. **`R` here is the cloud radius (`Size / 2`), not Size**, so above the floors a dot's diameter is **2 - 12 % of the Size value** — half what the `0.02` / `0.12` coefficients read like. (At Size 200 the dots span 4 - 24 px, which is where the tempting "4 - 24 %" comes from: it is a percentage of the radius, not of Size.) Because it is the *radius* that gets rounded, every dot's diameter is an even number of pixels. The texture keeps its proportions as Size changes. The two floors break that at small sizes: the upper bound is pinned at 2 px until Size reaches 34, and the lower bound at 1 px until Size reaches 100. Below Size 34 every dot is a 1 - 2 px speck whatever Size says, and Size only spreads the same specks over a wider circle.
- Shortcut: `J`
- Holding the cursor still keeps emitting dots on a 166 ms timer (~6 Hz) so paint accumulates over time, mimicking an airbrush. Dragging emits a fresh cloud each time the pointer has travelled `max(1, 0.3 × Size)` px, so consecutive clouds overlap by about 70% of their width at every Size.
- **No shift+click straight line**: unlike the other paint tools, the spray handler never reads the shift key, so shift+click sprays a normal dab at the click point. A shift-hold line preview *is* drawn (see below) even though clicking will not follow it.
- **Spray has no dab engine of its own.** It generates dots and paints each one with a plain **Brush** dab (`applyBrushDab` per dot, flow 1, all jitters 0). Two things follow from that. It **inherits the Brush's active tip**: `brush_has_tip` / `brush_tip_is_color` are engine-global state synced from the Brush's selected tip, not per tool, so choosing a textured or colored brush preset and then switching to Spray sprays that tip's bitmap even though the Spray options bar exposes no tip control. And its dots **do honor the active selection**, since they go through the brush dab shader.
- **Known defect — spray dabs never reach a stroke texture, so spray can only lighten.** The shared paint-tool path opens a stroke texture at pointer-down, but `handleSprayDown` then calls `pushHistory('Spray')`, and `pushHistory` runs `endStroke` first — which *removes* that stroke texture — before the first dot is emitted. `apply_dab_batch` falls back to `stroke_tex.or_else(layer_texture)`, so every spray dot MAX-blends **directly onto the layer**. Since a dab is emitted premultiplied (`vec4(color.rgb × a, a)`) and `MAX` ignores the blend factors, the result is a per-channel maximum against the artwork already there: spraying a **darker color over opaque lighter pixels does nothing at all**, and spraying any color only ever raises channel values. The Brush avoids this because its dabs accumulate in an initially-empty stroke texture that is composited over the layer properly at `end_stroke`; Spray never gets one. Neither `handleSprayMove` nor the ~6 Hz timer re-opens it.
- **Symmetry does not apply.** Spray calls the dab entry point directly rather than going through the brush stroke module, so it never mirrors points (see [Symmetry](#symmetry)).
- **No size cursor and no `[` / `]`**: Spray is the one painting tool left out of both size affordances. It is absent from the brush-cursor tool set, so it falls through to a plain crosshair with no ring showing the dab footprint, and absent from the size-shortcut branches, so the brackets do nothing. Both gaps bite hardest here, since Spray has the widest size range of any tool (base cap 500 px).

### Dab Engines (shared across paint tools)

The paint tools do not share a dab implementation. There are **three different architectures** behind them, and which one a tool uses decides whether its opacity behaves like a ceiling or a rate, whether a selection confines it, and what a single dab costs.

| Tool | Architecture | Settings that reach the dab | Selection | Symmetry | GPU work per dab |
|------|--------------|------------------------------|-----------|----------|------------------|
| Brush | stroke texture, `MAX` (over-composite for color tips) | all of them | yes | yes | 1 scissored pass |
| Pencil | stroke texture, `MAX` | size | yes | yes | 1 scissored pass |
| Spray | brush dabs, but **no** stroke texture | size, density, opacity, softness (+ the Brush's tip) | yes | no | 1 scissored pass **per dot** |
| Dodge / Burn | coverage texture, `MAX`, baked at pointer-up | brush size, exposure, mode | yes | no | 1 full pass |
| Sponge | coverage texture, `MAX`, baked at pointer-up | size, strength, mode | yes | no | 1 full pass |
| Eraser | read-modify-write onto the layer | size, opacity | yes | yes | 2 full passes |
| Smudge | read-modify-write onto the layer | size, strength | **no** | no | 2 full passes |
| Clone Stamp | read-modify-write onto the layer | size | **no** | no | 2 full passes |
| Healing Brush | read-modify-write onto the layer | size, opacity | **no** | no | 2 full passes **+ 2 readbacks** |

**The three architectures**

1. **Stroke texture** (Brush, Pencil). Dabs accumulate into a per-stroke texture that starts empty and is composited over the layer once, at `end_stroke`. Because they accumulate under `blend_equation(MAX)`, overlapping dabs cannot push past the slider, so **Opacity is a ceiling** — except for color tips, which over-composite instead and therefore do compound.
2. **Coverage texture** (Dodge / Burn, Sponge). A per-stroke texture accumulates each dab's *scalar strength* under `MAX`; the compositor renders a live preview from it and the layer is mutated once, at pointer-up. Overlapping dabs within a stroke **do not compound**, and the layer is untouched until the gesture ends.
3. **Read-modify-write** (Eraser, Smudge, Clone Stamp, Healing Brush). Each dab reads the layer, draws a full-screen quad into the shared scratch FBO, and blits the whole scratch texture straight back over the layer — then the next dab reads *that*. So these tools **compound within a single stroke** (the Eraser's Opacity is a rate, not a ceiling — see [Eraser](#eraser)), and each dab costs two full-texture passes instead of one scissored one.

**What every non-brush engine drops.** Spacing is hard-coded to `max(1, size × 0.25)` in all of them, so the Brush's Spacing setting reaches only the Brush. None of them reads the tip bitmap, the four jitters, scatter, angle, texture, flow, fade, taper, speed-size, or sub-brushes. This is the same shape of gap documented for [mask editing](#editing-a-layer-mask) and the [Eraser](#eraser), and it has the same cause: each is a second implementation that was never grown to match the first.

**Three tools paint straight through an active selection.** Smudge, Clone Stamp, and Healing Brush are unconstrained by a marquee — their shaders declare no selection uniform at all and their Rust callers set none, and nothing upstream clips the dab points either. This is not a soft-mask subtlety; the selection is simply absent from those code paths. Every other paint tool samples the selection mask in the shader and is confined by it.

**Only the scissored engines are cheap.** The brush's own note is that scissoring a dab to its bounding box "discards >99.98% of invocations for a typical brush size". Of the nine tools above only the three brush-dab paths do it; the other six run full-texture passes for every dab, so their cost scales with the layer, not the brush.

**Five falloff profiles, and three comments that name the wrong one.** Architecture is not the only thing these engines fail to share — the *shape of a single dab* is written five different ways, and three of the shaders carry a comment claiming they match the brush when none of them does. The brush's curve is a **plateau**: full strength out to `t ≤ hardness`, then `1 − smoothstep(0, 1, (t − hardness)/(1 − hardness))` to zero at the rim (`circleStamp`, `brush_dab_header.glsl`). It is not quadratic at any setting.

| Profile | Formula (`t` = dist ÷ radius) | Used by | At the rim |
|---------|------------------------------|---------|------------|
| **Plateau + smoothstep** | `1` for `t ≤ h`, else `1 − smoothstep(0,1,(t−h)/(1−h))` | Brush (circular tip, `h` = Hardness), Spray (same shader, "Softness"), Eraser (`h` = 0.8, rasterized on the CPU) | **0** |
| **Hardness-floored quadratic** | `h + (1 − h)(1 − t²)` | Dodge / Burn and Sponge (`h` = 0.5), Clone Stamp (`h` = 0.8), Quick Mask and layer-mask dabs (`h` = the Brush's Hardness, or 0.8 for the eraser) | **`h` — never zero** |
| **Plain quadratic** | `1 − t²` | Healing Brush | **0** |
| **Quartic** | `(1 − t²)²` | Smudge | **0** |
| **Hard block** | integer cell, no falloff | Pencil (on layers and on masks) | aliased |

Every one of these is closed by the same 1 px `edge = 1 − smoothstep(radius − 1, radius, dist)` rim, which is the *only* thing that takes the second family to zero.

The comments that get it wrong are `clone_stamp.glsl` ("Compute stamp falloff (same as brush_dab)"), `quick_mask_dab.glsl` ("Quadratic falloff matching brush stamp") and `smudge_dab.glsl` ("Soft quadratic falloff (matches brush_dab)") — a family-two curve, a family-two curve, and a quartic, all pointing at a plateau. Two consequences are worth stating in numbers:

- **The Eraser's hardness 0.8 and the Clone Stamp's hardness 0.8 are the same literal in the same role and make completely different dabs.** At 90% of the radius the Eraser's stamp has fallen to **0.50** and the Clone Stamp's is still at **0.84**; the Eraser reaches 0 at the rim while the Clone Stamp is at 0.80 and drops only through the 1 px rim. The Clone Stamp's dab is effectively a flat disc with an anti-aliased edge, which is why it stamps so much harder than "hardness 0.8" suggests.
- **Hardness on a mask is not Hardness on a layer.** Mask and Quick Mask dabs forward the Brush's Hardness slider into the *floored quadratic*, so the same slider that gives a plateau-and-fade on pixels gives a dab that starts falling immediately and stops falling at `h`. At Hardness 100 a mask dab is a **completely flat disc**; at Hardness 50 it is still at 0.50 at the rim where the layer brush would be at 0. See [Editing a Layer Mask](#editing-a-layer-mask).

**Known defect — the scratch texture is document-sized, but three of the four read-modify-write engines set a layer-sized viewport.** `scratch_texture_a` is allocated at document dimensions while the Eraser, Clone Stamp, and Healing Brush set `gl.viewport` and blit at the *layer* texture's dimensions, so painting on a layer that has been expanded past the document bounds reads and writes outside the scratch texture's extent. Smudge is the exception — it calls `ensure_layer_full_size` first, and its comment names the symptom ("full-width streak artifacts"). Dodge / Burn and Sponge call it too, at `begin_*_stroke`. `end_stroke` guards precisely this case for brush strokes; the three unguarded paths have no equivalent.

**Known defect — five tools push two undo entries per stroke.** The shared paint-tool path at pointer-down pushes a history entry whose label is `activeTool === 'brush' ? 'Brush' : activeTool === 'pencil' ? 'Pencil' : 'Eraser'`, so **every tool that is not the brush or the pencil is labeled "Eraser"** — and Dodge / Burn, Sponge, Clone Stamp, Healing Brush, and Spray each then push their own correctly-labeled entry from their own handler. `pushHistory` does not coalesce, so one stroke with any of those five leaves two rows in the History panel: a spurious **"Eraser"** followed by the real one, and undoing the stroke takes two steps. (Smudge is unaffected — it is not registered as a paint tool, which is also why it has no straight-line origin.)

### Straight-Line Strokes (shared across paint tools)

After you finish a stroke, its endpoint is remembered as the origin for a straight-line stroke. **Shift+click** then paints a straight line from that origin to the click point instead of a single dab. The origin is only remembered per layer — switching the active layer discards it.

**Which tools support it**

| Tool | Shift+click line | Cmd/Meta 15° snap | Notes |
|------|------------------|-------------------|-------|
| Brush, Pencil, Eraser | yes | yes | the full behavior |
| Dodge / Burn, Sponge | yes | no | line only, no angle snap |
| Clone Stamp, Healing Brush | yes | no | Cmd is already taken — see below |
| Spray | no | no | preview draws, click does not follow it |
| Smudge | not on its own | no | see the caveat below |

- **Cmd/Meta+shift**: while shift-clicking a line, holding Cmd/Meta snaps the endpoint to the nearest **15°** increment about the origin (matching the gradient tool's snap). This is implemented only in the shared brush/pencil/eraser handler — the other paint tools draw an unsnapped line.
- **Clone Stamp / Healing Brush caveat**: those two tools branch on `Alt || Cmd` to set the clone source *before* any shift-line handling, so Cmd+shift+click **re-sets the source point and paints nothing** rather than snapping. Use Alt to set the source and plain shift+click for lines.
- **Smudge caveat**: the smudge handler implements shift-line smudging, but smudge is not registered as a paint tool, so a smudge stroke never records an endpoint. Shift+click therefore does nothing after a smudge stroke; it only fires if the *previous* stroke came from a different paint tool on the same layer (e.g. brush, then switch to smudge, then shift+click). Smudge also draws no shift-hold preview.

**Shift-hold line preview**

Holding **Shift** while hovering the canvas draws a live hairline showing exactly where the straight-line stroke will land, before you commit it.

- **Requires a prior stroke** on the **active layer** — a shift-hover on a fresh document or a just-switched layer shows nothing.
- Drawn for every registered paint tool (brush, pencil, eraser, clone stamp, healing brush, dodge/burn, sponge, spray) — note this includes spray and excludes smudge, neither of which matches its actual shift+click behavior.
- **Style**: a solid (undashed) hairline — a 1.5 px white under-stroke for contrast against dark artwork, over-stroked at 0.75 px in **black** normally or **blue** (`#2196f3`) while the 15° snap is engaged, so the color tells you whether the angle is snapped. Widths are divided by zoom, so the line stays ~1.5 screen px at any magnification.
- **Cmd/Meta** (or **Ctrl**) while hovering snaps the previewed endpoint to 15°. Note the preview accepts Ctrl as a Meta alias but the actual paint commit does not — on Windows/Linux, Ctrl+Shift+hover previews a *snapped* line while the click draws an *unsnapped* one.
- The preview updates from a global key listener as well as on pointer-move, so pressing or releasing the modifier re-draws it without moving the mouse.
- **Clears on**: releasing shift, leaving the canvas, switching tools, changing the active layer, or finishing a stroke (it reappears on the next hover).

---

## Shape & Vector Tools

### Shape Tool
- **Shape types**: ellipse, polygon. A rectangle/square is drawn as a
  4-sided polygon (set sides to 4); triangles use sides=3, etc.
- **Output**: pixels or path
- **Fill color**: any color or none
- **Stroke color**: any color or none
- **Fill / Stroke swatches**: each is a small swatch in the options bar. **Click** opens an inline color popover (with a "Remove fill" / "Remove stroke" button that sets it back to none); **double-click** instead pushes that color into the foreground swatch and reveals the Color panel — opening it if it was closed, bringing its tab forward if it was a background tab, and raising its window if it was a buried floating panel. When a fill or stroke is set to none the swatch is replaced by a `—` button that re-adds a color (opaque white for fill, opaque black for stroke) and opens the popover.
- **Stroke width**: 1 - 50 px
- **Polygon sides**: 3 - 64
- **Corner radius**: 0 - 200 px
- **Aspect ratio lock**: width/height ratio constraint — the same global setting the two marquees and Crop use, so a ratio locked for a crop still constrains shapes; see [Options Bar](#options-bar).
- **Cmd/Meta+drag**: holding meta while dragging temporarily forces a 1:1 aspect ratio (perfect square / circle / regular polygon) regardless of the persistent aspect-ratio toggle. Releasing meta returns to the unconstrained or persistently-locked behavior.
- **The drag preview is live on canvas but not in the panels.** Each pointer-move re-renders the shape straight into the layer texture, so what you see follows the cursor; the layer's pixel version is bumped only on release, so the Layers and Channels thumbnails keep showing the pre-drag pixels until then (#732 — see [Channels Panel](#channels-panel)).
- **Click without dragging** (pixel output only): a click that doesn't drag past the threshold opens the **Shape Size modal** — type an exact Width and Height (1 - 16384 px) and the shape is created at the click point with those dimensions (Photoshop-style click-to-create). `Enter` confirms, `Escape` (or clicking the backdrop) cancels. In **path** output mode a no-drag click is ignored instead of opening the modal.

### Path / Pen Tool
- **Stroke width**: 1 - 50 px
- Bezier anchors with in/out handles
- Close path, split segment, convert anchor
- Stroke path to pixels
- Convert path to selection
- **Cmd/Meta+click an anchor**: toggles between corner (no handles) and smooth spline (double-click does the same)
- **Path edits are undoable.** Each mutating edit pushes its own metadata history entry at the start of the operation — *Move Path Anchor*, *Edit Path Handle*, *Straighten Path Anchor*, *Split Path Segment*, and *Add Path* when an in-progress anchor list is committed — and the document's stored path list travels inside every history snapshot, so `⌘Z` steps back through path construction the same way it steps back through brush strokes. (*Stroke Path* rasterizes, so it pushes a full pixel snapshot instead.)
- **Enter** (with the Path tool active and ≥ 2 anchors placed): strokes the in-progress anchor list directly to pixels on the active layer using the current stroke width — no need to commit the path through the Paths panel first.
- **Escape** (with the Path tool active and anchors placed): discards the in-progress anchor list without stroking. When no path is in progress, Escape falls through to its global behavior (clears any active selection and cancels any pending transform).
- **Boolean path operations** (Path options bar buttons + **Path** menu in the menu bar): Unite, Subtract, Intersect, Exclude. Operates between the selected path and the most recently added other path; both source paths are consumed and replaced by the result. Implemented by flattening Bezier paths to polygons, rasterizing to binary masks, combining pixel-wise, then tracing contours with marching squares and refitting Catmull-Rom/Bezier anchors. Buttons are disabled until the document contains at least 2 paths and one is selected.

### Text Tool
- **Font size**: 1 - 500
- **Font family**: chosen from a searchable **font browser** (see below) covering 1,954 families — 14 system faces (Inter, Arial, Helvetica, Georgia, Times New Roman, Courier New, JetBrains Mono, Verdana, Trebuchet MS, Impact, Comic Sans MS, Palatino, Garamond, Brush Script MT) plus 1,940 Google Fonts — and, in Chromium browsers, **every family installed on the machine** (see *Local fonts* below).
- **Font weight**: the dropdown lists exactly the weights the selected family ships, labelled Thin (100) / ExtraLight (200) / Light (300) / Regular (400) / Medium (500) / SemiBold (600) / Bold (700) / ExtraBold (800) / Black (900) / UltraBlack (1000). Families outside the catalog fall back to Regular + Bold. Switching to a family that lacks the current weight snaps to the numerically nearest one it does have.
- **Font style**: normal or italic
- **Style and stretch snap to what the family actually ships.** cosmic-text only considers faces whose style *and* stretch equal the request exactly and has no cross-style fallback, so before shaping, the engine (`snap_face_attrs` in `text_gpu.rs`) looks at the loaded faces of the requested family and adjusts: a family with no upright face renders its italic one (Zapfino ships a single face whose OS/2 table sets the ITALIC bit, though the OS calls it "Regular"); Italic requested on a family with no italic face renders upright rather than falling back to Inter; and the stretch is the family's closest to normal for that style (Impact declares `usWidthClass 3`, condensed, and would otherwise never match; Papyrus.ttc ships Condensed and Regular faces, and the Regular one wins). A family the engine has no faces for is passed through untouched so the ordinary fallback chain still runs. Nothing in the UI reflects the snap — the Style dropdown keeps showing the requested value.
- **Text align**: left, center, right, justify — **but only area text is ever aligned.** Alignment needs a box to align within, and point text has none: the engine calls `set_size` only when an `areaWidth` is present, so for point text cosmic-text falls back to using each paragraph's *own* measured width as the alignment box. Every correction is then zero, and all four settings render byte-identically flush-left however many lines the layer has. Verified against the software renderer: a two-line point-text layer produces the same pixels and the same caret x (`0`) for left / center / right / justify, while the same text in a 400 px box puts the caret at `0` / `197.9` / `395.7`. The dropdown stays enabled and still shows the choice, so nothing signals that it is inert — and because alignment is per-paragraph, this is visible the moment a point-text layer has two lines of different lengths.
- **Justify additionally needs a wrap.** cosmic-text never justifies the last visual line of a paragraph, and a paragraph that fits its box *is* entirely last line — so justify is indistinguishable from left until a line actually wraps. Once one does, the non-final lines stretch to the box (a wrapping run in a 300 px box goes from 275 px wide left-aligned to 309 px justified).
- **Line height**: stored per text layer (default 1.4× the font size). Not in the options bar, but adjustable in the **Text panel** (0.5× – 4×).
- **Letter spacing**: stored per text layer (default 0). Not in the options bar, but adjustable in the **Text panel** (−20 – 200 px); applied in the WASM engine (cosmic-text has no native tracking) and respected by the path-bound layout.
- **Paragraph spacing**: extra space between paragraphs, stored per text layer (default 0). Text-panel only (0 – 200 px), also applied in the engine.
- **Underline**: a toggle button glyphed **U**, drawing a horizontal stroke 10% of the font size below the baseline, 8% of font-size thick (floor 1 px).
- **Strikethrough**: a toggle button glyphed **S**, drawing a horizontal stroke 32% of the font size above the baseline, 8% of font-size thick (floor 1 px). Neither glyph is a shortcut — `U` and `S` are bound to the **Shape** and **Clone Stamp** tools, and no key toggles either decoration.
- **Mode is a gesture, not a setting.** There is no Mode control in the options bar or the Text panel; which kind of layer you get is decided by the drag that creates it. A click — or a drag within **4 px on both axes** — makes **point text**: `width` is `null`, the engine selects `Wrap::None`, and the line runs on forever. A drag past 4 px on either axis makes **area text**, whose fixed width is the drag's `|dx|` and which wraps on word boundaries (`Wrap::Word`). The mode is fixed at creation — nothing in the UI converts a layer from one to the other afterwards.
- **The area box's height is discarded.** The drag's `|dy|` is written onto the editing state and then never read again: it is not sent to the engine, not stored on the layer, and the engine passes `None` for height to `set_size`. The box therefore constrains width only — text longer than the rectangle you dragged overflows its bottom edge indefinitely rather than clipping, scrolling, or growing a handle. The rectangle's height only ever existed as the drag preview.
- **All text layout lives in the engine.** `src/tools/text/text.ts` still carries a CPU implementation — `wrapText` and `alignLineX` — with unit tests that pass, but neither has a caller anywhere in `src/`, not even inside its own file. Only `buildFontString` survives, used solely by the path-text renderer. Nothing consults the JS layout, so the engine's cosmic-text pass is the only one that runs and the wrapping and alignment behavior above is entirely its own.
- **Bind to path**: a Path dropdown in the text options bar lists every stored path. Once bound, glyphs are placed one by one along the path's arc-length and rotated to match the local Bezier tangent (works on both open and closed paths). Live editing (typing) re-flows the type along the curve in real time, and editing the path's anchors invalidates the cached layout so the text follows. Selecting "None" unbinds and restores the layer's pre-bind position.

**Font browser** (the Font control in the text options bar)
- Opens as a portalled dropdown anchored under the trigger button (repositioned to stay on screen near the viewport edges), with a **search box** focused automatically on open — typing filters the whole catalog by substring, case-insensitive.
- Fonts are grouped under **Sans Serif / Serif / Display / Handwriting / Monospace** headers, each showing the count in that category; families are sorted alphabetically inside a group.
- The list is **virtualized** (48 px rows, only the visible window rendered) so a ~2,000-entry catalog scrolls without jank. Each row renders **the family's own name in its own face** at 22 px. There is no sample string and no preview image — the name *is* the specimen, so a row tells you nothing about glyphs the family name doesn't contain.
- **Previews are served from one baked, offline blob.** `public/font-previews.bin` (~4.4 MB) concatenates a name-only WOFF2 subset for **1,934** of the catalog's Google families, and a generated index carries each family's byte offset and length. The blob is fetched **once**, on an idle callback after startup, and every row slices its own bytes out of it into a `document.fonts` FontFace — so after that single request the picker draws its entire dropdown with no network traffic at all, scrolling included. **Six** families failed to bake and fall back to the Google `css2` API's `text=` subset per row (as do the two catalog entries that duplicate a bundled system face, Inter and JetBrains Mono). This replaced a per-row `<img>` pointing at a third-party PNG CDN whose GitHub repo had been deleted, which left every Google row showing a broken image (#729 / #730).
- **Until a row's face resolves it renders in its category's CSS generic**, via `font-family: '<Family>', <category>`. Only `sans-serif`, `serif`, and `monospace` are real CSS generics — the **827 display and handwriting families** name a keyword the browser does not recognise, so for that instant they fall back to the default UI font rather than to anything stylistically close.
- **Keyboard**: ↑ / ↓ move the highlight (skipping category headers and auto-scrolling it into view), Enter picks the highlighted family, Escape closes and returns focus to the trigger. Clicking outside also closes it.
- **Local fonts** (Chromium desktop only — Chrome and Edge; Firefox and Safari have no Local Font Access API, and there the feature is simply absent). Once the editor is open — after the New Document modal, never at startup — the app calls `queryLocalFonts()`, which on first use raises Chrome's *see fonts installed on your device* permission prompt. Installed families are listed under a **Local** header at the top of the dropdown, one row per family, sorted alphabetically, rendered in the installed face by name. The weight dropdown is derived from the OS style names: Thin/Hairline → 100, Ultra/ExtraLight → 200, Light → 300, Medium → 500, Semi/Demi Bold → 600, Bold → 700, Extra/UltraBold → 800, Heavy/Black → 900, ExtraBlack → 1000, Hiragino-style `W3`/`W6` → 300/600, anything else (Regular, Book, Roman, Plain) → 400; Italic/Oblique/Inclined faces set the italic flag. macOS-internal families whose name starts with `.` are dropped.
- **A local family shadows a catalog row of the same name.** With Arial installed, the catalog's *Arial* entry disappears from Sans Serif and the Local one takes its place. This matters because the catalog's 14 "system" faces are **name-only**: nothing ever loads their bytes into the engine, whose font database holds only the bundled Inter plus whatever has been fetched, so outside the Local path (Firefox, Safari, or permission denied) picking Arial shows real Arial in the picker row but renders the canvas in Inter. The Local row is backed by real bytes.
- **Picking a local family** reads every face of the family via `FontData.blob()` (raw SFNT bytes — macOS `true`-tagged TrueType, CFF OpenType and TTC members all parse) and loads them all into the engine's font database, so a later weight or italic switch needs no further I/O; the text re-renders off the Inter fallback once the bytes land, the same anchored refresh a Google download gets. The store keeps only the `FontData` handles, not the bytes — re-reading a local blob is cheap.
- **When there is nothing to show but the API exists** — permission not yet requested, the prompt dismissed, or the query answered with an empty list because access was denied — the dropdown offers a **Load local fonts** button that re-queries from a click. The API is only exposed in secure contexts (https or localhost); current Chromium does not require a user gesture for the call itself.
- **Loading is on demand**: picking a Google family injects its `css2` stylesheet for DOM previews *and* fetches the binary for the selected weight into the WASM engine's font database so the canvas renders the real face. The binary comes from the exact TTF path baked into the generated catalog (jsDelivr → `google/fonts` repo), falling back to the css2 API's latin-subset WOFF2 (decoded in the engine) and finally to the bundled Inter if every fetch fails. Fetched binaries are cached per family+weight, so switching back is instant.

**Editing keys** (active while a text layer is being edited)
- **Shift+Enter** or **Tab**: commit the edit and exit text editing (plain Enter inserts a newline). Tab also swallows the browser's default focus change so the next single-key shortcut isn't captured by a newly-focused element.
- **Escape**: cancel the edit. If the layer was newly created in this editing session, it is removed entirely; otherwise the layer keeps its prior text.
- **Caret movement**: ←/→ move one character; **⌥←/→** jump by word (Unicode letter/number/underscore runs); **⌘←/→** and **Home/End** jump to line start/end; **↑/↓** move a line at a time, preserving a *goal column* across short lines via engine-provided caret geometry (on the first/last line they snap to the line boundary).
- **Selection**: hold **Shift** with any caret-movement key to extend a highlighted selection; **⌘/Ctrl+A** selects all (a real range, not just a caret jump). On the canvas, a plain click places the caret and begins a **drag-select**, **Shift+click** extends the selection, and **double-click** selects the word under the pointer. A click **inside** the text repositions the caret; a click **outside** commits the edit.
- **Clipboard** (system clipboard): **⌘/Ctrl+C** copies the selection, **⌘/Ctrl+X** cuts it, and **⌘/Ctrl+V** pastes plain text into the buffer (replacing any selection). Image paste is suppressed while a text layer is being edited.
- **Backspace / Delete** remove the selection if there is one, otherwise the character before/after the caret.

---

## Selection Tools

### Rectangular Marquee
- **Aspect ratio lock**: width/height constraint. **One global setting**, not a per-tool one — the same `W : H` and lock state drive the Elliptical Marquee, the Shape tool, and Crop; see [Options Bar](#options-bar).
- **Feather**: 0 - 250 px (soft edge applied after the marquee is committed). **Shared** with the Elliptical Marquee and the Magic Wand — all three read the same value. The blur is a **two-pass separable Gaussian on the GPU** — one horizontal and one vertical pass over normalized weights `exp(-i² / 2σ²)` with `σ = radius / 2` — not a box blur. **The engine clamps the radius to 63 px**, because the blur shader carries a fixed `u_weights[64]` array, so every slider value from 63 to 250 produces an identical result.
- **Cmd/Meta+drag**: holding meta while dragging temporarily forces a 1:1 (square) aspect ratio for the duration of the press, regardless of the persistent aspect-ratio toggle. Releasing meta returns to the unconstrained or persistently-locked behavior immediately.

### Elliptical Marquee
- **Aspect ratio lock**: width/height constraint — the same global setting the Rectangular Marquee, Shape tool, and Crop use.
- **Feather**: 0 - 250 px (same GPU feather pipeline as the rectangular marquee, and the same stored value — the two marquees mount one shared options component, so they cannot hold different radii)
- **Cmd/Meta+drag**: holding meta forces a 1:1 (circle) aspect ratio while dragging, identical to the rectangular marquee transient lock.

### Lasso (Freehand)
- No configurable parameters

### Magnetic Lasso
- **Width**: 1 - 40 px (perpendicular search radius from the cursor path)
- **Contrast**: 1 - 100% (minimum edge strength to snap onto)
- **Frequency**: 0 - 200 px (distance between auto-placed anchors; 0 disables auto-anchoring)
- Edge detection runs in WASM against the active layer's GPU texture; only snapped coordinates cross back to JS

### Magic Wand
- **Tolerance**: 0 - 255 — measured as **squared Euclidean distance across all four RGBA channels** (`dr² + dg² + db² + da² ≤ tolerance²`), so alpha counts toward the match exactly as much as a color channel does. A pixel differing by the same amount in every color channel therefore hits the limit at roughly **58 %** of the nominal tolerance (`tolerance / √3`). Unlike the [Paint Bucket](#fill-paint-bucket), the wand runs the **same** metric whether Contiguous is on or off — both states call `lopsy_core::flood_fill`.
- **Contiguous**: on/off
- **Graduated**: on/off — when enabled, the wand uses a gradient-aware flood fill that produces partial-coverage selection edges across smooth color transitions, instead of a hard threshold cut
- **Feather**: 0 - 250 px (shared marquee feather slider; applied after the wand fill)
- **Shift+click**: adds the new region to the existing selection; **Alt/Option+click**: subtracts it (both combine against the current selection mask via `combineSelections`). Clicking with no modifier replaces the selection, and an Alt-subtract that empties the selection clears it.

### Quick Selection
- **Size**: 1 - 100 px (default 20) — **the weakest Size control in the app, and the only one that is a radius rather than a diameter.** It is passed straight in as `radius`, where every paint tool's Size is a diameter the dab shaders halve (`radius = u_size * 0.5`), so Quick Selection's 50 spans twice what a Brush's 50 does. What it actually changes is only the **seed-color sampling box**: `sampleSeedColor` averages a square of half-extent `max(1, round(size / 3))` around the sample point to decide what color to grow from. It is also the one Size slider with no document scaling — the ceiling is a flat 100 px.
- **Tolerance**: 0 - 255 (default 32) — a third metric again, and the only one that is actually calibrated per-channel: the region-grow compares `dr² + dg² + db²` against `tolerance² × 3`, so a pixel that differs by exactly `tolerance` in every color channel sits precisely on the boundary. **Alpha is not part of the comparison at all** (`colorDistanceSq` takes RGB only), so a fully transparent pixel and an opaque one of the same color read as identical to this tool — unlike the [Magic Wand](#magic-wand), which weighs alpha equally with color.
- **Edge Strength**: 0 - 100 (Sobel gradient threshold — higher values stop the grow at stronger edges; default 50)
- **Mode**: add or subtract
- **`[` / `]` do not resize the Quick Selection brush**, and arrow keys do not nudge the selection while this tool is active — it is missing from both handlers' tool lists (see [Single-Key Shortcuts](#single-key-shortcuts) and [Move](#move)).
- Paint over the canvas to grow (or shrink) the selection: each pointer-move samples the seed color under the cursor and runs a flood-fill region-grow bounded by the tolerance and the edge strength. Strokes accumulate across many sample points so dragging across a region progressively absorbs it. The pre-stroke mask is preserved so a single undo restores the prior selection.
- **Size does not confine the grow.** `applyQuickSelectStroke` destructures `radius` and uses it in exactly one place — the `sampleSeedColor` call — and `floodFillSelect` never receives it. The flood is bounded only by `toleranceSq` and `edgeThreshold`, so a single click in a large flat region absorbs the whole region no matter how small Size is. The parameter's own doc comment claims otherwise ("controls seed sampling area **and max flood distance**"), and that stale comment is the reason this tool is easy to mis-describe: the second half of it has no implementation behind it.

### Selection Operations
- **Combine modes are per-tool, not global.** There is no shared add / subtract / intersect mode switch. Only two tools combine with an existing selection: the **Magic Wand** (Shift+click adds, Alt/Option+click subtracts) and **Quick Selection** (its own add / subtract Mode control). The marquee, lasso, and magnetic lasso tools always replace the selection — they read no Shift or Alt modifier for combining. The underlying mask combiner also implements an **intersect** mode, but no caller ever requests it, so intersect is unreachable from the UI.
- Invert selection (`⇧⌘I`) — inverts every mask value (`255 − v`, so partial coverage inverts to its complement rather than snapping) and sets the reported selection bounds to the **whole document**, since an inverted selection almost always touches the canvas edges.
- Select all (`⌘A`)
- Deselect (`⌘D`)
- **Move the selection outline**: with a rectangular or elliptical marquee tool active, press-drag from *inside* an existing selection to translate the selection mask itself — the marching-ants outline moves while the underlying pixels stay put (any active floating selection is dropped first). Arrow keys nudge the same marquee bounds.
- **Click to deselect**: a single click (drag < 2 px) with a marquee tool clears the active selection, the same as `⌘D`.
- Selection from layer alpha — `Cmd/Ctrl+click` a layer thumbnail (non-transparent pixels become the selection)
- Path → Selection (from the Paths panel)
- **Selection → Path**: traces the selection mask with marching squares, simplifies the contour with Douglas-Peucker, and fits smooth cubic Bezier anchors using Catmull-Rom tangents. The result is added to the Paths panel as a new path. Disabled when nothing is selected.
- **Grow…**: expands the selection by an integer pixel amount (1 - 100 px)
- **Shrink…**: contracts the selection (1 - 100 px)
- Grow and Shrink are **CPU-side binary morphology**, unlike Feather: each finds the pixels on the mask border (any non-zero pixel with a strictly-zero 4-neighbour) and paints a disc of the given radius through them, writing a hard 255 for Grow and a hard 0 for Shrink. Two consequences: any partial coverage inside that disc is flattened to fully-selected or fully-unselected, so growing and then shrinking by the same amount does **not** restore a feathered edge; and because "selected" means non-zero, Grow measures from the outermost fringe of a feathered selection rather than from its 50 % line.
- **Feather…**: softens the selection edge, running the same two-pass GPU Gaussian as the marquee's own Feather slider. The dialog offers radius 1 - 250 px but the engine clamps it to **63 px**, so values above 63 all land on the same result.

### Marching Ants (selection outline)

The outline is drawn on the 2D overlay canvas, not by the GPU compositor.

- **The ants trace the 50 % contour.** Edge extraction thresholds the mask at **128**, so a selection is outlined where it crosses half coverage. A soft selection whose values are all below 128 — a heavily feathered edge, or the selection returned by exiting a quick mask that was painted at low opacity — is fully active and does constrain painting — for the tools that read the mask at all; Smudge, Clone Stamp, and Healing Brush ignore it entirely (see [Dab Engines](#dab-engines-shared-across-paint-tools)) — but draws **no ants at all**. The absence of an outline is not proof of an empty selection.
- Edge segments are chained into connected polylines by matching shared endpoints, so the dash pattern flows continuously around each contour instead of restarting on every one-pixel segment.
- Each contour is stroked twice: a solid black under-stroke, then a white dashed over-stroke on top, so the outline stays legible over any background. Line width is `1.5 / zoom` and the dash is `8 / zoom` on/off, both zoom-compensated so the ants keep a constant on-screen size. The dash offset cycles over a 120-frame period.
- Contours are cached against the mask buffer's identity and retraced only when the mask itself is replaced, and the edge scan is clipped to the selection's bounding box (expanded 1 px) rather than the whole canvas — without that clip a live drag on a large document collapses to a few frames per second.
- **While a new marquee is being dragged out the ants are drawn straight from the rectangle or ellipse geometry**, bypassing the mask, the contour tracer, and the GPU bridge entirely; the real mask is only built on release. Dragging an *existing* marquee to a new position instead reuses the traced contours and offsets them through a translate-only transform, so that gesture never retraces either.
- The ants animate on an **overlay-only frame path** that redraws the 2D overlay without recompositing any layer, so an idle selection does not cost a full GPU recomposite every frame.
- When a transform is active the outline is drawn through the transform matrix — see the Transform section for which handles it does and does not follow.

### Quick Mask Mode
- Shortcut: `Q` (toggle). There is also a dedicated toggle button in its own group at the bottom of the toolbox, labelled *Enter Quick Mask (Q)* / *Exit Quick Mask (Q)* and highlighted while the mode is on.
- **Entering** clears the active selection and blits the selection mask GPU-to-GPU into a separate quick-mask texture. With no selection active it starts all-zero — nothing selected.
- **The overlay is blue, and it covers the *unselected* region** — not a red overlay of the selection. Coverage is `(1 − mask) × 0.5`, so fully-unselected areas are tinted `rgb(0, 99, 255)` at 50 % and fully-selected areas are left untouched. It shares the shader branch used by layer-mask edit mode, which is why the two look alike.
- Brush, pencil, and eraser edit the selection mask directly. **The foreground color is reduced to a binary decision**: Rec. 709 luminance ≥ 128 adds to the selection, below 128 subtracts. A mid-gray therefore does not paint partial coverage — it just picks a side. Partial coverage comes from brush hardness and opacity, which shape the dab with a quadratic `1 − t²` falloff plus a 1 px smoothstep edge. The eraser ignores the color and always subtracts. **Size, hardness, and opacity are the only brush settings that reach the dab** — the tip bitmap, jitters, scatter, angle, texture, fade, taper, speed-size, sub-brushes, and the Spacing setting are all dropped, exactly as in layer-mask mode (see [Editing a Layer Mask](#editing-a-layer-mask) for the full list and for what a dab costs).
- **Adding and subtracting are not symmetric.** Adding takes `max(existing, dabStrength)`, so opacity acts as a ceiling — repeated passes at 50 % opacity never push that area past 50 %. Subtracting multiplies by `(1 − dabStrength)`, so repeated passes compound and do drive the mask to zero.
- Works regardless of the active layer — painting only affects the selection mask, not pixels
- **Fill (paint bucket) and Gradient tools route into the quick mask** instead of the active layer while quick mask is on, so smooth selection falloffs (linear or radial gradients) and bucket fills of the selection mask are first-class operations. Quick mask mode takes precedence over layer-mask edit mode if both are somehow active.
  - **The bucket only ever adds.** Unlike the quick-mask brush and pencil, it does not read the foreground color — the fill value is hard-coded to white, so there is no bucket route that subtracts from the selection. (On a *layer* mask the same tool is hard-coded the other way, to black; see [Editing a Layer Mask](#editing-a-layer-mask).) It is a CPU flood fill over a full readback of the quick-mask texture, with tolerance measured against the mask's gray value.
- **The Move tool moves painted mask content.** With a marquee active in quick mask, dragging translates both the marquee and the quick-mask pixels inside it: the pixels under the marquee's original position are cleared and the moved content is max-blended into its new position, so it adds to rather than replaces whatever it lands on. Mask content outside the marquee stays put, and the layer texture is never touched.
- **Exiting** reads the quick-mask texture back from the GPU and installs it as the selection. Bounds are computed from any non-zero pixel, so a soft-edged mask reports bounds covering its entire falloff. No feather is applied on the way out — the marquee's Feather slider has no effect on a quick-mask selection.
- **Quick-mask strokes are not undoable.** Painting pushes a *Quick Mask Paint* / *Quick Mask Erase* entry into history, but a history snapshot stores the document, the selection, and layer textures — the quick-mask texture is not among them. Undoing one of these entries restores nothing visible and the painted mask survives; the entry still consumes an undo step.

---

## Transform

Transform is **selection-bound** — there is no separate transform tool and no
"free transform the whole layer" mode. The handles are drawn on top of the
marching ants, and Escape or `⌘D` tears both down together.

Seeding a transform is an explicit step that individual call sites opt into,
*not* something `setSelection` does on its own. Committing a marquee, lasso,
wand or quick-select drag seeds one, as do loading a layer's alpha,
converting a layer mask to a marquee, arrow-key nudging a selection, the
Select menu's Grow / Shrink / Feather dialog, and — since #728 — **Select All
(`⌘A`) and Invert Selection (`⇧⌘I`)**. Those two used to call `setSelection`
alone, which left the handles pinned to the *previous* selection's bounds: a
`⌘A` after a paste's alpha-selection selected the whole document while the
overlay still framed the pasted region. Both now pair the selection with a
fresh full-canvas transform state.

**Two selection-producing routes still seed nothing**, so they come up with
marching ants and no handles: **exiting Quick Mask** (`Q`), which installs the
painted mask as the selection, and the Paths panel's **Path to Selection**.
An arrow-key nudge is the cheapest way to get handles back — it re-seeds from
the current bounds, so the selection lands one pixel off with a full transform
state over it.

### Who responds to the handles

- **Move tool** — the only tool that transforms *pixels* through the handles.
- **Selection tools** (rectangular/elliptical marquee, lasso, magnetic lasso,
  wand) — grabbing a handle scales the **selection outline only**, leaving
  pixels untouched. Only the 8 scale handles respond; rotation handles are
  ignored, so a drag on one falls through and starts a brand-new selection.
  The rebuilt mask is a rectangle or an ellipse depending on which marquee
  tool is active, and the rebuild is coalesced to one allocation + GPU upload
  per animation frame (a full-document mask on a 4K canvas is ~16 MB, so a
  raw pointer-event-rate rebuild would thrash).
- **Every other tool** (fill, eyedropper, text, …) ignores the handles
  entirely and dispatches to its own handler. This is deliberate: at low zoom
  over a small selection the handle hit-radius can cover the whole selection
  and would otherwise swallow every click (#222).

### Handles

- **12 handles**: 8 scale (4 corners + 4 edge midpoints) and 4 rotation
  handles, each sitting 20 document-px diagonally outside its corner and
  tethered to it by a line. Rotation handles are hit-tested **first**, so they
  win where the two overlap.
- **Hit radius** is `8 / zoom` in document space — constant in screen terms.
  For the Move tool it is additionally clamped to at most 80% of the
  selection's smaller half-extent (and at least 1 px) so a click near the
  middle of a small selection can't register as a handle grab.
- **Cursors**: `nwse-resize` / `nesw-resize` on the corners, `ns-resize` /
  `ew-resize` on the edge midpoints, `crosshair` on the rotation handles.
- **Drawing**: a blue (`#00aaff`) quad through the four corners, white filled
  squares (6 px) on the scale handles, white filled circles (5 px radius) on
  the rotation handles. All sizes divide by zoom, so the chrome stays the same
  on-screen size at any magnification.
- The **marching ants follow translate, rotate, and scale** but *not* skew and
  *not* the distort/perspective corner offsets — in those three modes the
  handle box deforms while the ants outline does not.

### Modes

Free / Skew / Distort / Perspective, selected from a segmented button group in
the Move tool's options bar (visible only while a selection is active).
**Switching mode commits the in-flight transform and resets to identity** on
the current selection bounds — a rotation cannot be carried into Distort, it
gets baked first.

- **Free** — scale from the 8 scale handles, rotate from the 4 rotation
  handles.
- **Skew** — edge and corner handles skew instead of scaling, clamped to
  **±60°** on each axis. `left`/`right` produce vertical skew; `top`, `bottom`
  **and all four corners** produce horizontal skew only. The edge opposite the
  one being dragged is pinned via a translate compensation.
- **Distort** — a corner handle moves that corner alone; an edge handle
  translates both corners of that edge together. No clamping, so corners may
  cross over each other.
- **Perspective** — dragging a corner moves it *and mirrors the other corner
  of the same horizontal edge* (one `+dx`, the other `−dx`, both `+dy`) while
  the opposite edge stays fixed, giving the trapezoid / vanishing-point
  effect. Edge handles behave as they do in Distort.
- In Distort and Perspective the corner geometry is built from the corner
  offsets alone, so the **rotation handles have no visible effect** in those
  two modes.

### Scale, rotate, and modifiers

- **Scale** pins the opposite edge or corner: the box grows by the drag delta
  and the center moves by half of it. The drag delta is un-rotated into the
  box's own axes first, so scaling behaves correctly on an already-rotated
  selection. Scale is floored at **0.01** per axis (and has no ceiling), so a
  handle cannot be dragged through the far edge to flip content — use the flip
  buttons for that.
- **`Cmd`/`Meta` + drag a scale handle** forces `scaleX == scaleY` by
  **averaging the two axis scales**. On a corner handle that reads as the
  expected uniform scale; on an *edge* handle only one axis was driven by the
  drag, so averaging applies half the drag's magnitude to both axes.
- **Rotation** is measured from the center of the current (scaled, translated)
  bounds. **`Cmd`/`Meta` + drag a rotation handle** snaps to 15° increments
  (`π/12`); enabling grid + snap-to-grid applies the same snap automatically
  without the modifier.
- Grid + snap-to-grid *also* snaps the pointer position while dragging a
  **scale** handle — a separate effect from the 15° rotation snap. Note that
  this path quantizes against an *origin*-anchored lattice, not the
  document-centered one the grid draws, so on most document sizes it does not
  land on the visible grid lines; see [Snapping](#snapping).
- Only `metaKey` is read — this is Cmd on macOS and the Windows/Super key
  elsewhere, **not** Ctrl.

### Commit lifecycle

- Grabbing a handle pushes a single **"Transform"** history entry, then floats
  the selected pixels into a GPU texture and composites them live each frame —
  as an inverse affine matrix in Free/Skew, or as a 4-corner homography in
  Distort/Perspective.
- **Releasing the mouse does not commit.** The GPU float is deliberately kept
  alive so a follow-up grab re-derives from the *original* floated pixels;
  successive scale/rotate drags therefore do not compound resampling loss.
- The float is dropped — baking the result into the layer texture — on
  **Escape**, **`⌘D`**, or **selecting a different layer** in the Layers panel.
- **Undo and redo also drop the float first**, and cancel any scheduled prefloat,
  before restoring their snapshot. This is a correctness requirement rather than
  a convenience: while a float is live the engine keeps `float_layer_id` set, and
  that makes the layer descriptor hold on to the float's *expanded* width and
  height. Restoring a snapshot whose texture is back at the pre-float size would
  then leave the descriptor mismatched, and the layer renders stretched across
  the whole document from the origin instead of at its own position. Dropping the
  float before the restore keeps the descriptor and the texture in agreement.
- The selection mask is not recomputed during the drag; it is rebuilt from the
  committed pixel alpha afterwards, which keeps it from drifting away from
  what the GPU actually rendered.
- Floating a **text** layer expands the buffer to the layer's diagonal so
  rotation doesn't clip the glyphs.

### Quick transforms

- **Flip Horizontal / Flip Vertical** (options bar, next to the mode buttons)
  apply instantly to the selected content: float → composite the flip matrix →
  drop → re-select from the committed alpha. They require an active selection.
- **Rotate 90° CW / CCW** sit in the Move tool's own options-bar group and are
  **dual-purpose** — with a selection active they rotate the selected content,
  with no selection they rotate the entire active layer.
  - **The whole-layer branch is raster only, and silent about it**, the same way
    the neighbouring [Fit button](#move) is: `rotateActiveLayer` returns on a
    text, shape, or group layer *before* `pushHistory`, so the click produces no
    rotation, no undo step, and no feedback. The selection branch has no such
    guard — it composites a rotation matrix through the float pipeline
    regardless of the layer underneath. [Flip Horizontal / Vertical in the Image
    menu](#canvas-operations) is the odd one out: it pushes history before it
    checks anything at all.

---

## Other Tools

### Move
- Drag to reposition layers
- **Multi-layer drag**: when several layers are multi-selected in the Layers panel, a drag moves **all of them together**. Each selected layer's starting position is captured at pointer-down, and every tick applies the same delta to each — so the group translates rigidly rather than each layer being dragged independently.
  - **Locked layers in the selection stay put.** They are filtered out when the sibling list is built, so a locked layer inside a multi-selection anchors while the rest move.
  - The delta handed to the siblings is the **post-snap** delta of the active layer, not the raw pointer delta, so snapping to grid, guides, or layers moves the whole group in formation instead of snapping each layer to its own nearest target.
  - The other selected layers are **excluded from the snap-to-layers candidate set**, so a moving group does not try to snap to itself.
- Arrow key nudge — 1 px by default; when grid + snap-to-grid is enabled, each key press nudges by exactly one grid cell. Arrow keys also nudge the active marquee bounds when a selection tool is active — but the responding set is an explicit list of **five** tools (rectangular marquee, elliptical marquee, lasso, magnetic lasso, magic wand). **Quick Selection is not in it**, so arrow keys do not nudge a selection while that tool is active; switch to any other selection tool and the same selection nudges fine. Under every other tool the arrow keys fall through untouched.
  - **Nudge follows the same multi-layer rule as dragging**: every other selected, unlocked layer shifts by the identical delta. This applies to the whole-layer nudge only — when a marquee selection is active the arrow keys move the floating selection instead, and multi-selection plays no part.
- Snap to grid
- Snap to guides
- **Snap to layers** (View menu → "Snap to Layers"): while dragging, the moving layer's left/right/top/bottom edges and X/Y centers attract to the matching edges and centers of every other visible layer within a 5 px threshold. Magenta alignment guides span the document while a snap is engaged and clear on mouse-up.
- **Align**: left, center-h, right, top, center-v, bottom
- **Fit** (options-bar button, labelled *Fit layer to canvas*): scales the active raster layer to fit inside the canvas — the scale factor is `min(canvasW / layerW, canvasH / layerH)`, so aspect ratio is preserved — and centers the result on the artboard. Reuses the GPU `scaleLayerTexture` path, so no pixel data round-trips through JS. Pasting or dropping an oversized image now runs this same fit automatically (see Paste / Drop behavior), so the button is for the cases that don't — a layer scaled up after the fact, or one that outgrew the canvas when the document was resized.
  - **It enlarges as readily as it shrinks.** There is no 1× cap, unlike the viewport's fit-to-view and the Reference drawer's auto-fit, which both explicitly refuse to upscale. Clicking Fit on a layer smaller than the canvas resamples it *up* until one side touches the edge.
  - **Raster only, and silent about it.** The button is never disabled, but the action bails out on a text, shape, or group layer — no toast, no history entry, no visible response at all.
  - **A layer that already fits exactly is a true no-op.** The fit is computed first, and when it matches the layer's current x / y / width / height the action returns *before* `pushHistory`, so a second click adds nothing to the undo stack.
  - Before computing the fit it **drops any live floating selection** (its pixels are already composited back into the layer) and crops the layer texture back to the selection bounds. A paste leaves the layer's JS descriptor drifting from its doc-sized GPU texture — the prefloat expands the texture but syncs only `x` / `y` — and without that re-crop the no-op check above missed, so Fit squashed an already-fitted paste instead of doing nothing (#728).
- **Alt/Option+drag (no active marquee)**: duplicates the active layer in place, then moves the new copy — leaves the original layer untouched. The duplicate is deliberately excluded from the multi-layer sibling capture below: `duplicateLayer` makes the copy active but leaves the *pre-duplicate* selection in `selectedLayerIds`, so treating those as move siblings would drag the originals along with the copy. An option-drag therefore always moves exactly one layer, even when several were selected before it started.
- **Alt/Option+drag (with an active marquee)**: copies the selected pixels of the active layer into a floating duplicate and moves that copy, leaving the original pixels under the selection intact (Photoshop-style "alt-drag the selection").
- **Undo granularity.** A whole-layer drag records exactly one **"Move"** history entry, and it is pushed **lazily — on the first pointer-move that actually shifts the layer**, not on pointer-down. A click-and-release on the Move tool therefore records nothing and mutates nothing; before that deferral every bare click left a no-op *Move* step on the stack, which is what made long undo chains replay through positions the layer was never in (#721).
  - The guard compares a **document-space** delta (`round(canvasPos − startPoint)`), so a jiggle that stays inside one document pixel — easy at high zoom — still counts as a bare click. Once it clears one document pixel the entry is pushed even if snapping then returns the layer to exactly where it started.
  - **The deferral is specific to the whole-layer case.** An option-drag pushes **"Duplicate Layer"** at pointer-down, a drag with an active marquee pushes its float snapshot at pointer-down, and a Quick Mask drag pushes **"Move"** at pointer-down — all unconditionally, so a bare click under any of those *does* still leave a history entry behind.
- **Cmd/Meta+drag (transform handles)**: forces a uniform scale (by averaging the two axis scales) and snaps rotation to 15° increments. Grid + snap-to-grid applies the same rotation snap automatically, and additionally snaps the pointer to grid cells while scaling. The Move tool is the only tool whose handle drags transform pixels — see [Transform](#transform).

### Paste / Drop behavior

Paste takes one of two routes depending on where the image came from.

- **Pasting back content copied inside Lopsy** (`⌘C` / `⌘X` / `⇧⌘C`, then `⌘V`) **pastes in place**: the new layer lands at the offset the content was copied from, not at the canvas origin. Copy/cut also mirror the pixels to the system clipboard as a plain PNG so they can be pasted into other apps, and that position-less PNG is what a real browser hands back on paste — so Lopsy compares the incoming image against the GPU-resident internal clipboard and uses the internal (positioned) copy only when the dimensions **and** pixels both match. The comparison samples up to ~4096 pixels, tolerates the small RGB drift a clipboard round-trip introduces under partial alpha, and decodes with `colorSpaceConversion: 'none'` so a wide-gamut round-trip doesn't push values past the match tolerance. A same-size but genuinely different external image (say, a document-sized screenshot pasted after Copy Merged) fails the pixel check and is treated as external.
- **Pasting or dropping an external image** creates a new raster layer positioned at the canvas origin and **auto-selects** the new layer's non-transparent pixels (loads the alpha as a marquee selection, deferred to the next frame so engine-sync has registered the layer descriptor before the float is attempted). Two things then happen automatically on this route:
  - **An oversized paste is shrunk to fit the canvas.** A raster paste wider or taller than the document is scaled down through the same `computeFit` helper the **Fit** button uses — longest side matched to the canvas, aspect ratio preserved, centered on the artboard — over the GPU `scaleLayerTexture` path. Without it the auto-selected alpha is clipped to the visible canvas, so the transform handles cover only the on-canvas portion while the off-canvas pixels sit unreachable and are dropped by the first float. The fit is a **synchronous side-effect of the paste, not a second history entry**, so a single `⌘Z` still reverses the whole operation. A paste that already fits keeps its natural dimensions.
  - **The Move tool is activated.** Transform handles are gated on the active tool being Move, so without the switch the handles rendered by the auto-select would not respond to clicks.
  - Both behaviors belong to this external route only. An **in-place paste of internally-copied content takes a different code path** and changes neither the active tool nor the layer's size — as does opening an image as its own new document, where the canvas is sized to the image and nothing needs fitting.
- File → New and opening an image drop the internal clipboard, since resetting the engine frees the GPU clipboard texture that an in-place paste would read from. A copy made before a New therefore pastes as an external image afterward.
- When duplicating a layer that is wider or taller than the canvas, the +10/+10 visual offset is clamped so the duplicate's far edge never moves past the canvas edge that the original was within (prevents already-oversized layers from being shoved further out of view).

### Eyedropper
- Click (or click-drag) to set the foreground color from the composited pixel under the cursor — samples the on-screen result, not just the active layer.
- **Sample size**: point, 3×3, and 5×5 area-averaging modes are implemented in the sampling logic, but the live canvas eyedropper currently always samples a single pixel — there is no options-bar control to switch sample size yet.
- In **Lab** documents the sample is decoded to sRGB *before* averaging, since the Lab transform is non-linear and averaging encoded values would not match what is under the cursor. The picked value lands in the foreground swatch **as sampled** — it is not snapped to the mode there — but painting with it is constrained on the way to the texture, so eyedropping a stray color in a Grayscale or Indexed document still paints a legal one (see Color Modes).

### Fill (Paint Bucket)
- **Tolerance**: 0 - 255 (default 32)
- **Contiguous**: on/off (default on). Turning it **off** is the "fill by color" mode — instead of flooding outward from the click point, every pixel in the layer within tolerance of the clicked color is filled, whether or not it connects to the click.
- These two are the tool's entire surface: there is no opacity, blend mode, anti-alias, or "all layers" option, and no modifier-key behavior. Shortcut: `G`.
- **The Contiguous checkbox silently changes what Tolerance measures.** The two routes were written against different distance metrics, so the same slider value admits different pixels depending on which one runs:
  - *Contiguous* → `lopsy_core::flood_fill`, which tests **squared Euclidean distance across all four RGBA channels**: `dr² + dg² + db² + da² ≤ tolerance²`.
  - *Non-contiguous* → the `bucket_fill_color_match` shader, which tests **Chebyshev distance** — the single largest per-channel difference: `max(|dr|, |dg|, |db|, |da|) ≤ tolerance`.

  Chebyshev is never larger than Euclidean, so the fill-by-color route always matches a **superset** of what the contiguous route would match at the same setting. The gap is widest when a pixel differs in several channels at once: for a pixel that differs by the same amount in all three color channels (the normal case, alpha unchanged), the contiguous route needs a tolerance of **√3 ≈ 1.73×** what the non-contiguous route needs; if alpha differs too, it needs **2×**. Concretely at the default Tolerance of 32, a pixel offset by `(20, 20, 20, 0)` from the clicked color is filled by fill-by-color (Chebyshev 20 ≤ 32) but rejected by a contiguous fill (Euclidean ≈ 34.6 > 32). The two agree **exactly** when only one channel differs, which is why flat-color and grayscale artwork never reveals the split.
- **The shader's own comment asserts the opposite.** `bucket_fill_color_match.glsl` documents `channelDelta` as "Match distance mirrors lopsy_core::flood_fill: max channel delta over rgba" — the second half describes the shader correctly, but `lopsy_core::flood_fill` does not use a max-channel delta, so the claimed equivalence does not hold. The [Magic Wand](#magic-wand) is the contrast case: it routes **both** of its Contiguous states through `lopsy_core::flood_fill` and so keeps one metric throughout. Only the bucket's non-contiguous branch was re-implemented as a shader (#667), and only the bucket's metric split.
- **Every "Tolerance: 0 - 255" slider in the app, and what each one actually measures.** There are exactly three such controls (Fill, [Magic Wand](#magic-wand), [Quick Selection](#quick-selection)), but five distinct metrics behind them, because two of them change meaning with the route taken. The last column gives the per-channel offset that sits exactly on the limit when a pixel differs by the same amount in all three color channels — the practical way to compare the rows:

  | Control / route | Match test | Channels | Uniform RGB offset at the limit |
  | --- | --- | --- | --- |
  | Fill — Contiguous | `Σd² ≤ tol²` (Euclidean) | RGBA | `tol / √3` ≈ 0.58 × tol |
  | Fill — Non-contiguous | `max\|d\| ≤ tol` (Chebyshev) | RGBA | `tol` |
  | Fill — on a layer mask / quick mask | `\|Δgray\| ≤ tol` | mask gray only | n/a (single channel) |
  | Magic Wand — either state | `Σd² ≤ tol²` (Euclidean) | RGBA | `tol / √3` ≈ 0.58 × tol |
  | Quick Selection | `Σd² ≤ tol² × 3` | RGB (alpha ignored) | `tol` |

  So Quick Selection and the bucket's fill-by-color route are the two calibrated so that "tolerance 32" means "up to 32 per channel"; the wand and the contiguous bucket are roughly **1.7× stricter** than that at the same number, and the mask routes are not comparing color at all.
- Fills honor the active selection mask, and route into the quick mask instead of the layer while Quick Mask is on (see Quick Mask Mode). **Both statements stop at mask edit mode**: a bucket click on a layer mask takes a wholly separate CPU path that ignores the selection and always fills black — see [Editing a Layer Mask](#editing-a-layer-mask).
- **GPU fast paths**: three routes, chosen automatically —
  - *Empty layer or full-coverage fill* → filled directly on the GPU from a synthesized full-coverage (or selection-derived) mask.
  - *Non-contiguous ("fill by color")* → a single per-pixel shader that samples the clicked color and fills everywhere within tolerance, optionally clipped by the selection.
  - *Contiguous fill on real content* → still a CPU flood fill (the BFS is inherently sequential), reading the layer's pixels back through the WASM flood-fill routine and composing the result on the GPU.
- **Since #742 the click pays no pre-fill readback at all on two of the three routes.** Fill used to sit in the `needsPixelData` set, so `expandLayerForEditing` ran at pointer-down ahead of any tool handler and materialized the whole layer JS-side — reading the texture back whenever there was no cache, which was the normal case, and dropping the cache again on the way out so the readback repeated on every single click (~67 MB on a 4096 × 4096 layer). **Fill is no longer in that set.** The empty-layer and fill-by-color routes now touch no CPU copy of the layer at all, and only the **contiguous-on-real-content** route still reads pixels back — once, through `readLayerPixelsForFill`, because its BFS genuinely needs them. That is 122 MB per fill click at 4K removed.
- **The bounds reconciliation the expand used to provide still has to happen — it just happens after the fill now.** Every GPU fill entry point calls the engine's `ensure_layer_full_size` internally, which re-origins the engine's copy of the layer descriptor to the document rect *without telling the store*; the next `syncLayers` frame would then re-apply the stale JS offset and composite the result at **double** it. Dropping the expand without replacing that reconciliation is exactly the regression #722 shipped (briefly on main inside #726) and #735 reverted — a fill on any content-offset layer, a moved one or a content-cropped one, landed twice as far out as the click. #742 re-landed the removal with `syncLayerAfterFullSize` — the same helper `beginStroke` already used — called on **each** of the three routes: it recomputes `x = min(0, x)`, `y = min(0, y)` and the width/height union of the document and content rects, drops the layer's JS pixel cache, and marks the layer dirty. No RGBA crosses the bridge in either direction.
- **A consequence of that removal: the empty-layer route is now reachable from a canvas click — until #742 it never was.** It fires only when the layer has *no* JS pixel data **and** its GPU texture is still the 1 × 1 lazy placeholder, and the old pointer-down expand always left dense JS data behind, so a click could never satisfy the second half. `addLayer` seeds no pixel data of its own, so a freshly added layer now takes the single-shader solid fill instead of the CPU flood. The pixels are identical either way — what changed is the time. (The **background** layer is not eligible: document creation seeds it with dense pixel data.)

### Gradient
- **Type**: linear, radial — these are the only two types; there is no angular, reflected, or diamond gradient.
- **Stops**: 2 - 16 color stops with position (0-1), edited in the **Gradient modal** (opened by clicking either the gradient swatch or the "Advanced…" button in the options bar — both go to the same place). Click an empty spot on the handle row to insert a stop there, drag a handle to reposition it, and select a handle to drive a full ColorPicker (HSV square + hue strip + RGB/HSV/hex fields, including alpha) with a percent position readout. Delete is gated at the 2-stop minimum; the 16-stop cap matches the GPU uniform limit. Stops are re-sorted by position on every edit. `Escape` or an overlay click closes the modal.
- **Reverse**: on/off (default off)
- There is no dither, opacity, or blend-mode option, and — unlike Fill (`G`) and every neighbouring tool — **the gradient tool has no keyboard shortcut**; it is reachable only from the toolbox.
- **Cmd/Meta+drag**: snaps the gradient angle to 15° increments while dragging (handy for aligning a gradient to a horizontal, vertical, or 45° axis without having to drag a perfectly straight line). Note this reads `metaKey` only, with no Ctrl fallback, so on Windows/Linux the snap is effectively unreachable.
  - **The snap is linear-only in effect.** It rotates the endpoint about the drag origin while *preserving its distance*, and a radial gradient consumes nothing but `radius = |end − start|` — so in radial mode Cmd changes the rendered result not at all. The on-canvas guide line is drawn from the snapped endpoint either way, so holding Cmd during a radial drag visibly rotates the guide while the gradient underneath stays put.
  - If a symmetry mode is active, pressing Cmd *before* the pointer goes down never starts a gradient at all — the canvas intercepts Cmd+click to reposition the symmetry center (see [Symmetry](#symmetry)). Start the drag first, then hold Cmd.
- **Shift** does nothing in this tool, despite being the angle-constraint convention in Photoshop / GIMP / Figma / Krita.
- **The drag preview is live on canvas but not in the panels** — same as the Shape tool: the gradient re-renders on every pointer-move, but the pixel version is bumped once on release, so the Layers and Channels thumbnails lag the drag (#732 — see [Channels Panel](#channels-panel)).
- **Mask edit mode**: when the active layer's mask is being edited, gradient drags paint into the mask texture instead of the layer pixels. The mask route hard-codes `u_hasMask = 0`, so — unlike a gradient on the layer — **an active selection does not confine it** (see [Editing a Layer Mask](#editing-a-layer-mask)).
- **Quick Mask mode**: when Quick Mask is active, gradient drags paint into the GPU quick-mask texture in document space — produces smooth selection falloffs.

### Crop
- **Modes**: Normal (rectangular) or Perspective (4-point quadrilateral correction). The mode dropdown lives in the options bar; switching to Perspective shows Apply / Cancel buttons next to the dropdown.
- **Normal mode**: interactive drag to define crop rectangle. The options bar exposes an **Aspect Ratio** control (W : H number inputs plus a lock toggle); when locked, the crop rectangle is constrained to the entered ratio while dragging. The ratio and lock are **one global setting shared with the two marquees and the Shape tool**, not a crop-specific one — see [Options Bar](#options-bar).
- **Perspective mode**: on first activation a quadrilateral is seeded over the full document. Dragging any of the four corner handles repositions that corner; on Apply, every raster layer is warped by the inverse homography (8×8 DLT solver, bilinear inverse-warp) and the document is resized to the inferred output dimensions (edge-length heuristic). Lets you rectify perspective-distorted photographs of paintings, documents, signs, etc.
- **Edit → Crop**: when a marquee selection is active, the Edit menu's **Crop** item crops the canvas to the selection bounds in one click (equivalent to dragging out the same rectangle with the Crop tool). Disabled when nothing is selected.

---

## Controls That Share a Label But Not a Meaning

The options bars are assembled from one `Slider` component, and several labels appear on many tools at once. A shared label is not a shared code path: each options bar wires its own store field, and each tool's engine interprets that number its own way. These are the labels that appear more than once, and what each instance actually does — followed by the inverse case, two *differently* labeled sliders that turn out to be the same uniform in the same shader. (The equivalent breakdown for the three **Tolerance** sliders — three controls, five metrics — is under [Fill](#fill-paint-bucket).)

### "Size" — eleven sliders, three unit systems

Nine of the eleven share a ceiling formula, `docScaledMax(base) = max(base, min(5000, round(1.5 × longest document side)))`. **The per-tool `base` is almost always dead weight**: it only wins when `1.5 × longest side` falls below it, i.e. on documents whose longest side is under 67 px (Pencil), 134 px (most tools) or 334 px (Spray). On any real canvas — an 800 × 600 document gives 1200 — all nine typed ceilings are *identical*, and the per-tool numbers that look like deliberate tuning have no effect at all.

What does differ is the **knob** ceiling. `Slider` computes `knobMax = min(max, sliderMax ?? max)` and puts only that on the drag track, while the numeric input and the arrow keys clamp to the full `max`. So on a large document every one of these sliders can be typed far past the end of its own track.

| Control | Store field | What the number measures | Typed ceiling | Knob ceiling |
|---------|-------------|--------------------------|---------------|--------------|
| Brush Size | `brush.size` | dab diameter, px | `docScaledMax(200)` | 300 |
| Pencil Size | `pencil.size` | dab **square side**, px | `docScaledMax(100)` | 250 |
| Eraser Size | `eraser.size` | dab diameter, px | `docScaledMax(200)` | 300 |
| Clone Stamp Size | `stamp.size` | dab diameter, px | `docScaledMax(200)` | 300 |
| Smudge Size | `smudge.size` | dab diameter, px | `docScaledMax(200)` | 300 |
| Sponge Size | `sponge.size` | dab diameter, px | `docScaledMax(200)` | 300 |
| Dodge / Burn Size | **`brush.size`** | dab diameter, px | `docScaledMax(200)` | 300 |
| Healing Size | `healing.size` | dab diameter, px | `docScaledMax(200)` | **none set — the whole typed range, up to 5000** |
| Spray Size | `spray.size` | **cloud** diameter, px | `docScaledMax(500)` | 500 |
| Text Size | the layer's `fontSize` | **font size in points** | 500 (flat) | none set — same as typed |
| Quick Selection Size | `quickSelect.size` | **seed-box radius**, px | 100 (flat) | none set — same as typed |

Four consequences worth stating plainly:

- **Dodge / Burn has no size of its own.** Its Size slider writes `brush.size`, so dragging it moves the Brush's size too, and vice versa.
- **Healing is the one paint tool whose knob is uncapped**, because it is the one that passes no `sliderMax`. On a 4000 px document its track runs to 5000 px while every sibling's stops at 300. It is also by far the most expensive dab in the app — two synchronous `read_pixels` stalls per dab (see [Dab Engines](#dab-engines-shared-across-paint-tools)) — so the single tool that invites a 5000 px dab is the one that can least afford one.
- **Two of the eleven are not lengths on the canvas at all**: Text Size is typographic points, and Quick Selection Size is a radius that only sizes a seed-sampling box.
- **Only Quick Selection treats its Size as a radius.** Every dab shader halves it (`radius = u_size * 0.5`), so the same number describes a footprint twice as wide there as under any brush.

### "Opacity" — four sliders, four different meanings

All four are 1 - 100% and all four divide by 100 on the way out. What happens next is different in every case, and the distinction that matters is **ceiling vs rate**: whether a second dab over the same pixel within one stroke can darken it further.

| Control | Behavior within a single stroke |
|---------|--------------------------------|
| Brush Opacity | **Ceiling.** Dabs accumulate into a stroke texture under `MAX`, so overlapping dabs cannot exceed the setting — *except* for color tips, which over-composite instead and therefore do compound. |
| Eraser Opacity | **Rate.** Read-modify-write onto the layer each dab, so overlap compounds multiplicatively — with spacing at 25% of size, an Opacity of 50% removes ≈94% of a pixel's alpha in one pass (see [Eraser](#eraser)). |
| Healing Opacity | **Rate.** Each dab writes `healed × a + existing × (1 − a)` back onto the layer with `a = source.a × stamp × opacity`, so overlapping dabs compound toward full replacement. |
| Spray Opacity | **Stochastic ceiling.** Every dot is scaled by `(0.4 + 0.6 × random) × (1 − 0.3 × dist/radius)`, so the setting is reached only by a center dot with a lucky roll — and because spray dots `MAX` straight onto the layer, more spraying can only ever lighten. |

### "Strength" — two sliders, eight times apart

Both read 0/1 - 100 and sit in adjacent tools, but the scaling is not the same and neither is the maximum:

| Control | Scaling | Value at 50 | Maximum |
|---------|---------|-------------|---------|
| Smudge Strength | `raw / 100` (linear) | 0.50 | 1.00 |
| Sponge Strength | `(raw / 100)² × 0.25` (quadratic, scaled) | 0.0625 | 0.25 |

So "Strength 50" is **eight times** stronger on the Smudge tool than on the Sponge, and Sponge's ceiling is a quarter of Smudge's. Sponge's curve also compresses its own track: the lower half of it covers only the bottom **quarter** of Sponge's range (the defining property of a square law), against a straight half for the linear Smudge.

### "Width" — two sliders, both honest

The remaining duplicated label is the benign one. **Magnetic Lasso Width** (1 - 40) is the half-width of the band the edge detector searches, and **Shape Width** (1 - 50, shown only once a stroke color is set) is the stroke's thickness in pixels. Different quantities, but each is the natural reading of "width" in its own context, and neither is document-scaled.

### The inverse — one code path, two labels: Dodge's "Exposure" and Sponge's "Strength"

Everything above is about a label that repeats. The sharper case is the opposite one: two controls that carry *different* labels and are nonetheless the same number in the same uniform of the same shader.

Sponge does not have a dab shader. `sponge_gpu.rs` binds `engine.shaders.dodge_burn_dab` and writes the Strength slider into **`u_exposure`** — the uniform the Dodge / Burn options bar calls Exposure. The two Rust modules set an identical set of uniforms, and everything around the number is identical too: the same `hardness + (1 − hardness)(1 − t²)` falloff at a hard-coded hardness of `0.5`, the same hard-coded `max(1, size × 0.25)` spacing, the same 1 px `smoothstep` rim, the same document-space selection-mask sampling, the same MAX-accumulated coverage texture. **The only thing that differs between the two tools before the coverage texture is the transfer curve from slider to uniform** — and that differs by up to 400×.

| Slider reads | Dodge "Exposure" → `u_exposure` | Sponge "Strength" → `u_exposure` | Dodge ÷ Sponge |
|--------------|--------------------------------|----------------------------------|----------------|
| 1 | 0.01 | 0.000025 | **400×** |
| 20 | 0.20 | 0.01 | 20× |
| **50** (both defaults) | **0.50** | **0.0625** | **8×** |
| 100 | 1.00 | 0.25 | 4× |

- Both sliders run 1 – 100 and **both ship a default of 50**, where the same displayed number reaches the shader as `0.5` on Dodge and `0.0625` on Sponge.
- The gap is **not a constant factor** — it is `400 / slider`, so it widens as either slider is turned down. The 8× the [Strength table](#strength--two-sliders-eight-times-apart) reports for Smudge vs Sponge is the value this ratio happens to take at 50; here it is the *same uniform in the same shader*, so nothing downstream explains it.
- **The Sponge's whole range fits inside the Dodge's bottom quarter.** Sponge 100 is exactly Dodge 25, and Sponge 20 is exactly Dodge 1 — the Dodge's *minimum*. Nineteen of the Sponge's hundred positions land below anything the Dodge can be set to. Matching the Dodge's own default would need a Sponge Strength of ≈ 141.

What keeps this defensible rather than a plain defect is that the two tools hand the coverage to different final shaders — `dodge_burn.glsl` blends the layer toward white or black by that fraction, `sponge.glsl` adds or subtracts it from the HSL saturation channel — so the two numbers are not required to mean the same thing. But the square and the quarter are bare literals (`scaleSpongeStrength` in `sponge-interaction.ts`); no comment or test records why the Sponge needs a curve when the Dodge does not.

**The ceilings are what the difference actually costs.** Coverage is `clamp(stamp × u_exposure, 0, 1)` and `stamp` is exactly 1.0 at the dab center, so the slider maximum is reached literally. Dodge at Exposure 100 therefore writes coverage 1.0, and `rgb += (1 − rgb) × 1` / `rgb ×= (1 − 1)` drives those pixels to **pure white or pure black in one stroke** — the tool's top setting is a wipe, not a strong nudge. Sponge at Strength 100 tops out at 0.25, so one stroke can never move saturation by more than 25 points and a full desaturation takes **four separate strokes** however far the slider is pushed.

The third control in this family is [Spray's "Softness"](#spray), which is the Brush's `hardness` field under a name that inverts its meaning. Between them, the three non-brush dab tools that borrow brush plumbing all rename the control they borrow.

---

## Layer Effects

Five non-destructive effects — drop shadow, stroke, outer glow, inner glow, and color overlay — are rendered on the GPU during compositing and never touch the layer's pixels until the style is rasterized or the layer is merged. Every layer carries all five (`effects` is a required field on the layer model, not an optional one); they are simply disabled by default.

### The Effects Drawer

Effects are edited in the floating **effects drawer**, which is shared with the Adjustments panel rather than being one of the dockable panels — it is dragged by its header and resized from the native grip in its bottom-right corner. The drawer shows the **layer-effects** list for every layer type *except* groups, which get the Adjustments list instead (see Image Adjustments).

- **Opening**: the effects button on a row in the Layers panel — a three-way toggle that turns green when the layer has at least one **enabled** effect (see *Layers Panel Row Layout*).
- **Closing**: the `X` in the drawer header.
- **Where it sits**: just outside the right dock horizontally (it reads the dock's live width, so dragging the dock's splitter slides the drawer with it), and vertically its **top edge lines up with the top of whichever dock group currently holds the Layers panel** — move Layers into a lower split or a different tab group and the drawer follows it down instead of staying pinned to the top of the sidebar. The anchor is re-measured on dock-layout changes and window resizes, and falls back to the top of the sidebar area whenever Layers is floating, closed, or not yet mounted. Header-dragging offsets the drawer from that anchor; the offset is cleared when the drawer closes.
- With no layer selected the drawer shows only its header and a **No layer selected** message.

Contents, top to bottom:

1. A **Blend** dropdown that sets the *layer's* blend mode — a layer property, not an effect — grouped into Normal / Darken / Lighten / Contrast / Comparative / Composite optgroups. Group layers get an extra **Pass Through** group at the top. In color modes without HSL blend support the Hue / Saturation / Color / Luminosity entries are dropped from the list rather than shown as no-ops.
2. A fixed five-row list — Drop Shadow, Stroke, Outer Glow, Inner Glow, Color Overlay. Each row has a checkbox that enables the effect and a label that selects it for editing. The order is fixed; effects cannot be reordered.
3. The selected effect's property form.
4. **Rasterize Layer Style**, disabled until at least one effect is enabled.

### Shared behavior

- **Render order is fixed** and unrelated to the list order: outer glow → drop shadow → the layer itself (color overlay applied inline to its RGB) → inner glow → stroke. Outer glow is drawn *before* the drop shadow, so an overlapping shadow sits on top of the glow.
- **Colors use the browser's native color input**, not Lopsy's shared color picker. The swatch round-trips through 6-digit hex, so an effect color's **alpha is preserved but cannot be edited from the panel** — it stays at whatever the effect already held.
- **Size-like sliders auto-scale with the document**: the maximum is `max(base, min(5000, round(1.5 × longest side)))`, while the *drag* range is pinned to a usable window so precise tuning stays practical on large canvases. The text field accepts the full scaled maximum.
- **History is coarse.** Toggling pushes `Enable <Effect>` / `Disable <Effect>`; starting a slider drag pushes `Edit <Effect>` so undo returns to the pre-drag value; the Blend dropdown pushes `Change Blend Mode`. Color swatches and the stroke Position buttons push nothing at all (see *Gaps*).

### Drop Shadow
Defaults: disabled, black at 75% color alpha, offset 4 / 4, blur 8, spread 0, opacity 0.75.

- **Color**: RGB from the swatch; the stored alpha multiplies into the result.
- **Offset X / Y**: ± the document-scaled maximum (base 100 px); slider drag pinned to ±200 px.
- **Blur**: 0 to the document-scaled maximum (base 100 px), slider drag capped at 200 px. Implemented as a separable Gaussian blur of the layer's alpha silhouette at radius `ceil(blur)` — **but the radius is clamped to 63 px**, so values beyond 63 look identical.
- **Spread**: 0 – document-scaled maximum (base 100 px), drag capped at 200. **Not a radius** — it is a gamma curve on the blurred alpha (`alpha^(1 − spread/100)`, applied only above 0.5), which chokes the falloff toward a harder edge. At high spread almost any non-zero alpha saturates to fully opaque.
- **Opacity**: 0 – 100% in the UI, stored 0 – 1.

Final shadow alpha is `silhouette × color alpha × opacity`. Because the default color alpha is 0.75 and alpha is not editable from the panel, a default drop shadow tops out at **75% opacity even with the Opacity slider at 100**.

The shadow is **knocked out beneath the layer's own opaque pixels only when Blur is 0**. With any blur the knockout pass is skipped, so a blurred shadow renders at full strength behind the layer — visible through a semi-transparent layer, hidden by an opaque one.

### Outer Glow
Defaults: disabled, pale yellow (255, 255, 100) at full alpha, size 10, spread 0, opacity 0.75.

- **Color**: RGB from the swatch; stored alpha multiplies into the result.
- **Size**: 0 – document-scaled maximum (base 100 px), drag capped at 200 px. Drives the Gaussian blur radius `ceil(size)`, **clamped to 63 px** like the shadow. Below radius 2 the blur is skipped entirely and the glow is a single pass.
- **Spread**: same range, and the same `alpha^(1 − spread/100)` gamma curve as the shadow, not a radius.
- **Opacity**: 0 – 100% in the UI, stored 0 – 1.

The blurred silhouette is masked by the inverse of the layer's alpha, so the glow appears only outside the layer's own coverage.

### Inner Glow
Same controls, ranges, and defaults as Outer Glow — the two share one form and one shader, distinguished by a mode flag. The *inverted* layer alpha is blurred and then masked **by** the layer's alpha, so the glow reads inward from the edges.

### Stroke (Outline)
Defaults: disabled, black at full alpha, width 2, position `outside`.

- **Color**: RGB from the swatch; stored alpha multiplies into the result. The effect's own opacity is fixed at 1.0 by the engine bridge, so with the default opaque color the stroke is always fully opaque.
- **Width**: 1 to the document-scaled maximum (base 50 px), slider drag capped at 100 px. For `outside` and `inside` the stroke extends the full width from the edge; for `center` it extends half the width to each side.
- **Position**: buttons rendered in the order **outside / center / inside**.

The stroke is a **hard, aliased outline**: the shader classifies each pixel as opaque or not at an alpha threshold of 0.5 and paints stroke pixels at full color, so edges on anti-aliased or soft-edged content come out jagged rather than smooth.

Two implementations run depending on width. At an effective half-width of **10 px or less** a brute-force per-pixel distance search runs in a single pass; above that the engine switches to a separable dilation of the alpha at radius `ceil(half-width)`. A `center` stroke on the dilation path is drawn as two passes — the outside half, then the inside half — each composited separately.

### Color Overlay
Defaults: disabled, red (255, 0, 0) at full alpha.

- **Color**: the RGB that replaces the layer's color.

Color overlay is applied **inline during the layer's blend pass** rather than as a separate effect pass, and its mix factor is hard-wired to 1.0 by the engine bridge. The result is an all-or-nothing recolor: the layer's RGB is replaced outright while its alpha is preserved, so the shape and soft edges survive but the original color does not. There is no opacity control, and **the alpha stored on the overlay color is inert** — it is sent to the engine but never read. To get a partial tint, lower the *layer's* opacity or use a blend mode instead.

### Effects on Groups
The engine fully supports effects on **group** layers: a group with enabled effects pre-composites its children into a scratch buffer and the effects attach to that combined surface, so they render around the group as a whole rather than around each child. Enabled effects (like an enabled mask or a non-empty enabled adjustment stack) also **override Pass Through** — the group is composited as isolated regardless of its blend mode, because a pass-through group has no combined surface for the effect to attach to.

**There is currently no UI to author group effects.** Selecting a group and opening the drawer shows the Adjustments panel, never the layer-effects list, and the effects panel is the only thing in the app that writes effect values. Group effects therefore only arrive via a loaded `.lopsy` project, a Lopsy-written PSD, or a color-mode conversion of values that were already there.

### Rasterize Layer Style
Bakes the enabled effects into the layer's pixels and clears them. Available from the drawer button (disabled when nothing is enabled). The layer is re-rendered with its effects on the GPU and the result replaces its texture, which means:

- The layer is repositioned to the document origin and resized to the **full document size**, since effects like shadows and glows extend beyond the original bounds. Sparse layers are re-cropped to their content afterward.
- A **text layer becomes a raster layer**, losing editability.
- All five effects reset to their disabled defaults.
- Pushes one `Rasterize Layer Style` history entry.

**Merge Down** performs the same bake implicitly: if either the top or bottom layer has enabled effects, each is rasterized with its effects and repositioned to full document size before the merge.

### Gaps
- **Effect colors and stroke position are not undoable.** Only the enable checkboxes and slider drags push history entries. Changing any of the five color swatches, or switching the stroke between outside/center/inside, mutates the document with no history entry — undo jumps past the change to whatever was recorded before it.
- The effect list is **keyboard-inoperable**: it is a `listbox`/`option` structure with no `tabIndex` and no key handler, so the five effects can only be selected with a pointer. This is the same shape as the Brushes-modal tab rail, the color picker's slider surfaces, and the Layers-panel drag grip.
- The **"Enable this effect to edit its properties" hint is unreachable**. It renders only when the effect object is missing, but every layer always carries all five effects, so the form is shown whether or not the effect is enabled — editing a disabled effect's sliders is possible and has no visible result.
- The panel's live-preview and committed update paths are **identical code** — both skip history — despite comments describing them as different.
- `color_overlay.glsl` is compiled at startup but never used; the overlay is applied inside the blend shader instead.
- The stroke shader's 64-ray marching branch for half-widths above 20 px is **unreachable** — the engine routes anything above a half-width of 10 px to the dilation path before the shader is reached.

---

## Image Adjustments (Non-Destructive)

The Adjustments panel is a reorderable, stackable list of adjustment **nodes** attached to a group layer. It shares the floating **effects drawer** with the Layer Effects panel rather than being one of the dockable panels: the drawer shows the adjustment list when the active layer is a **group**, and the layer-effects list for every other layer type. Layer → **Adjustment Layer…** selects the document's root group, which is the route to the document-level stack. The drawer is dragged by its header (the offset resets when it closes) and resized from the native grip in its bottom-right corner — 420 px wide by default, minimum 280 × 200 px, maximum height 80vh. Because it is anchored to the inner edge of the right dock, it tracks the dock's width as that is resized.

The Add menu is filtered by the document's color mode: outside RGB, the chroma-producing types (Hue / Saturation, Color Balance, Channel Mixer, Photo Filter, Gradient Map, Black & White, Saturation & Vibrance) are hidden, and Curves shows only the composite curve instead of its R/G/B tabs. The filter applies to the **Add menu only** — a node that is already on the stack keeps its full controls whatever the mode. See Color Modes.

**One cross-cutting hazard worth knowing before you stack these.** Every node in this panel is evaluated by a single shader program that the destructive **Filter → Brightness / Contrast** command also borrows — and that filter resets only 7 of its 42 uniforms. Once any adjustment has been enabled in a session, applying Brightness / Contrast bakes the whole live adjustment stack into the layer's pixels on top of doing its own job, and the panel then keeps applying it as well. Details under [Filters → Color](#color).

Per-node controls (header):
- **Eye** icon — enable / disable this node without removing it
- **Trash** — remove
- **Chevron** — expand / collapse the node's body. Expansion is **exclusive**: only one node is open at a time, and opening a second collapses the first. The open-node state is panel-local, so closing the drawer forgets which node was expanded.
- Drag the header (grip) to reorder; sliders inside the body don't trigger the reorder drag
- New nodes auto-expand on creation

Panel footer: **Add Adjustment** opens the type menu, and the eye button beside it is a **group-wide bypass** that mutes the entire stack in one click without changing any individual node's enabled state — the whole group is skipped before it reaches the engine, so a bypassed stack costs nothing to render. The bypass is per-group and is saved in the `.lopsy` project, so a document reopens with the same groups muted. An empty stack reads *"No adjustments yet. Add one below."*

Available node types (Add menu — labels as they appear in the menu and node headers):
- **Exposure** — stops, -5 to +5 (multiplier = 2^value)
- **Contrast** — -100 to +100
- **Highlights & Shadows** — Highlights -100 to +100, Shadows -100 to +100, Whites -100 to +100, Blacks -100 to +100
- **Saturation & Vibrance** — Saturation -100 to +200, Vibrance -100 to +200 (the -100 floor is full desaturation; the cap extrapolates past 1× saturation distance from gray and only clips at the gamut edge)
- **Vignette** — 0 to 100 (now correctly piped through the per-group adjustment pipeline)
- **Curves** — per-channel tone curves (RGB master + R / G / B), evaluated as
  monotone cubic Hermite splines. Master applies to every channel first,
  then per-channel curves remap their own value. Runs as a single 256×1 RGBA
  LUT texture sampled in the GPU adjustments shader; identity curves bypass
  the lookup.
  - **Editing** (`CurveEditor`): click empty space to add a point — the new point is picked up for dragging in the same gesture; drag to move; double-click a point to remove it; or *yank* it out by dragging it clear of the top or bottom edge. The two **endpoints are pinned** to x=0 and x=1 — they move vertically only and cannot be removed. The canvas draws quarter gridlines plus a diagonal identity reference, and the curve itself is plotted from the same 256-entry LUT the GPU samples, so the preview cannot drift from the render. A hint line under the canvas reads *"Click to add a point · Drag to move · Double-click to remove"*.
  - **Reset** button, one per channel — resets only the channel whose tab is active, and is disabled while that channel is already identity.
  - **Histogram background**: R / G / B histograms render behind the curve. On the **RGB master** tab all three draw as translucent red / green / blue fills composited additively, so overlapping ranges read brighter; on a **per-channel** tab the selected channel is drawn in its own color and the other two are muted to dark gray.
- **Levels** — Photoshop-style visual editor with a layered RGB histogram and handle-driven controls (no sliders). Per-channel input/output remap with RGB master + R / G / B tabs:
  - **Input black / gamma / white**: three rectangular handles below the histogram strip drive Input Black, Gamma (0.1 – 10, log scale), and Input White. Drag the handles directly; numeric readouts update live.
  - **Output black / white**: two handles on a gradient bar drive Output Black and Output White. Handles cannot cross: input black stays at least 1/255 below input white, and output black cannot pass output white.
  - **Readouts** sit under each axis — input/output black and white in 0 – 255, gamma to two decimals.
  - **Histogram visualization**: R, G, and B histograms render layered as distinct shades of gray with additive ("lighter") compositing, so common ranges read brighter. RGB tab shows all three layers; per-channel tabs draw the active channel in its own color and mute the others. With nothing readable yet the strip prints *"No image data"*.
  - **Reset** button — unlike Curves' per-channel reset, this one restores **all four channels** at once, and is disabled only while every channel is already identity.
  - Master is applied first, then per-channel levels. Compiled to a 256×1 LUT and shares the GPU adjustments path with Curves; identity levels bypass the lookup.
  - Note that Levels keeps its R / G / B tabs in **every** color mode — the capability flag meant to hide them outside RGB has no consumer (see Color Modes → Declared but not enforced), so Levels and Curves disagree here.
- **Invert** — single toggle (no numeric controls); inverts RGB at composite time.
- **Hue / Saturation** — Hue -180° to +180°, Saturation -100 to +100, Lightness -100 to +100. Operates per-pixel in HSL space.
- **Color Balance** — tone-range tabs (Shadows, Midtones, Highlights) each with Cyan — Red, Magenta — Green, and Yellow — Blue sliders (-100 to +100). Per-pixel weighting determines how much each tonal range contributes to the shift. The selected tab is view state, not node state: it always opens on **Midtones**, so re-expanding a node does not return to the range you were last editing.
- **Photo Filter** — a "Filter color" swatch (native color input, default warm amber `#ffa000`), Density 0 - 100 (default 25), and Preserve Luminosity (checkbox, **on** by default). Blends a tinted overlay over the pixel; when Preserve Luminosity is on, the tinted result is re-luminance-matched to the source.
- **Black & White** — six channel sliders (Reds, Yellows, Greens, Cyans, Blues, Magentas), each -200 to +300, controlling how strongly that hue contributes to the monochrome output luminance. A new node starts at Photoshop's classic mix — Reds 40, Yellows 60, Greens 40, Cyans 60, Blues 20, Magentas 80 — and those are also the per-slider double-click reset targets.
- **Channel Mixer** — color-coded output-channel tabs (R / G / B) each with Red, Green, Blue (-200 to +200), and Constant (-200 to +200) sliders. Lets a single output channel be remixed as a linear combination of the source channels plus a bias. A new node opens on the Red output at identity (Red 100, others 0); each slider's double-click reset target is 100 for the source channel matching the active output tab and 0 for the rest, so a double-click restores identity rather than zeroing the channel.
- **Gradient Map** — visual gradient editor (shared `GradientEditor` component) with draggable rectangular stop handles on a live gradient bar; clicking an empty spot on the handle row inserts a new stop at that position. The selected stop drives a full `ColorPicker` (HSV square + hue strip + RGB/HSV/hex fields), with a readout showing *Stop N of M* and its position as a percentage, plus a trash button that deletes it. A minimum of 2 stops is enforced — the delete button greys out at two. New nodes start black → white. The stop list is compiled into a 256×1 RGBA LUT at sync time and applied as a luminance-indexed lookup in the GPU adjustments shader.

**Histogram sourcing** (shared by the Curves and Levels editors via the `useGroupHistogram` hook): the histogram is not the active *layer* — it aggregates every **visible, non-group child of the active group** (falling back to the root group's children), read back from their GPU textures **as 256 × 256 GPU-downscaled thumbnails, not at full resolution** — 65,536 samples per child, comfortably above the ~50,000-pixel target the compute pass strides down to, and roughly a 256× cut in bridge traffic versus the full-resolution readback this used to run (~268 MB per read on a 4K document). Because the downscale is LINEAR-filtered on the GPU, the distribution is very slightly smoothed compared with a strided sample of the full texture — a fair trade for a tonal preview sitting behind the curve. Pixels with alpha below 8 are skipped so the transparent parts of a half-painted layer don't swamp the zero bin. The vertical scale is the 99.5th percentile of the non-empty bins rather than the maximum, so one flat-fill spike can't flatten everything else. It refreshes when pixels change — paint operations show up live — but the subscription is keyed on **the per-layer versions of the active group's children alone**, so painting on a layer outside that group no longer re-runs it; and it **deliberately does not refresh when an adjustment changes**, so what you see behind the curve is always the source distribution, never the graded result. If the textures aren't readable yet it retries for a few frames before falling back to the empty state.

All 14 adjustment types now have first-class UI controls and are fully GPU-accelerated. Internally the node list compiles down to the legacy flat `ImageAdjustments` shape so the GPU compositor's adjustment pass is unchanged.

**How a stack of nodes composes.** That flattening step is worth understanding, because it decides what happens when the same type appears twice:
- **Additive types accumulate.** Exposure, Contrast, Highlights & Shadows, Saturation & Vibrance, Vignette, Hue / Saturation, and Color Balance sum their values across every enabled node — two `+1` Exposure nodes equal one at `+2`.
- **Curves, Levels, Photo Filter, Black & White, and Gradient Map are last-enabled-wins.** A second node of one of these types replaces the first outright rather than chaining with it; stacking two Curves nodes does not apply one curve after the other.
- **Channel Mixer composes across output channels but not within one.** Each node writes only the output channel on its active tab, so three nodes (one on R, one on G, one on B) combine into a full mixer matrix, while two nodes on the same output tab collapse to the last one.
- **Invert toggles.** Each enabled Invert node flips the flag, so a second one cancels the first and the composite comes out uninverted.
- **Order matters only for the last-wins types.** Addition is commutative, so dragging an Exposure node above or below a Contrast node changes nothing; reordering is meaningful when two nodes compete for the same slot.
- Disabled nodes drop out of the aggregation entirely rather than contributing an identity value.

**Default adjustment stack on new documents**: every freshly created document (and every image opened or flattened) seeds the root group with four identity-state adjustment nodes — Levels, Curves, Exposure, and Hue / Saturation — so users can grade an image without first hunting through the Add menu. Identity nodes are bypassed in the GPU pipeline so there is no performance cost until a slider is moved. New Document filters that set against the chosen color mode, so a new Grayscale, Lab, or CMYK document gets three nodes rather than four (Hue / Saturation is dropped).

**Adjustment Layer… menu (Layer menu)**: a one-click entry that selects the document's root group, opens the effects/adjustments drawer, and shows a brief explanatory info modal — designed to onboard new users to Lopsy's adjustment-node model (Photoshop puts each adjustment on its own layer; Lopsy stacks them inside the group's adjustment list).

---

## Filters (Destructive, GPU-Accelerated)

### Filter Dialog (shared)

Most filters open the same generic **Filter Dialog** — a 380 px floating modal built from a per-filter parameter list. Numeric params render as sliders; a param with a small fixed value set renders as an inline **segmented toggle** instead (e.g. Add Noise's Mode and Distribution, Emboss's Type). Params flagged doc-scaled raise their slider ceiling to `1.5 × longest-document-side` (capped 5000 px) — the base ceiling is a floor, so the scaling only ever raises it. The same dialog machinery also backs the Select menu's **Grow / Shrink / Feather** commands.

**Which filters actually get it.** Not all of them, and the Filter menu's punctuation is an honest guide: of its 32 items, 29 end in an ellipsis and open *something*, while **the three that don't — Find Edges, Invert, Desaturate — apply the moment you pick them**, pushing their own history entry with no parameters, no preview, and no cancel. Two more skip the generic dialog for one of their own (**Pattern Fill**'s pattern-thumbnail grid and **Color LUT**'s preset picker + `.cube` import), and two replace it with an on-canvas session (**Liquify** and **Tilt-Shift Blur**, below). The `filterRegistry` holds 28 entries, but **two of them are unreachable through it**: `find-edges` applies directly as above, and `tilt-shift-blur` carries a full four-parameter definition that nothing looks up — `'tilt-shift-blur'` is not one of the 29 `FilterDialogId`s, so its declared defaults (notably Focus Width 20 %) are not the ones the session actually starts from.

- **Preview** checkbox (off by default): enabling it renders the filter live on the canvas *and* turns the modal's dark backdrop fully transparent and click-through, so the whole image stays visible while you tune — only the dialog itself remains interactive. Slider changes are debounced ~150 ms before the preview re-renders. Confirming with Preview on commits the exact previewed pixels.
- **Preview is also the expensive way to commit.** It is a pixel snapshot, not a replayed shader: Apply reads the previewed texture back off the GPU (`readLayerCompressed`), restores the saved original so the history entry captures the *unfiltered* layer, pushes history, then re-uploads the previewed pixels. So committing with Preview **on** costs a full-layer readback plus a re-upload, while committing with Preview **off** runs the shader once and pays neither. The readback also has a fallback — if it comes back empty the filter is simply re-run — and that is the one path that can hand you different pixels than you were shown, because a randomized filter draws a fresh seed on every run (see the Regenerate note under Render).
- **Regenerate** button (randomized filters only) — see the Regenerate note under Render.
- **Enter** applies the filter; **Escape** cancels — but only once focus is already inside the dialog. The handler is an `onKeyDown` on the modal `div`, which carries no `tabIndex` and nothing autofocuses, so the keys ride on events bubbling up from a focused descendant: open the dialog from the menu and press Escape without touching anything first and nothing happens; click a slider or the Preview checkbox (or Tab in) and both keys work. The Tilt-Shift session, by contrast, binds Enter / Escape on `window` and so responds anywhere, and the Liquify panel binds no keys at all — its session can only be ended with its own buttons. Cancelling (or closing while a preview is live) discards the preview and restores the layer.
- **Draggable**: the title-bar header (cursor: grab) drags the dialog anywhere on screen, so it can be moved clear of the region being previewed.

### What every filter does to the layer

Independent of which dialog (or none) fronts it, a filter reaches the GPU through one of two helpers in `filter_gpu.rs` — `apply_filter` for the single-pass majority, `apply_separable_blur` for the two-pass ones (Gaussian Blur, Box Blur, Unsharp Mask). Both do the same two things first, and both are visible in the result.

- **Filters are confined to the active selection, and feather with it.** The layer is copied aside first, the filter runs across the whole texture into a scratch buffer, and the two are recombined per pixel as `mix(original, filtered, mask)` against the selection mask. Because that is a linear blend on the mask's own value rather than a cut-out, **a feathered or partially-painted selection yields a partially-applied filter** — a 50 %-grey mask region comes back half-filtered, and a feathered marquee edge fades the effect out across the falloff rather than ending it on a hard line. With no selection active the filtered scratch is simply blitted back over the layer. **Two things opt out.** Color-mode conversion deliberately does — it is the only caller of `apply_filter_full_layer`, on the grounds that a partial conversion would strand half a layer in the old color space. **Liquify simply doesn't participate**: its render path never touches the selection mask, so a Liquify session warps the entire layer even with a marquee live. Mesh Warp, which does go through `apply_filter`, is the opposite case — it honors the mask on top of already confining its grid to the selection's bounding box.
- **A filter grows the layer to at least document size.** `ensure_layer_full_size` runs first, because the scratch FBOs are document-sized and a smaller layer texture would make the filter sample the scratch's unwritten region. For an edit-in-place filter (blur, adjust, sharpen) the new margin is transparent and nothing looks different, but **for the generators it is the whole point of the output**: run Clouds, Smoke, Fibers, or Add Noise on a small shape or a barely-painted layer and the result covers the entire canvas, not the old content bounds. Pair one with a selection to get it back under control.
- **There is no CPU fallback, and the CPU implementation that looks like one is dead.** `lopsy-core::filters` carries a complete, self-contained CPU version of six adjustments (brightness/contrast, hue/saturation, invert, desaturate, posterize, threshold), Gaussian and box blur, unsharp mask, and both noise generators. **None of it runs in the app.** Outside its own module the only production callers are `gaussian_kernel` — which the GPU blur passes use to build their kernel uniform, so that one is genuinely shared rather than duplicated — and `gaussian_blur_gray`, used by the glow effect. Everything else is reachable only from `crates/lopsy-core/tests/visual_output.rs`, a test that writes PNGs to `test-output/` for human review and asserts nothing. That matters for two reasons: a filter whose shader fails to compile or whose context is lost has nothing to fall back to, and **the dead code does not agree with the live code** — its `desaturate` is the Rec. 709 luma the shader does not do, and its brightness/contrast is a different curve entirely (both above). Reading the CPU module to find out what a filter does will mislead you.
- One consequence of that expansion is worth flagging: it re-origins the engine's copy of the layer descriptor (to `x = 0, y = 0` and document dimensions) without telling the Zustand store, which keeps the layer's pre-filter position and size. This is the same engine behavior the paint bucket has to reconcile around — see [Fill (Paint Bucket)](#fill-paint-bucket) — but the menu filters run outside the canvas gesture path and so never call `expandLayerForEditing`, leaving the two descriptions of the layer's bounds out of step until something else resyncs them.

### Blur
- **Gaussian Blur**: radius 1 - 400 px
- **Box Blur**: radius 1 - 100 px (auto-scales with document size)
- **Motion Blur**: angle 0 - 360°, distance 1 - 100 px (auto-scales with document size)
- **Radial Blur**: amount 1 - 100 (centered)
- **Tilt-Shift Blur**: blurs everything outside a configurable focus band, for selective-focus / miniature-photography effects. **It is the one blur with no dialog.** Picking it from the Filter menu starts an on-canvas session that applies the blur *immediately* at its defaults — focus position 50 %, focus width **40 %**, blur radius 12 px, angle 0° — and the preview is unconditional: there is no Preview checkbox to turn off, and every pointer-move re-runs the filter.
  - **One slider, three on-canvas controls.** A small floating panel over the canvas carries **Blur Radius (1 – 32 px)** and the Cancel / Apply buttons — and nothing else. Focus position, focus width, and angle have no numeric control anywhere; they exist only as overlay handles, so those three values cannot be typed or read as numbers.
  - **The overlay** draws the focus band as a faint blue fill between two dashed boundary lines, a fainter dashed centre line, and a 24 px angle dial at the document centre with a bright handle dot on one side and a dimmer stub on the other.
  - **Dragging.** Anywhere *inside* the band moves the whole band (focus position, clamped to 0 – 1) without changing its width. A **boundary line** is dragged against the opposite edge as its anchor, setting position and width together — and because the pair is sorted, pushing one edge past the other swaps which edge you are holding rather than inverting the band. The **angle dial** rotates the focus plane; **Cmd/Meta while dragging it snaps to 15° increments**. Nothing snaps the band's position or width.
  - **The angle handle is aspect-corrected.** The blur axis lives in normalized UV space, so on a non-square document the handle's on-screen direction is remapped through the document's aspect ratio (`atan2(sin·w, cos·h)` one way, `atan2(sin·h, cos·w)` back) to keep it parallel to the band it controls. The consequence is that the stored angle and the visible handle direction only agree on a square document.
  - **Ending the session.** Apply pushes a single **Tilt-Shift Blur** history entry; Cancel restores the texture saved at the start. **Enter** and **Escape** are bound on `window`, so unlike the generic filter dialog they work without focusing the panel first.
  - **It intercepts the canvas before the active tool.** The tilt-shift guard is second of the three pre-tool down guards (after Liquify, before Mesh Warp), and it claims a press only when the hit test lands on a handle *or anywhere inside the focus band*. A press outside the band falls through to whatever tool is selected — so you can keep painting while a tilt-shift preview is live, as long as you stay clear of the sharp strip.
- **Surface Blur**: radius 1 – 50 px (fixed range, does not auto-scale with document size), threshold 1 – 255 (max channel difference a neighbour is allowed to have before being excluded from the blur). Edge-preserving blur that smooths low-contrast regions (skin, gradients, noise) while leaving edges sharp — a Bilateral-style filter implemented as a single GPU pass.

### Sharpen
- **Unsharp Mask**: radius 1 - 50 px (auto-scales with document size), amount 0.1 - 5, threshold 0 - 255

### Color
- **Brightness / Contrast**: -100 to +100 each
- **Hue / Saturation / Lightness**: hue -180 to +180, saturation -100 to +100, lightness -100 to +100
- **Invert**: no parameters
- **Desaturate**: no parameters
- **Posterize**: levels 2 - 32
- **Threshold**: level 0 - 255

**Desaturate is an HSL-lightness grayscale, not a luminance one.** It has no shader of its own: `filterDesaturate` runs the **Hue/Saturation** shader with `u_saturation = -100`, which drives HSL saturation to zero, and `hsl2rgb` then returns the HSL **lightness** — `(max(R,G,B) + min(R,G,B)) / 2` — on all three channels. That is a very different transform from the Rec. 709 luma (`0.2126 R + 0.7152 G + 0.0722 B`) you would expect, and the difference is large and hue-dependent:

| source | Desaturate (HSL lightness) | Rec. 709 luma | delta |
| --- | --- | --- | --- |
| pure red `(255,0,0)` | **128** | 54 | +74 |
| pure green `(0,255,0)` | **128** | 182 | −54 |
| pure blue `(0,0,255)` | **128** | 18 | +110 |
| pure yellow `(255,255,0)` | **128** | 237 | −109 |
| pure cyan `(0,255,255)` | **128** | 201 | −73 |
| pure magenta `(255,0,255)` | **128** | 73 | +55 |
| olive `(110,120,40)` | 80 | 112 | −32 |
| skin tone `(222,173,145)` | 184 | 181 | +3 |

The pattern in the first six rows is the point: **every fully saturated hue desaturates to exactly the same mid-grey, 128.** Red, green, blue, yellow, cyan and magenta become indistinguishable, and the tonal ordering a photographer expects — yellow light, blue dark — is gone entirely. Only near-neutral colors (the skin tone above) come out close to the luminance answer. If you want a luma-weighted grayscale, the **Black & White** adjustment node has per-hue weights; Desaturate is not it.

**Brightness / Contrast's contrast is gentler than the slider range suggests.** The live shader computes `(c − 0.5) × max(contrast + 1, 0) + 0.5 + brightness` with `contrast` normalized to −1…1, so the multiplier runs **linearly from 0× at −100 to 2× at +100** — at full contrast a pixel's deviation from mid-grey merely doubles, and the filter can never clip a mid-tone to pure black or white on its own. (A hyperbolic `(1 + c) / (1 − c)` curve — which reaches 3× at +50 and ~2000× at +100 — exists in the codebase but is part of the dead CPU module below, so it never runs.)

- **Known defect — Brightness / Contrast bakes in the live adjustment stack.** It is the only filter that shares a compiled shader program with the compositor's non-destructive adjustment pass (`adjustments.glsl`, which carries Exposure, Curves, Levels, Hue/Sat, Color Balance, Photo Filter, Black & White, Channel Mixer, Invert, Gradient Map and more). WebGL uniform values are **per-program state that persists across `useProgram` and draw calls**, and `apply_filter` resets nothing — it binds `u_tex` and calls the caller's uniform closure. That closure sets **7 of the shader's 42 non-sampler uniforms** (brightness, contrast, and zeros for exposure/highlights/shadows/whites/blacks); the other **35 — plus the three LUT samplers — keep whatever the last composite frame wrote.** So once you have touched the Adjustments panel in a session, applying Brightness / Contrast permanently bakes that entire adjustment stack into the layer *as well*, and the compositor then keeps applying it on top — the adjustment lands twice, once irreversibly. Turning the adjustments off first does not help: `apply_image_adjustments` early-returns when nothing is active, so the stale uniforms are never zeroed. Only a session that has never enabled an adjustment is safe, because GL initializes uniforms to zero and every one of those flags is a no-op at zero. The zeroing list is a hand-maintained one that stopped at the five tone uniforms the shader had when it was written; every uniform added since was never added to it.

### Noise
- **Add Noise**: amount 1 - 100 (default 25), Mode: Color / Mono (monochromatic), Distribution: Uniform / Gaussian (Uniform is the classic evenly-spread noise; Gaussian clusters values near zero for a finer, film/sensor-grain look)

Add Noise runs through the standard generic filter dialog with live preview and the **Regenerate** button (see the Regenerate note under Render) — each regenerate draws a fresh random seed so users can spin through noise patterns before committing. (The former standalone "Fill with Noise" filter was just Add Noise at maximum amount and has been removed.)

### Pixelate
- **Pixelate / Mosaic**: block size 2 - 64 px

### Halftone
- **Halftone**: dot size 2 - 32 px, density 0.25 - 3 (default 1.0 — scales dot coverage/frequency relative to the cell grid), angle 0 - 180 degrees, softness 0 - 4

### Stylize
- **Find Edges**: Sobel edge detection, no parameters
- **Cel Shading**: levels 2 - 10, edge strength 0 - 100
- **Solarize**: threshold 0 - 255 (inverts tones above the threshold, classic darkroom effect)
- **Kaleidoscope**: segments 2 - 32, rotation 0 - 360 degrees (mirrors the image into a radial wedge pattern around the center)
- **Oil Paint**: radius 1 - 10, sharpness 0.1 - 5.0 (Kuwahara filter that smooths color regions while preserving edges, creating a painterly look)
- **Chromatic Aberration**: amount 1 - 50 px, direction 0 - 360 degrees (splits RGB channels along a configurable axis, creating retro lens fringing and glitch effects)
- **Bloom**: threshold 0 - 100%, soft knee 0 - 100%, radius 1 - 64 px, intensity 0 - 200% (extracts bright areas above the threshold, applies Gaussian blur, and additively blends the glow back onto the original image — creates cinematic light bloom and soft glow effects around highlights)
- **Emboss**: angle 0 - 360° (light direction), strength 1 - 100 (relief height), type: emboss or pillow emboss (creates a 3D relief effect by computing directional highlights and shadows from luminance gradients — emboss mode applies uniform relief, pillow emboss fades the effect toward edges for a raised-pillow appearance)
- **Color LUT**: 8 built-in presets (Warm Vintage, Teal & Orange, Noir, Cross Process, Faded Film, Sunset, Cool Blue, Cyberpunk), intensity 0 - 100%, .cube file import (applies 3D color lookup table color grading via a GPU shader that samples a 2D-unwrapped LUT strip texture — supports industry-standard .cube files and procedurally generated presets with trilinear interpolation between blue slices)
- **Voronoi**: cells 2 - 200, edge width 0 - 20 px, seed 0 - 999 (partitions the image into irregular Voronoi cells, each filled with the color sampled at the cell center, with configurable black edge lines between cells — creates a stained glass / crystallize effect)

### Distort
- **Pixel Stretch**: amount 1 - 200 px, bands 2 - 50, seed 0 - 999, RGB split 0 - 1.0 (shifts horizontal scan-line bands by random offsets with per-channel separation, creating glitch / VHS corruption effects)
- **Lens Distortion**: strength -100 to +100 (negative = pincushion, positive = barrel), zoom 50 - 200%, chromatic fringing 0 - 100% (applies barrel or pincushion radial distortion with optional per-channel color separation at edges, simulating real camera lens effects)
- **Mesh Warp**: interactive grid-based distortion overlaid directly on the canvas. Activated from the Move tool's options bar; grid handles are draggable in document space, with bilinear interpolation between points handled on the GPU. When a marquee selection is active, the warp is constrained to the selection's bounding box (pixels outside pass through unchanged); otherwise the warp covers the whole layer. Grid sizes 3×3 to 6×6 with live preview, reset, and undo support.
- **Liquify** (Filter menu → "Liquify…" or `⌘⇧X`): opens a floating, modal-style session that paints into a per-pixel displacement map sampled by the GPU on each frame. Apply commits the warp to a new history snapshot; Cancel discards the displacement map.
  - **Modes**: `push` (drag pixels along the cursor direction), `twirl CW` / `twirl CCW` (rotate pixels around the brush center), `bloat` (push outward), `pinch` (pull inward)
  - **Brush Size**: 4 - 500 px
  - **Pressure**: 1 - 100% (multiplier for displacement intensity)
  - Quintic radial falloff inside each dab so the warp eases off smoothly at the brush edge
  - **It is the one filter that ignores the selection.** Every other filter blends its result through the selection mask; Liquify's render path never reads it, so an active marquee does not confine the warp (see [What every filter does to the layer](#what-every-filter-does-to-the-layer)). The panel also binds no keys — unlike the filter dialog's Enter / Escape and the Tilt-Shift session's, a Liquify session ends only through its own Apply / Cancel buttons.

### Render
- **Clouds**: scale 1 - 20
- **Smoke**: scale 1 - 20, turbulence 0 - 100
- **Fibers**: variance 1 - 64 (color variation between strands), strength 1 - 64 (vertical coherence — higher values produce straighter fibers, lower values produce more wavy/tangled fibers). Generates random vertical fiber textures resembling paper, cloth, or hair using multi-octave 1D noise with 2D wander perturbation. GPU-accelerated GLSL shader.
- **None of these three has a seed control**, and neither does Add Noise. The seed is drawn inside the filter as a bare `Math.random()` at the moment it runs, so it is neither a parameter nor stored anywhere. The two filters that *do* expose **Seed** as a real slider (0 - 999) — **Pixel Stretch** and **Voronoi** — are for that reason not flagged randomized, get no Regenerate button, and are exactly reproducible; the four randomized ones are not.
- **Regenerate** button: the four randomized filters (Clouds, Smoke, Fibers, and **Add Noise**) show a circular-arrow button next to the Preview checkbox in the generic filter dialog, so variations can be spun through without re-opening it. Mechanically the button picks nothing — it re-fires the preview with the *same* parameter values, and the fresh pattern comes from that `Math.random()` being re-rolled on each run. It also switches Preview on if it was off.
- **The corollary is that every preview refresh reshuffles too.** Because the seed is re-rolled per run rather than held for the session, nudging Clouds' Scale slider redraws a different cloud field at the new scale — with these four filters a parameter cannot be tuned against a fixed pattern. What you finally see is still what you get, but for a different reason than a captured seed: Apply snapshots the previewed *pixels* off the GPU and re-uploads them (see [Filter Dialog](#filter-dialog-shared)).
- **Pattern Fill**: tiles a user-defined pattern across the active layer. Reached from **Edit → Fill with Pattern…** (it is documented here with the other render filters because it shares the generic filter-dialog machinery, but it has no Filter-menu entry of its own).
  - **Define Pattern** (Edit menu): captures the active layer's pixels as a reusable pattern
  - **Scale**: 10 - 1000% (tile size relative to original pattern dimensions)
  - **Column / Row Offset**: 0 - 100% (shifts the tiling origin along X / Y)
  - Pattern selector grid with thumbnails
  - Live preview support
  - Selection mask support (fills only the selected area)

---

## Blend Modes

Sixteen layer blend modes, plus the group-only Pass Through. The dropdown's headings and its within-group ordering both come straight from `BLEND_MODE_GROUPS` (`src/panels/LayerEffectsPanel/LayerEffectsPanel.tsx:21`):

| Group heading | Modes, in dropdown order |
|----------|-------|
| Normal | Normal |
| Darken | Darken, Multiply, Color Burn |
| Lighten | Lighten, Screen, Color Dodge |
| Contrast | Overlay, Soft Light, Hard Light |
| Comparative | Difference, Exclusion |
| Composite | Hue, Saturation, Color, Luminosity |

**Pass Through is not a trailing group.** On a group layer the list is rebuilt as `GROUP_BLEND_MODE_GROUPS` (`:31`), which prepends a **Pass Through** heading holding that one mode *above* Normal; non-group layers never see it. The blend-mode dropdown is rendered only by the **effects drawer** — `LayerEffectsPanel` is the sole surface that draws it, so there is no second copy in the Layers panel to drift from this one.

The four **Composite** modes are RGB-only: every other color mode filters them out of the dropdown (`:66`) and coerces any layer already carrying one to Normal on conversion (`convert-color-mode.ts:32`, see [Color Modes](#color-modes)). The usual justification — that they "decompose RGB into HSL" — only covers half of them. **Hue** and **Saturation** do round-trip through `rgb2hsl` / `hsl2rgb`; **Color** and **Luminosity** never touch HSL at all, and are pure `setLum` operations over a **Rec. 709** luma (`0.2126 / 0.7152 / 0.0722` — the same coefficients in `hsl_common.glsl` and `color.rs:355`). That is *not* the `0.30 / 0.59 / 0.11` luma the PDF / Photoshop non-separable blend spec uses, so Lopsy's Color and Luminosity land on different pixels than Photoshop's given identical inputs.

### Compositing runs in gamma-encoded sRGB, not linear light

`blend.glsl` blends the values exactly as sampled. Layer textures are allocated `RGBA8` or `RGBA16F` and **never `SRGB8_ALPHA8`**, so the GPU applies no automatic linearization, and nothing anywhere in `lopsy-wasm` calls `srgb_to_linear` on the way in. The FP16 path buys precision and EDR headroom, not a linear working space.

This is worth knowing mainly because **the PSD merged composite does the opposite** — it blends in linear light, so it does not match the canvas. See [PSD Export](#psd-export).

### Pass Through (group blend mode)

- Available exclusively on **group** layers. New groups default to **Normal** (isolated) compositing — children pre-composite into a group buffer first, then the group's opacity/effects apply to the combined result, so lowering a group's opacity scales the composited result rather than attenuating each child individually (this diverges from Photoshop, which defaults groups to Pass Through). Pass Through stays as an explicit, user-selectable mode for layouts that genuinely need it.
- In **Pass Through**, children blend directly onto the surface beneath the group, so adjustment layers and effects inside the group affect underlying layers outside the group as well.
- Implemented entirely in the JS sync layer: `engine-sync` flattens pass-through groups before the WASM compositor sees them. The WASM engine itself never receives a "pass through" mode (it has no PSD index or Rust discriminant — exporting a pass-through group to PSD writes 'normal' as a safe fallback).

---

## Layer System

### Layer Types
There are exactly four layer types (`LayerType = 'raster' | 'text' | 'shape' | 'group'`):

- **Raster**: pixel layer
- **Text**: live-editable text
- **Shape**: vector shape (ellipse, polygon) — **declared and round-tripped, but never created**. See below.
- **Group**: folder with optional per-group adjustments

**Nothing in the app ever creates a shape layer.** `ShapeLayer` is constructed in exactly one place in `src/` — `project-load.ts`, deserialising a `.lopsy` file — and `shapeType` appears in only three other places: the type definition, and the two save-side ones (the serialised-layer interface and the writer that fills it). The [Shape tool](#shape-tool) does not make one: its *pixels* output rasterises straight into the **active layer** on the GPU, and its *path* output adds an entry to the [Paths panel](#paths-panel). So the only way to hold a shape layer is to open a project file that already contains one, which Lopsy itself can never have written. Several helpers still branch on the type defensively (`add-layer-mask`, `layer-model`'s width/height accessors, `convert-color-mode`, the PSD writer), and `project-save` writes out all eight shape-specific fields alongside the shared base.

Lopsy has **no** Adjustment-layer or Fill-layer type. Adjustments are non-destructive **nodes** stacked on a group rather than layers of their own (see Image Adjustments), and fills are painted into a raster layer.

### Layer Properties
- **Opacity**: 0 - 1
- **Blend mode**: any of 16 modes (plus "Pass Through" on group layers; new groups default to Normal)
- **Visible**: on/off
- **Locked**: on/off, toggled from the lock button at the far right of the layer row. Locking is a **canvas-input guard only**. A single check at the top of the canvas pointer-down handler covers every tool at once, so no brush, eraser, shape, gradient, fill, stamp, marquee drag, or transform grab lands on a locked layer; arrow-key nudging is guarded separately, the brush pre-warm skips locked layers, and a locked **text** layer is dropped from the text hit-test so it cannot be clicked into for editing. Everything that does not originate as a canvas gesture ignores the flag entirely — **filters, Edit → Fill, Merge Down, Flatten Image, Delete Layer, the Delete key's clear-selection, opacity/blend-mode/visibility edits, effects, and color-mode conversion all apply to a locked layer without complaint**. The engine is told about the flag but never consults it. Toggling the lock pushes **no history entry** (the store treats it as ephemeral UI), yet the state *is* written into `.lopsy` projects — so a lock survives save/reopen but cannot be undone.
- **Position**: x, y
- **Clip to below**: a per-layer boolean that is **inert in this build** — there is no clipping-mask feature in the UI or the renderer. No control anywhere sets it (no menu item, no context-menu entry, no panel toggle, no shortcut — the identifier does not appear in a single component), and every layer is created with it `false`. The flag is forwarded to the engine on every sync as `clip_to_below` and lands on the Rust layer descriptor, but **nothing ever reads it**: the compositor never references it and no shader carries a clipping uniform. The only way a layer acquires a `true` value is **PSD import** or loading a `.lopsy` that was saved from one, and the value then round-trips faithfully back out to both formats. The practical consequence is that a Photoshop document built on clipping masks imports with its clipping metadata intact and **renders unclipped** — each clipped layer composites across the full canvas instead of being confined to the alpha of the layer beneath it — and exports again still flagged, so the information is preserved for other applications even though Lopsy itself never honors it.
- **Effects**: drop shadow, outer glow, inner glow, stroke, color overlay
- **Mask**: grayscale mask with an `enabled` flag (see the caveat under Layer Operations — nothing in the UI can currently flip it). Mask painting with the brush, eraser, pencil, and gradient runs on the GPU mask texture with no per-frame CPU→GPU upload — **the bucket is the exception, and it is a CPU flood fill** (see [Editing a Layer Mask](#editing-a-layer-mask), which also covers why a mask dab is *not* as cheap as a layer dab). For the four GPU tools the round trip happens once per stroke, not once per frame: pointer-down uploads the current mask array to the GPU, every dab in the stroke renders GPU-side, and **pointer-up reads the texture back** and writes it into the layer model. That readback is what makes mask edits undoable — the history entry is pushed *before* the stroke, so the snapshot it takes carries the pre-stroke mask array inside the document. (Quick Mask has no equivalent readback, which is why its strokes are **not** undoable — see Quick Mask Mode.) **Only the mask crosses the bridge.** Until #733 a mask stroke also expanded and cached the layer's *own* RGBA at pointer-down — the guard that skips that work for Quick Mask never named layer-mask mode — so every stroke dragged four bytes a pixel of layer data nobody would read across, on top of the mask's one; and until #734 the stroke-end readback was stored as a freshly allocated array whose new object identity tripped `syncLayers`' reference-equality gate, echoing the same bytes straight back to the GPU on the next frame. The readback's own array is now seeded as the tracked reference, so the upload gate recognizes them as already resident.
- **Color tag**: optional swatch (red, orange, yellow, green, blue, purple, gray, or none) shown as a vertical bar on the left edge of the layer row. Set via the layer row's right-click context menu; useful for visually grouping/organizing layers in a deep stack. **Tags are session-only** — they are not serialized into `.lopsy` projects or PSD exports, so they are lost as soon as the document is saved and reopened.

### Editing a Layer Mask

Mask edit mode reuses the brush, pencil, eraser, gradient, and bucket from the
toolbox, but **none of the five behaves the way it does on a layer.** Each one
routes to a separate, much smaller code path (`mask_paint_gpu.rs`), and the
differences are not cosmetic.

- **The foreground color is never read.** On a layer mask the tool alone decides
  the value: **brush and pencil always paint black (hide), the eraser always
  paints white (reveal)**, and the bucket always fills black. Setting the
  foreground to white and picking up the brush does not reveal anything — you
  have to switch to the eraser. This is the opposite of [Quick Mask](#quick-mask-mode),
  where the brush and pencil *do* read the foreground color (luminance ≥ 128
  adds, below subtracts) and only the eraser is fixed.
- **Nothing is clipped by the active selection.** Painting, filling, and
  gradients on a *layer* all honor the selection mask; mask editing honors none
  of it. The dab
  shader carries no selection uniform at all, the pencil path forces
  `u_hasSelection` to 0, the gradient forces `u_hasMask` to 0, and the bucket
  returns before the selection intersect that the layer route runs. So a live
  marquee does **not** confine a mask stroke, and there is no way to mask-paint
  "inside the selection only". (Quick Mask reaches the same place by a different
  road — entering it clears the selection outright.)
- **The mask brush is not the Brush.** Mask dabs go through a fixed circular
  shader (`quick_mask_dab.glsl` — the same one Quick Mask uses) whose falloff is
  `hardness + (1 − hardness)(1 − t²)` plus a 1 px smoothstep edge. Only **size,
  hardness, and opacity** are forwarded, and the hardness that *is* forwarded
  buys a different dab than it does on a layer: this curve starts falling from
  the very center and floors at `hardness` instead of reaching zero, so
  **Hardness 100 paints a perfectly flat disc** and Hardness 50 is still at half
  strength where the layer brush would be at nothing. The shader's own comment
  calls it "quadratic falloff matching brush stamp"; the layer brush's curve is a
  plateau, not a quadratic. See [Dab Engines](#dab-engines-shared-across-paint-tools).
  Everything else the Brushes modal exposes is silently dropped: the tip bitmap,
  all four jitters, scatter, angle, texture, fade, taper, speed-size, and
  sub-brushes. Spacing is not the brush's Spacing setting either — mask dabs are
  interpolated at a hard-coded `max(1, size × 0.25)`. Painting a mask with an elaborate
  custom preset gets you a plain soft circle. (Symmetry is separately disabled in
  mask mode — see [Brush](#brush).)
- **The mask bucket is not the Fill tool.** It reads Tolerance and Contiguous and
  nothing else, and its tolerance is measured against the mask's own **gray
  value**, not against RGB color distance. Where the layer bucket has been
  tuned down to zero pre-fill readbacks on two of its three routes (#742), the
  mask bucket moves the entire mask across the bridge **four times for one
  click**: JS uploads the mask, the engine reads the whole texture back, runs a
  4-way CPU flood fill in Rust, re-uploads the whole texture, and JS reads it
  back again to update the layer model. There is no GPU route and no
  empty-mask fast path.
- **A mask dab costs two full-texture passes.** The layer brush scissors each dab
  to its bounding box — without that the fragment shader runs across the whole
  stroke texture and discards well over 99 % of its invocations — and accumulates
  into a separate stroke texture that is composited once at pointer-up. The mask
  path does neither. For **every interpolated dab point** it renders the dab
  across the entire mask texture into a scratch buffer, then blits the whole
  scratch back over the mask: two unscissored full-texture passes per point. (The
  mask *pencil* is the exception — it scissors each block, like the layer pencil.)
  At the `max(1, size × 0.25)` spacing above, a
  single 100 px drag of a 10 px brush is 40 points — 80 full-mask passes. Quick
  Mask uses the identical loop against a **document-sized** texture. This is why
  mask painting on a large document feels heavier than painting pixels, despite
  never touching the CPU.
- **Undo behaves, though.** The pointer-up readback described under **Mask** above
  is what makes all of this undoable; the history entries are *Mask Paint*,
  *Mask Erase*, and *Mask Fill*.
- **Painting a mask is a ceiling, erasing it is a rate.** The one shader handles
  both: brush mode writes `max(existing, stamp × opacity)` so overlapping dabs in
  a stroke cannot push a pixel past the Opacity setting, while eraser mode writes
  `existing × (1 − stamp × opacity)` and therefore compounds. It is the same
  ceiling-vs-rate split the [Dab Engines](#dab-engines-shared-across-paint-tools)
  table draws for layers, arrived at here inside a single shader rather than by
  two different architectures. Quick Mask has no such readback and its strokes
  are not undoable — see [Quick Mask Mode](#quick-mask-mode).

### Layer Texture Lifecycle (crop on switch, expand on return)

A raster layer's GPU texture is not always the size the Layers panel implies. The renderer runs a **crop-on-leave / expand-on-return** cycle keyed on the active layer, purely to keep GPU memory down: the layer you are editing is held at document size so a stroke can run anywhere on the canvas, and the layers you are not editing are shrunk back to their content bounds.

- **Leaving a raster layer schedules a crop back to its content bounds.** `cropLayerToContent` reads the texture back, scans its alpha for the tight bounding box, and reallocates. The store's `x / y / width / height` are updated to the cropped rect and `renderVersion` is bumped — but **no history entry is pushed**, so the change is invisible to undo and the crop is silently re-derivable from the pixels.
- **Since #743 that crop is deferred, not run on the switch frame.** At 4K it is a 61 MB GPU→CPU readback plus a 16-million-pixel linear alpha scan — measured at 313 ms — and it used to land on exactly the frame the user had just clicked. It is now scheduled on a `requestIdleCallback` with a 500 ms timeout, falling back on browsers without one to a plain 500 ms `setTimeout` (the fallback path caps any requested delay at 1 s, but this is its only caller and it asks for 500 ms). At most **one crop is queued per layer id**; re-scheduling a layer that already has one pending replaces the earlier callback.
- **Coming back to the layer cancels it outright.** The pending crop is dropped the moment the layer becomes active again, so a bounce off and back pays nothing at all, and the crop can never run mid-edit. When the callback does fire it re-checks its assumptions against live state before doing any work — it bails if the engine is gone, if the layer has become active again, if a float is live, or if the layer is no longer a raster.
- **The expand on return is conditional on the crop having actually happened.** Activating a layer expands its texture back to document size (`expandLayerToDocSize`) only if it is in the cropped set *and* no crop for it is still queued; if the crop was cancelled the texture is already at full size and nothing needs doing. The expand drops the layer's cached JS pixel data so the next `syncLayers` cannot overwrite the freshly expanded texture with the smaller pre-expand snapshot.
- **The user-visible consequence is a window in which the model and the texture disagree.** Between the switch and the idle tick, a layer you have left still reports its pre-crop bounds — and if you never go idle, or you come straight back, it keeps them for the whole session. Nothing depends on the crop for correctness, which is why deferring it was safe; but anything reading `layer.width` / `layer.height` off a non-active layer is reading a value that may be about to change without an undo step to mark it. The undo stack's queued-snapshot handle is released in the same callback, immediately before the crop — see [History](#history).

### Layer Operations
- **New Layer** (`⇧⌘N`, menu-only accelerator — see Single-Key Shortcuts note): appends a blank raster layer above the active one. Refused in **Indexed** color mode (the document is a single flat surface) with an info toast pointing at converting back to RGB. The same guard covers **Group Layers** and **Duplicate Layer**, but *not* text layers — clicking with the Text tool in an Indexed document still adds one.
- **Duplicate Layer** (`⌘J`, menu-only accelerator): clones the active layer and its GPU texture, inserting the copy directly above the original in the same parent group. The copy is **offset +10 px right and +10 px down — it is not cloned in place.** That offset is clamped so the copy's far edge never crosses the canvas edge the original was inside: the shift shrinks to whatever room remains, and drops to **0** for a layer already as wide (or as tall) as the canvas. Duplicating a **group** copies the group and every descendant recursively, remapping the child references, and applies one offset — computed from the group row itself — to the whole subtree.
  - **The clamp does not cover every layer type.** The span helpers it consults report a width for raster, shape, and text layers but a **height only for raster and shape**, and neither dimension for groups. So a text layer's duplicate is clamped horizontally yet always drops a full 10 px down regardless of the bottom edge, and a group's duplicate always shifts the full +10/+10 no matter how large its contents are or how close to the edge they sit.
- **Group Layers** (`⌘G`, menu-only accelerator): wraps the currently-selected layers in a new group
- **Merge Down** (`⌘E`): composites the active layer into the layer below (the only layer-menu accelerator actually wired to a key handler)
- **Flatten Image**: composites every visible layer into a single raster layer
- **Rasterize Layer**: bakes a **text** layer's current visual into pixels in place, reading the engine's current x/y/w/h so the result lands at the visible position even after GPU texture expansion from upstream paint ops. The button appears in the Layers panel toolbar only while a text layer is active — there is currently no rasterize entry point for shape or group layers.
- **Rasterize Layer Style**: bakes a layer's effects (drop shadow, glow, stroke, color overlay) into the layer's pixels and clears the effect descriptors. Its **only** entry point is a button at the bottom of the **layer-effects drawer** — there is no Layers-panel toolbar button and no menu item, so the command is unreachable while that drawer shows the Adjustments panel instead (which it does whenever the active layer is a group).
- Reorder (drag) and move to group (reparent) — both are the same gesture on the row's drag grip; see Reordering & Drag-and-Drop below
- Rename — double-click the layer's name in its row (see Row Layout)
- Align (left, center-h, right, top, center-v, bottom) — works on **group** layers too: a group has no pixels of its own, so it aligns by the combined content bounds of its descendants and shifts the group plus every child together (matching how dragging a group with the Move tool behaves)
- Add/remove mask — works on raster, text, shape, and **group** layers; group masks are sampled at composite time so the entire group is masked as a single unit (with the group's own opacity and blend mode applied on top)
- **Disabling a mask is not reachable.** Every mask carries an `enabled` flag that is fully plumbed — the engine honors it when compositing, the Layers panel dims the thumbnail when it is off, and `.lopsy` projects save and restore it — but the store action that flips it (`toggleLayerMask`, which would push a *Toggle Mask* history entry) **has no callers**. There is no menu item, button, context-menu entry, or shift-click gesture bound to it anywhere in the app. Masks are created enabled and, short of hand-editing a project file, stay enabled for the life of the document.
- **Cmd/Ctrl+click a layer thumbnail**: loads that layer's alpha as a marquee selection — each pixel's alpha becomes the selection mask value (anything below 1 is dropped), so a soft edge yields a feathered selection rather than a hard one. Any live GPU float is committed first and the layer's JS pixel cache is cleared, so the selection reflects the finished pixels. It also **seeds a transform state** from the resulting bounds and schedules a prefloat, meaning the selection comes up ready to scale/rotate. **Group rows have no thumbnail** (they show a collapse chevron in that slot), so there is no way to load a group's combined alpha this way.
- **Click a layer's mask thumbnail**: always enters mask edit mode (focus switches to the mask reliably; no toggle behavior).
- **Set layer color tag**: right-click a layer row to open a context menu with the 7 tag colors plus "None" to clear. The menu is a `role="menu"` popup at the pointer with a swatch grid, a divider, and a **Cancel** item; any mousedown elsewhere or Escape closes it. Right-clicking the **root group** row opens nothing.

### Layers Panel Row Layout

Rows are listed **top layer first** (the display list walks the layer order in reverse) and each is a fixed **36 px** tall. Nesting is shown by indentation only — **8 px of left padding per depth level** — and a layer inside a collapsed group is omitted from the list entirely, at any depth.

Controls in a row, left to right:

1. **Color tag bar** — an optional vertical bar on the row's left edge, present only when a tag is set (red, orange, yellow, green, blue, purple, gray).
2. **Drag grip** — a `GripVertical` handle, `cursor: grab` (`grabbing` while dragging). This is the **only** place a reorder drag can start; dragging the row body does nothing. Absent on the root group.
3. **Thumbnail** *(non-group layers)* — a 24 px canvas. **Group rows show a collapse chevron here instead**, followed by a folder icon; groups therefore have no thumbnail at all.
4. **Name** — double-click to rename in place. Enter commits (via blur), Escape cancels, and a blank or whitespace-only value is discarded, keeping the previous name.
5. **Opacity readout** — the layer's opacity as a rounded percentage, rendered as a button. Clicking it toggles a **slider row open beneath the layer** (0–100, one per row at a time); clicking again closes it. Pointer-down on the slider pushes a single "Change Opacity" history entry, so a whole drag is one undo step. Absent on the root group.
6. **Visibility eye** — toggles the layer on/off. Note this sits **near the end of the row, after the opacity readout** — not at the left edge. Absent on the root group.
7. **Effects button** — opens that layer's effects/adjustments drawer (see below).
8. **Lock toggle** — the far-right control; locked rows are also styled as locked.

The **root group row** is deliberately stripped down: no grip, no opacity readout, no visibility eye, and no context menu — only the effects button and the lock toggle remain.

- **Effects button**: a three-way toggle — if the drawer is already open on this layer it closes; otherwise the row's layer is made active and the drawer opens. Its icon turns **green** (`#4caf50`) to flag decorated layers at a glance. The test is `enabled` for the five effects, but for groups it is simply "has any adjustment node at all" — a group whose nodes are **all disabled still shows green**. (`hasEnabledNodes` exists in `adjustment-node-utils.ts` for exactly this check but has no callers.)
- **Row states**: the active layer takes an accent tint; other multi-selected layers get a 50 % blend of that tint so the two are distinguishable.

#### Mask Sub-Row
A layer with a mask gets its **own row beneath the layer row** (indented, on a tertiary background) — the mask thumbnail is not inline in the layer row. It holds:

- A **20 px mask thumbnail**, outlined in the accent color while mask edit mode is active on that layer and dimmed to 40 % when the mask is disabled (a state no UI control can currently produce — see Layer Operations). Clicking it selects the layer and enters mask edit mode. Unlike the layer thumbnail — which the engine downscales on the GPU (`readLayerThumbnail`, routed since #743 through a **coalescing idle-time queue** rather than fired straight from the effect, and retried up to 10 times — once per queue flush now, not once per animation frame, so a texture that is slow to warm up can take appreciably longer to show than it used to — and subscribed to that one layer's pixel version so a brush dab doesn't trigger a full readback — that version bumps at stroke end, and only on pointer-up for a shape or gradient drag, so the thumbnail lags a drag in progress; see [Channels Panel](#channels-panel)) — the mask thumbnail is drawn by a **CPU nearest-neighbour loop** over the mask array, with no store subscription.
- A **"Mask"** label.
- **Convert mask to selection** — turns the mask into a marquee (seeding a transform state from its bounds, like the alpha-selection route above) and leaves mask edit mode. It converts **inverted**: the selection value is `255 − mask`, so the region the mask *hides* becomes the selection and the visible region is excluded. Since a freshly added mask is filled with 255 (fully visible), the computed mask is empty, no bounds are found, and the button changes nothing but the mask edit mode — it produces a selection only once something has been painted **black** into the mask.
- **Delete mask** — removes the mask and exits mask edit mode.

### Reordering & Drag-and-Drop

Dragging a row's grip starts a pointer-driven reorder; there is no HTML5 drag-and-drop and no keyboard equivalent. The dragged row fades to 40 % opacity, and the drop target is previewed live:

- **Between rows** — the pointer's position within the row it is over picks a gap: above the row in the top half, below it in the bottom half. The gap is drawn as a **2 px accent line** on the neighbouring row's edge.
- **Into a group** — hovering the **middle half (25 %–75 %) of a group row** targets the group itself instead of a gap, drawn as a **2 px accent outline plus a tinted background** on that row. This is offered only when the move is legal (`canMoveToGroup` rejects dropping a group into itself or its own descendant).
- Dropping in the **same place** (the gap immediately above or below the row's original position) is a no-op, as is a drop onto a group the layer is already in.

Reparenting is inferred from the gap's neighbour rather than from indentation: the item **below** the gap decides which group the drop lands in, which is what stops a layer from being sucked into a group when it is dropped at that group's lower boundary. If that neighbour resolves to a different parent than the dragged layer's — and the move is legal — the layer is reparented; otherwise the drop is a plain reorder within the current parent.

### Layers Panel Toolbar

A row of icon buttons pinned below the list. Three entries are **conditional**, so the toolbar's contents change with selection:

- **Add Layer** and **New Group** — always present.
- **Group Layers** — appears only once **two or more** non-root layers are selected.
- **Duplicate Layer** — always present, disabled when there is no active layer or the root group is active.
- **Add Mask** — appears only when the active layer has **no** mask yet.
- **Rasterize Layer** — appears only when the active layer is a **text** layer (see Layer Operations).
- **Delete Layer** — pushed to the far right by a spacer. Deletes every selected non-root layer, and is disabled when the document is down to its last layer or nothing deletable is selected.

### Multi-Select in the Layers Panel
- **Plain click**: selects only the clicked layer (standard behavior)
- **Cmd/Ctrl+click**: toggles a layer in/out of the current multi-selection without changing which layer is "active"
- **Shift+click**: selects the contiguous range from the active layer to the clicked layer
- **Cmd/Ctrl+A**: selects every layer in the document (the root group is excluded). The handler fires when focus is inside the Layers panel **or when nothing is focused at all** (`document.body`), which is the normal state while drawing. Because the global Edit shortcut for the same chord is a separate `document` listener, in that focus-less case `⌘A` runs **both** actions at once — it selects all layers *and* runs Select All on the canvas. Only a text input swallows the chord. (Matched lower-case only, so `⇧⌘A` is not the same binding.)
- **Delete / Backspace** (Layers panel focused): removes every selected layer. The global Delete handler is not suppressed, so this also runs the canvas delete on the active layer in the same keystroke — clearing the selected pixels if a marquee is active, or removing the active layer if not. Two history entries can result from one press.
- Selected layers can be grouped or reordered together. The active layer remains the target for painting, filters, and adjustments — but **not for the Move tool**, which drags (and arrow-key nudges) every selected unlocked layer at once. See [Move](#move).

### Clipboard
- **Cut** (`⌘X`) / **Copy** (`⌘C`) / **Paste** (`⌘V`): standard clipboard actions; copy/cut respect the active marquee selection
- **Copy Merged** (`⇧⌘C`): composites all visible layers within the selection bounds before copying, so the clipboard contains a flattened RGBA snapshot rather than just the active layer
- Paste external image data (PNG/JPEG/WebP from the system clipboard) creates a new raster layer with the bitmap

### Fill from Menu
- **Fill** (Edit menu, `⇧F5` — menu-only accelerator, not wired to a global key): fills the current selection (or the entire layer if no selection) on the active layer with the **foreground color**, immediately. There is no dialog and no color/pattern choice — to fill with anything else, set the foreground color first or use Fill with Pattern. The fill runs on the GPU and honors the active selection mask.
- **Fill with Pattern…** (Edit menu): opens the Pattern Fill dialog — see Filters → Render → Pattern Fill for scale / offset / selection-mask behavior. This Edit-menu item is the **only** entry point; the Filter menu has no Pattern Fill entry.
- **Define Pattern** (Edit menu): captures the active layer's pixels as a reusable pattern (used by Fill with Pattern… / the Pattern Fill dialog)
- **Define Brush…** / **Define Color Brush…** (Edit menu): captures the marquee selection as a new alpha or color brush tip (see Brush → Brush from Selection)

---

## Canvas Operations

Five commands rewrite the document's own geometry, and all five are GPU-side —
no pixel data round-trips through JS (#710 for the three document-wide ones).
Four of them (`crop_texture`,
`resize_canvas_texture`, `scale_texture`, `rotate_texture_90`) allocate a fresh
texture at the new size, blit the old content into it, release the old handle
and swap in the new one; `flip_texture` is the exception, rendering through
`scratch_a` and back into the *same* texture, which is why Flip alone cannot
change a layer's dimensions. Each then drops the JS pixel cache so the GPU is
the sole source of truth afterwards — `pixelDataManager.replace` with empty maps
for Crop / Canvas Size / Image Size, `clearAll()` for Rotate Image, and
`remove(activeId)` for Flip.

- **Crop canvas**: by rectangle — either dragged with the [Crop tool](#crop) or
  taken from the selection bounds via **Edit → Crop**.
- **Canvas Size…** (Image menu): new width/height with anchor point — extends or
  trims the document without resampling layer pixels.
- **Image Size…** (Image menu): new width/height that resamples the document.
- **Rotate Image 90° CW / 90° CCW** (Image menu): swaps the document dimensions
  and rotates the raster layers about the document center.
- **Flip Horizontal / Vertical** (Image menu): mirrors the **active layer**
  along the chosen axis (per-layer, not document-wide, so partial-image flips
  are possible).

### What each one actually touches

Only two of the four layer types are handled. `mapLayersForTransform` — the
shared spine of Crop, Canvas Size, and Image Size — dispatches on `text` and
`raster` and passes everything else through unchanged; `rotateImage` skips
every non-raster layer outright.

| | raster pixels | raster geometry | text | shape / group | layer mask | selection |
|---|---|---|---|---|---|---|
| **Crop canvas** | cropped to the rect | reset to `(0,0)` at full canvas size | translated by the crop origin | untouched | untouched | untouched by the tool; **Edit → Crop clears it** |
| **Canvas Size** | repositioned inside a new full-canvas texture | reset to `(0,0)` at full canvas size | translated by the anchor offset | untouched | untouched | untouched |
| **Image Size** | bilinear rescale | scaled by the document factor, **crop preserved** | position scaled, **font size unchanged** | untouched | untouched | untouched |
| **Rotate Image** | rotated 90° | dimensions swapped, position rotated about the document center | **untouched** | untouched | untouched | untouched |
| **Flip** | mirrored within the layer's own texture | untouched | mirrors the rendered glyph texture | no-op on a group's 1×1 placeholder | untouched | untouched |

**Layer masks are never transformed by any of the five.** The Rust helpers
(`crop_texture`, `resize_canvas_texture`, `scale_texture`, `rotate_texture_90`,
`flip_texture`) all operate on `engine.layer_textures` and never look at
`engine.layer_masks`, and on the JS side the `{...layer}` spread carries the
same `LayerMask` object through, so `sync-layers` — which re-uploads only when
`layer.mask.data` changes by reference — never pushes a new one. The mask keeps
its pre-operation pixels *and* its pre-operation dimensions. `blend.glsl`
samples it at `(docPos − layerOffset) / u_maskSize`, i.e. 1:1 document pixels
anchored at the layer's origin, and where that UV falls outside `0…1` the mask
is **not applied at all** — so the part of a resized or rotated layer the stale
mask no longer covers comes back **fully unmasked** rather than hidden.

**The selection is never transformed either.** None of the five reads or writes
`state.selection`, so after a Crop-tool crop or any of the Image-menu commands
an active marquee keeps its old document-space `bounds` and `maskData` while
the document underneath has moved or resized. Only **Edit → Crop** tidies up
after itself, by calling `clearSelection()` once the crop lands.

### Rotate Image 90° CW / CCW

- **Raster only.** The loop pushes every non-raster layer through with its
  position and dimensions untouched, so **text layers do not rotate and do not
  move** — they keep their old coordinates in a document whose width and height
  have just swapped. A caption sitting near the bottom of a portrait document
  ends up off the right edge of the resulting landscape canvas.
- Raster layers are rotated on the GPU and repositioned about the document
  center: clockwise sends `(x, y)` to `(docH − y − h, x)`, counter-clockwise to
  `(y, docW − x − w)`, with width and height swapped.
- **Known defect — the rotation does not mark its layers dirty.** Unlike Flip
  and Rotate Layer, which both add the layer to `dirtyLayerIds`, `rotateImage`
  writes only `document` and `renderVersion`. That is usually masked because
  `snapshotGpuLayers` also re-snapshots any layer whose position or raster
  dimensions changed — but a layer that is *invariant* under the rotation
  (a square layer centred on a square document, including a full-canvas layer
  on a square document) matches on both, so the **next** history push reuses the
  pre-rotation snapshot handle and undoing that later action restores unrotated
  pixels. This is the same failure mode as #704.

### Flip Horizontal / Vertical

- **No type guard, and history is pushed first.** `flipActiveLayer` records the
  *Flip Horizontal* / *Flip Vertical* entry before it looks at anything, then
  calls `flipLayer` on whatever texture the active layer owns. On a group that
  is the 1×1 lazy placeholder, so the command adds an undo step and changes
  nothing visible. On a text layer it mirrors the rendered glyph texture, and
  the mirror survives until something re-renders the layer from its stored
  string (any text property edit, a font binary finishing its download, or the
  layer losing a path binding) — at which point the glyphs silently snap back.
  Contrast [Rotate 90°](#quick-transforms), which bails out on any non-raster
  layer *before* pushing history.
- **The mirror is about the layer's own bounding box, not the document.**
  `flip_texture` flips UVs within the existing `w × h` texture and writes back
  into it; `x` / `y` are never touched. A layer smaller than the canvas
  therefore flips in place rather than moving to the opposite side of the
  document.

### Canvas Size and Crop reset every raster layer to full canvas

Both `resize_canvas_texture` and `crop_texture` allocate a texture at the **new
document size**, clear it to transparent, and blit the old content in at its
offset — and the JS side then rewrites the layer as
`{ x: 0, y: 0, width: newW, height: newH }`. Two consequences:

- **Anything outside the new bounds is gone.** Trimming with Canvas Size or
  cropping discards the off-canvas pixels permanently; there is no equivalent of
  Photoshop's "reveal all" to bring them back.
- **The cropped-to-content storage invariant is discarded.** A 50 × 50 sticker
  layer becomes a full 4096 × 4096 texture on a 4K document, for every raster
  layer in the stack. **Image Size** deliberately does *not*
  do this — it scales each layer's own width/height/x/y by the document factor
  (floored at 1 px) precisely so a small layer isn't stretched to fill the
  canvas.

### The two dialogs

`Canvas Size…` and `Image Size…` are the only top-level Image-menu items that
open a dialog (Mode → *Indexed Color…* opens a third, from the submenu). The two
share their number handling and diverge everywhere else.

- Both clamp Width and Height to **1 – 16384 px** on Apply, and both fall back
  to the *current* document dimension when a field is blank or unparseable —
  so clearing a field and pressing Apply is a no-op on that axis rather than an
  error.
- Both bind Enter (apply) and Escape (cancel) with an `onKeyDown` on the dialog
  `<div>`, which has no `tabIndex` and autofocuses nothing. React's handler only
  sees events that bubble from inside, so the keys work once focus is in one of
  the inputs and do nothing on a freshly opened dialog — the same focus
  requirement the [filter dialogs](#filter-dialog-shared) have.
- **Canvas Size** shows the current size, the two fields, and a **3 × 3 anchor
  grid** defaulting to centre. The anchor picks where the old canvas sits inside
  the new one: `offset = round((new − old) × anchor)` per axis.
- **Image Size** shows a **Constrain proportions** checkbox (default on) and a
  live percentage beside each field. The ratio it constrains to is the
  document's ratio **as of when the dialog opened**, held constant for the
  dialog's lifetime rather than re-derived from the current field values. The
  percentages are read-outs only — there is no percent entry mode — and there is
  **no resample-method choice**: `scale_texture` always switches the source
  texture to `LINEAR` for the blit (restoring `NEAREST` afterwards), so every
  Image Size is bilinear.
- **Both dialogs push history unconditionally.** `resizeCanvas` and
  `resizeImage` call `pushHistory` before they compute anything, so pressing
  Apply without changing a number still leaves a *Resize Canvas* / *Resize
  Image* step on the undo stack. Crop guards more carefully — `cropCanvas` rejects a
  zero-area rectangle *before* `pushHistory`, so a degenerate drag records
  nothing (cropping to the full document is still a real entry).
- **Only the raster layers are resampled by Image Size.** Text layers have their
  `x` / `y` scaled but not their font size, so type stays at its original point
  size while the artwork around it grows or shrinks; shape and group layers are
  not touched at all.

### Crop tool commit

A Normal-mode crop **commits on pointer-up** — there is no confirmation step,
unlike Perspective mode's Apply / Cancel buttons. The drag rectangle is clamped
to the document as it is drawn, and `handleCropUp` requires it to be more than
1 px on *both* axes before it commits, so a stray click-drag is discarded.

---

## Auto Enhance (Image Menu)

One-click image correction commands that analyze the **active layer's** pixel histogram and append a non-destructive adjustment node to a **group**. The three shortcuts are real key handlers (not display-only accelerators) — they run from `edit-shortcuts.ts` and are gated on Cmd/Ctrl.

- **Auto Tone** (`⇧⌘L`): stretches each R/G/B channel independently to fill the full tonal range, clipping the darkest and brightest 0.1% of pixels per channel. Adds a Levels adjustment node that moves **only the per-channel input black/white points** — gamma stays 1, the output range stays 0–1, and the master RGB channel is left at identity.
- **Auto Contrast** (`⌥⇧⌘L`): stretches the Rec. 709 luminance histogram (`0.2126 R + 0.7152 G + 0.0722 B`) uniformly across all channels, preserving relative color balance. Adds a Levels adjustment node on the master RGB channel only, with R/G/B left at identity.
- **Auto Color** (`⇧⌘B`): neutralizes color casts by computing each channel's histogram-weighted mean and pulling all three toward a **common target — the average of the three channel means** (not a fixed mid-gray). Adds a Curves node holding, per channel, a single moved midpoint between fixed `(0,0)` and `(1,1)` endpoints.

**Auto Color does not stretch the tonal range.** The per-channel clip points are computed, but they are used only to normalize *where* the midpoint sits in curve space — the returned curve's endpoints are hard-coded to `(0,0)` and `(1,1)`, so black and white are never remapped. It is a pure midpoint (color-balance) correction; use Auto Tone or Auto Contrast for range stretching.

**Auto Color is often a no-op**, leaving a plain identity curve. The midpoint is inserted only when the channel is measurably off-target (`|midX − midY| > 0.005`) *and* the mean sits away from the ends (`0.05 < midX < 0.95`); the whole curve falls back to identity when the clipped range is narrower than 0.01. One direct consequence: on a **Grayscale** document all three channel means are equal, so the target equals every mean and Auto Color can never do anything.

Histogram details shared by all three: **fully transparent pixels (alpha 0) are skipped entirely** and don't contribute to any channel, while partially transparent pixels count at full weight from their un-premultiplied values. If a channel's clip search collapses (`black ≥ white`, e.g. a flat single-value layer) it falls back to the full 0–255 range rather than producing a degenerate stretch.

**The target is effectively always the root group.** The resolver returns the active layer's own id only when that layer *is* a group — but the pixel read (`readLayerAsImageData`) returns null for group layers, which have no GPU texture, so the command returns early before it ever gets there. Net effect: selecting a group and invoking any Auto command **does nothing at all, silently** (no toast, no history entry); in every other case the node lands on the **root** group, even when the active layer is nested inside another group. So the histogram is measured from one layer while the correction applies to the entire composite.

All three are undoable and auto-switch the target group from pass-through to normal blend mode when adding adjustments (required for the compositor to apply group-level adjustment nodes). Levels and Curves are permitted in every color mode, so none of the three is filtered out by the Image → Mode capability check.

**Caveat in Lab mode**: adjustment nodes are applied to the composite *before* the Lab→RGB decode, which lives only in the final screen blit (`final_blit.glsl`). The layer texture these commands read is likewise still encoded. So in Lab mode all three analyze and stretch the **L / a / b planes as if they were R / G / B** — Auto Tone will stretch the two chroma planes independently rather than correcting tone.

---

## Viewport & Workspace

### Viewport
- **Zoom**: 0.01x - 64x
- **Pan**: unlimited
- **Fit to view**: auto-zoom with padding — the *automatic* fit, run on first mount and at the end of every document-opening path (New, Open, paste-as-document, PSD / DNG / RAF import, project load, perspective crop). Padding is `min(40, viewportW/4, viewportH/4)` per side, and the result is **capped at 1×**: a document smaller than the viewport opens at 100 %, never blown up to fill the window.
  - **This is not the same fit as `⌘0`.** View → **Fit to Screen** (and its `⌘0` binding) uses a different formula — `min(viewportW/docW, viewportH/docH) × 0.9`, with no padding term and **no 1× cap** — so it *will* upscale. Opening a 64 × 64 document in a 1200 × 800 viewport lands at 1×; pressing `⌘0` on that same document jumps to roughly 11×. For documents larger than the viewport the two land in nearly the same place (the 0.9 factor stands in for the padding), so the divergence only shows up on small documents.
- **Space+drag** or **middle-click drag**: temporarily pan from any tool
- **Cmd/Ctrl+scroll**: zoom in / out (factor `1.002^-deltaY`, clamped to 0.01× – 64×); plain scroll pans. The zoom is anchored to the **viewport center**, not the cursor — the wheel handler only writes `viewport.zoom` and does not compensate pan. (The Reference Image drawer's wheel zoom *is* cursor-centered; the canvas is not.)
- **Two-finger pinch** (touch): pinching anywhere in the viewport scales the zoom from the gesture's start distance (clamped 0.01× – 64×) and pans by the touch-midpoint delta. The gesture is picked up even when a finger lands on surrounding UI chrome rather than the canvas, and it cancels any in-flight tool stroke first so a pinch never leaves a stray mark.
- **Cmd/Ctrl + `=`** / **Cmd/Ctrl + `-`**: zoom in / out by 1.5× (clamped to the 0.01× – 64× range)
- **Cmd/Ctrl + `0`**: fit document to view (90% of the smaller canvas-to-document ratio, pan reset to origin)
- **Cmd/Ctrl + `1`**: jump to 100% (1×) zoom and recenter
- **Pixel grid**: a 1-CSS-px translucent gray lattice rendered when the viewport zoom exceeds 800% (8×), so individual document pixels are visible during pixel-accurate editing. View → "Show Pixel Grid" toggles whether the lattice is drawn at all (default on).

### Grid
- **Show grid**: on/off, **off by default**.
- **The lattice is centered on the document, not on its origin.** `renderGrid` grows lines outward from `(docWidth / 2, docHeight / 2)` in both directions, so a line always falls exactly on the document's midpoint and the leftover partial cell ends up at the canvas edges rather than in the middle. Lines are clipped to the document rect, so the grid never extends into the surrounding workspace. **Only two of the seven snap consumers actually use this lattice** — see [Snapping](#snapping).
- **Major lines every 4 cells**: minor lines draw at `rgba(128, 128, 128, 0.25)` and every fourth at `0.5`, both `1 / zoom` document units wide so they stay a constant 1 screen px at any magnification.
- **The grid is the first thing drawn on the overlay canvas**, ahead of marching ants, guides, snap lines, transform handles and the brush cursor — so it paints over the artwork but every other piece of overlay chrome paints over it.
- **Grid size**: default 16 px, changed from a slider in the [options bar](#options-bar) that appears only while the grid is shown — the sole place in the app that can set it. The slider steps through a list of power-of-two stops derived from the document's longest side, so the choices differ per document and the stored size is never re-clamped when the document changes; see the options bar for the stop table and the resulting readout/needle mismatch.
- **Snap to grid**: on/off (auto-enabled with grid). Every consumer requires **both** Snap to Grid and Show Grid, so hiding the grid silently disables snapping while leaving View → Snap to Grid checked.
- **Cmd/Ctrl + `'`**: toggle grid visibility from anywhere in the app

### Rulers
- **Show rulers**: on/off (default on), toggled from **View → Show Rulers**. (The menu lists a `⌘R` accelerator, but unlike the grid and guide toggles it is not currently wired to a global key handler.)
- **20 px thick** (`RULER_SIZE`), one along the top and one down the left, with the corner square painted over both of them and the guide-color swatch painted over that.
- **Tick spacing follows the zoom.** The renderer takes `50 / zoom` document pixels as a target and rounds it **down** to the nearest entry in the 1-2-5 × power-of-ten sequence (`… 1, 2, 5, 10, 20, 50, 100 …`), with a floor of 1 px — so the labelled interval changes as you zoom and always lands on a round number instead of an arbitrary one. 100 % zoom labels every 50 px, 200 % every 20, 400 % every 10, 800 % every 5. Ticks are 6 px long and drawn only on the inner edge.
- **Labels are plain document pixels**, rounded to integers, with no unit suffix. The vertical ruler's labels are rotated a quarter turn. Positions outside the canvas are labelled with their real (negative or over-size) coordinates rather than being suppressed.
- **A cursor indicator line tracks the pointer in each ruler** — a 1 px line at the pointer's document X in the top ruler and its Y in the left one, drawn in the **guide color** rather than a color of its own (the renderer's `#4a9eff` default is unreachable, because the overlay always passes the store's `guideColor`).
- **The ruler palette is fixed dark** — background `#2a2a2a`, ticks `#555555`, labels `#888888`, all hard-coded in the renderer rather than read from `tokens.css`. Because this is a 2D overlay canvas and not styled DOM, the rulers stay dark when the app is switched to the light theme.

### Guides
- **Show guides**: on/off
- **Orientation**: horizontal or vertical
- **Click a ruler to create**: a single click on the horizontal ruler drops a vertical guide at that position (and vice versa) — this is a click, not a drag. There is no drag-to-create, and placed guides cannot be repositioned by dragging; remove and re-place instead.
- **Click a guide on the ruler to remove it**: clicking the ruler within ±1 px of an existing guide's position deletes that guide rather than adding another.
- **Cmd/Ctrl while clicking the ruler — snap the new guide to a layout fraction.** Holding Cmd (or Ctrl) quantizes the guide to the nearest fraction of the document's **width** for a vertical guide, or **height** for a horizontal one. The stops are the reduced fractions with denominators **2, 3, 4, 6, 8, and 16**, plus both edges — **21 positions**: `0, 1/16, 1/8, 1/6, 3/16, 1/4, 5/16, 1/3, 3/8, 7/16, 1/2, 9/16, 5/8, 2/3, 11/16, 3/4, 13/16, 5/6, 7/8, 15/16, 1`. Fifths, sevenths, ninths, elevenths, and thirteenths are deliberately left out so they don't crowd the stops a layout actually reaches for. The snapped position is rounded to a whole pixel.
  - **The hover preview honors the same modifier**, so the ruler's guide preview jumps to the snapped position before the click commits it — press or release Cmd while hovering to see where the guide will land.
  - **The hover tooltip switches to the fraction itself.** With Cmd held, the readout beside the ruler preview stops showing a pixel position and names the stop instead — `1/2`, `3/8`, `2/3` — with the two ends rendered as `0/1` and `1/1` so they read as part of the same series. Release Cmd and it returns to the rounded pixel value. The label is re-derived from the resulting position rather than carried down from the stop that was chosen (it takes the first table entry within ±0.5 px, scanning low to high), so on a document smaller than ~46 px along the snapped axis two neighbouring stops can round to the same pixel and the *lower* fraction is the one displayed. At any ordinary document size every stop labels exactly.
  - **There is no distance threshold.** The snap always takes the *nearest* stop no matter how far away it is, so while Cmd is held there is no way to place a guide at an arbitrary position — a click anywhere on the ruler lands on one of the 21 fractions. Release Cmd for free placement.
- **Guide color**: click the **ruler corner square** (the box where the two rulers meet) to open the guide-color picker; clicking it again closes it. This is the only entry point to the picker.
- Guide creation, removal, and the color picker all require **both** Show Rulers and Show Guides to be on — with either off, ruler clicks do nothing.
- **Cmd/Ctrl + `;`**: toggle guides visibility from anywhere in the app
- **Clear Guides** (Edit menu): removes every guide currently placed on the canvas in a single action
- **Nothing snaps to a guide.** Guides are purely visual reference lines. The [Snapping](#snapping) modes attract to the grid and to other layers; there is no snap-to-guides mode, no menu item for one, and no code path that consults `ui.guides` while dragging. A `snapToGuide(position, guides, threshold)` helper does exist in `tools/move/move.ts` and is unit-tested, but its only importer is its own test file — **no production caller**. Guides tell you where to line something up; they will not do it for you.
- **Placed guides get a playhead triangle on the ruler**: a triangle 12 px across and 9 px deep pointing down from the top ruler for each vertical guide, and pointing right from the left ruler for each horizontal one, drawn in the guide color at 70 % alpha. It is clipped away once the guide scrolls off the visible ruler.
- **Hovering a guide highlights its playhead only.** Moving the pointer within **±1 document pixel** of a guide's position turns that guide's ruler triangle white — the guide *line* itself does not change. The probe runs over the whole canvas, not just the rulers, so simply passing the cursor over a guide on the artwork lights up its marker on the ruler. Because the tolerance is in document space, it is worth 1 screen px at 100 % zoom and 16 at 1600 %.
- **Guides cannot be selected.** The store carries `selectedGuideId`, and both renderers have a "selected" branch (a full-opacity line, a solid white playhead), but `selectGuide` has **no caller anywhere in `src/`** — the field is only ever written back to `null`, by `removeGuide`, `clearGuides`, and the project loader. Both selected-state branches are unreachable, so every guide draws at 70 % alpha and no playhead is ever the selected white. Dead state, the same shape as `document.backgroundColor`.
- **With Cmd held, clicking a fraction that already carries a guide stacks a second one.** The delete probe runs *before* the snap and tests the **raw pointer position**, while the guide that gets added uses the **snapped** position. So Cmd-clicking near — but more than 1 px away from — an existing guide at, say, `1/2` finds nothing to delete and adds a duplicate at exactly the same coordinate. The two lines are indistinguishable on screen, and each needs its own click to remove.
- **The delete probe checks both orientations.** `findGuideAtCursor` compares the pointer's document X against every *vertical* guide and its document Y against every *horizontal* one, and returns the first match in creation order — it is not scoped to the ruler being clicked. Clicking the top ruler can therefore delete a horizontal guide, in the narrow case where the ruler strip maps to within 1 px of that guide's Y.
- **Guides are not undoable.** They live in the UI store, outside the [history system](#history) entirely: adding, removing, and Clear Guides all push nothing, and undo will not bring a cleared guide back.
- **Every document-opening path clears them.** `createDocument` ends in `clearGuides()`, and every entry point routes through it — New Document, Open Image, paste-as-document, PSD import, DNG / RAF import, and project load. The `.lopsy` loader is the only one that puts any back, re-seeding `guides` from the manifest immediately afterwards (see [Native Project Format](#native-project-format-lopsy)).
- **The guide color drives three overlays, not one.** Besides the guides themselves it colors the **ruler cursor indicator** lines and the **symmetry center marker** (the ringed crosshair drawn while a [symmetry](#symmetry) axis is active on a paint tool). Changing it from the ruler corner swatch repaints all three. Default is `rgb(0, 180, 255)`.

### Snapping
Two independent modes, both toggled from the View menu. Snap to Grid additionally has a **Snap** checkbox in the [options bar](#options-bar) beside the grid-size slider, and both flags are gated on Show Grid — see the [Grid](#grid) section.

**Snap to Grid is not one behavior.** All seven consumers require `showGrid && snapToGrid`, but only one of them snaps an *angle* — the transform rotation handle, which quantizes to 15° (see [Scale, rotate, and modifiers](#scale-rotate-and-modifiers)). The other six quantize a position, and they do it in three mutually incompatible ways:

- **Absolute, document-centered** (whole-layer Move drags, and both ends of a marquee drag): the position is quantized against the same center-anchored lattice the grid *draws*, so the result lands on a visible line. This path also **snaps to the canvas edges**: if the value is within half a grid cell of `0`, `docWidth`, or `docHeight`, it goes to that edge instead, so content aligns to the canvas border even where the centered lattice does not reach it. On a layer the edge test applies to its **origin**, so the "right edge" stop parks the layer's *left* edge on the canvas's right border, pushing it off-canvas.
- **Absolute, origin-anchored** (dragging a transform **scale** handle, and dragging a **selection**-transform handle): the pointer is quantized as `round(p / gridSize) * gridSize` — a lattice anchored at the document's top-left corner, not its center. **These land on the drawn grid lines only when half the document's size is an exact multiple of the grid size.** On the default 1920 × 1080 document at the default 16 px grid, the vertical lines agree (`960 % 16 == 0`) while the horizontal ones are permanently 12 px off: the grid draws at `… 508, 524, 540, 556 …` and the snap goes to `… 512, 528, 544, 560 …`.
- **Relative, no lattice at all** (arrow-key nudges, and dragging a **floating selection**): nothing is quantized — the *displacement* is changed to a whole number of cells. A nudge moves by `gridSize` instead of 1 px, and a floating-selection drag snaps its offset rather than its position (it calls the centered helper with no document dimensions, so the lattice collapses to one anchored at 0 and the edge snap is skipped). Either way the phase is preserved: something that started off-grid stays off-grid, just moving in grid-sized steps.

Arrow-key nudging is also **not Move-tool-only** — the same `gridSize`-or-1 step drives the five selection tools (both marquees, both lassos, Magic Wand), where it nudges the selection rather than the layer.

**Snap to Layers** attracts a dragged layer to the other layers in the document. The threshold is a hard-coded **5 document pixels** — not a screen distance and not configurable — so at 25 % zoom the pull is barely over one screen pixel wide, while at 800 % it is 40.

- **Nine pairings per axis, per other layer**: the moving layer's left / center / right against that layer's left / center / right, and the same nine vertically. The X and Y snaps are resolved independently, and on each axis the smallest correction wins.
- **It only runs on a whole-layer drag.** With an active selection the Move tool is dragging a *floating selection*, which takes the grid snap and nothing else. Arrow-key nudges never snap to layers either.
- **Groups are excluded on both sides.** A group is never a candidate (`getLayerBounds` returns `null` for it), and a group being dragged is measured as 0 × 0, so its left, center, and right edges collapse onto its origin and only that one point can snap.
- **Text layers have no vertical extent.** `TextLayer` carries no `height` field at all (see [Layer Properties](#layer-properties)), so a text layer's top, center, and bottom all collapse to its `y` — it attracts as a single horizontal line. **Point text is excluded outright**: its `width` is `null`, so with both dimensions zero it produces no bounds and never participates.
- **Layers hidden by an ancestor group still attract.** The candidate filter tests the layer's own `visible` flag rather than the `isEffectivelyVisible` helper the compositor uses, so a layer that is invisible on canvas because its parent group is hidden still pulls the drag toward edges nothing is drawn at.
- **Multi-selected siblings are excluded**, so dragging a set of layers together snaps the whole formation to outside layers and never to itself. The applied delta is computed after the snap and re-used for every sibling, keeping the group rigid.
- **The magenta lines mark the target, not the mover.** Each line (`rgba(255, 0, 220, 0.85)`, 1 screen px, spanning the document) is drawn at the *candidate* edge that was matched; ties draw one line per matched edge. They are cleared on pointer-up and whenever Snap to Layers is off, but they are **not gated on Show Guides** — they appear with guides hidden.

### Seamless Pattern Preview
- **Show Seamless Pattern** (View menu): tiles the document outside the canvas bounds so tileable textures and patterns can be previewed in context. The center tile is the actual document; surrounding tiles are repeats of the same pixels with edge wrapping (`fract(uv)`) so seams are visible immediately.
- **Dim pattern**: an options-bar checkbox (visible whenever Show Seamless Pattern is on) dims the surrounding repeat tiles so the center document stays the focal point while still showing how it tiles. Default on.
- **Wrap**: a second options-bar checkbox next to Dim pattern (also only visible while Show Seamless Pattern is on, default off). When enabled, layer compositing wraps modularly at the document edges — content dragged off one side reappears on the opposite side, so a tile can be edited across its own seam. The wrap happens in the blend shader, which shifts each layer's source offset per axis to whichever tile center is nearest the fragment; the layer texture itself is never rewritten, so repeated moves keep sampling the original pixels instead of compounding an already-wrapped result.

### Menu Bar

The strip across the very top of the window — the first thing in the app shell, above the options bar — holding **nine menus in a fixed order: File, Edit, Image, Layer, Select, Filter, Path, View, Help**, with a `LOPSY` wordmark pushed to the far right (decorative and `aria-hidden`, set in **Jersey 10**, a third self-hosted face alongside Inter, used only for this wordmark and the identical one the New Document modal parks in the same corner). It is the entry point for every command that has no tool of its own, and it owns the dialogs those commands open. For the item-by-item contents of each menu, see the feature sections they belong to; this section covers the bar itself.

- **Opening and switching**: click a title to open it, click the same title again to close it. Once *any* menu is open, hovering a different title switches to it immediately — but hovering does nothing while the bar is closed, so a stray pointer pass across the top of the window never opens anything. Choosing a command runs it and closes the bar, including any open submenu.
- **Click-outside closes on press, not release** — a `mousedown` listener on the window, attached only while a menu is open, closes the bar when the press lands outside it. The submenu flyout is positioned against the viewport but is still a DOM descendant of the bar, so clicking inside it counts as inside.
- **Dropdowns scroll rather than run off the screen**: each is capped at `calc(100vh - 40px)` with `overflow-y: auto`. The Filter menu is the one this exists for — on a short viewport it is taller than the window.
- **Checkmarks sit in a fixed 16 px gutter** reserved for any item that declares a checked state, so a run of toggles stays aligned whether or not any of them is currently on. Only two places use them: the **View** menu's seven toggles (Show Rulers, Show Grid, Show Pixel Grid, Show Guides, Snap to Grid, Snap to Layers, Show Seamless Pattern) and the **Image → Mode** submenu. Every other item renders flush with no gutter.
- **Accelerator labels are display-only.** The `⌘…` text on the right of a row is a static string baked into the menu definition — it is not read from the shortcut store, so it does not follow a rebind (see [Keyboard Shortcut Customization](#keyboard-shortcut-customization)), and it is `aria-hidden`, so screen readers never announce it. A listed accelerator is also not proof the key is wired: `⌘R` beside View → Show Rulers is the standing example of one that is not.
- **Almost nothing greys out.** Exactly four items in the entire bar carry a disabled state, and all four are gated on the same condition — an active selection: Edit → **Crop**, **Define Brush…**, and **Define Color Brush…**, plus Select → **Selection → Path**. Every other command stays enabled and no-ops internally when it cannot run, so Merge Down with a single layer or Undo with an empty history look identical to the working case.
- **Disabled items are still focusable.** They are marked with `aria-disabled` and a dim class rather than the native `disabled` attribute, so they stay in the tab order and still receive click events; the no-op is enforced by an early return in the click handler, not by the DOM.
- **The menus are rebuilt from scratch on every render**, each definition snapshotting the stores through `getState()` rather than subscribing to them. Opening a menu is itself a state change, so checkmarks and those four disabled flags are always evaluated at the moment the dropdown appears — but they are then frozen for as long as it stays open.

**Keyboard support is the gap.** The bar renders the full ARIA vocabulary — `role="menu"`, `role="menuitem"`, `aria-haspopup`, `aria-expanded` — but implements none of the matching keyboard interaction: there are no key handlers anywhere in the menu bar. Arrow keys do not move along the titles or down a dropdown, there is no typeahead, no roving tabindex, and **Escape does not close an open menu** — only a second click on the title, a click outside, or picking a command will. What does work is plain tabbing: the titles are ordinary buttons, so Tab reaches them and Enter or Space opens a dropdown, after which Tab walks its rows, disabled ones included. This is the opposite of the dock's tab strip, which does implement the full arrow / Home / End pattern (see [Tab Keyboard Navigation](#tab-keyboard-navigation)).

**Submenus are mouse-only, and one command set lives behind one.** A submenu opens on hovering its parent row and closes on leaving it; there is no click affordance and no keyboard path, and the parent row has no action of its own. **Image → Mode is the app's only submenu — and it is also the only entry point to color-mode conversion**, since the Indexed dialog is opened from inside it and no mode carries a keyboard shortcut. Switching a document between RGB, Grayscale, Indexed, CMYK, and Lab therefore cannot be done without a pointing device (see [Color Modes](#color-modes)). Only one level of nesting is rendered, so a submenu row's own submenu would be ignored. The flyout's viewport-relative positioning is described under [Global UI Conventions](#global-ui-conventions).

**The dialogs the bar owns.** Ten in all, mounted beside the menus and opened by menu commands: the shared [Filter Dialog](#filter-dialog-shared), Pattern Fill, Color LUT, Canvas Size, Image Size, Indexed Color, Keyboard Shortcuts, About, the [Export dialog](#export-dialog-e), and a second instance of the shared filter dialog driving Select → Grow / Shrink / Feather. Opening any of them closes the menu first. Export is reached through a module-level register/unregister callback rather than a direct import — the File menu defines the command while the bar owns the dialog state, and importing either direction would be circular.

- **Grow / Shrink / Feather** each open that shared dialog with a single slider: **Amount 1 – 100 px** for Grow and Shrink, **Radius 1 – 250 px** for Feather, default 1 in both cases. Grow and shrink are CPU mask operations; **feather is the only one that goes to the GPU** — the mask is uploaded, feathered, and read back — and it silently leaves the selection untouched if the engine is not up. Whichever runs, the selection's transform box is rebuilt from the resulting bounds afterwards, and if shrinking erased the selection entirely it is cleared outright rather than left as an empty marquee.

### Toolbox

The vertical rail down the far left of the editor body, outside the dock host, at a fixed width with its own vertical scroll when the buttons don't fit. It is the only surface that can reach every tool, and the only way to reach the four that carry no keyboard shortcut.

- **All 23 registered tools get a button** — there are no flyouts, stacks, or long-press groups, so every tool is always visible rather than hidden behind a sibling. The buttons are laid out in **seven divider-separated groups**, plus an eighth holding the Quick Mask toggle:

  1. Move
  2. Rectangular Marquee · Elliptical Marquee · Lasso · Magnetic Lasso · Magic Wand · Quick Selection
  3. Brush · Pencil · Spray · Eraser
  4. Fill · Gradient · Clone Stamp · Healing Brush
  5. Dodge/Burn · Sponge · Smudge · Eyedropper
  6. Shape · Text · Pen Tool
  7. Crop
  8. Quick Mask toggle — not a tool but a mode; see [Quick Mask Mode](#quick-mask-mode)

  The grouping is by role rather than by the registry's own order, and it is maintained by hand in the toolbox rather than derived from the tool registry.
- **Active tool** is highlighted; clicking a button selects that tool directly (it does not route through the shortcut system).
- **Every button is a real `<button>`** carrying the same string as both `aria-label` and native `title`, so hovering gives a tooltip and each button is its own tab stop. The rail declares `role="toolbar"` but ships **no arrow-key handler or roving tabindex**, so it does not implement the ARIA toolbar keyboard pattern — reaching the last tool means tabbing through everything before it.
- **The shortcut letters in those labels are hard-coded literals** (`Brush (B)`, `Eraser (E)`, …), not reads of the shortcut store. Rebinding a tool in the Keyboard Shortcuts modal changes what the key does but **not what the toolbox tooltip claims** — rebind Brush to `K` and its button still advertises `(B)`. The four tools with no default key (Gradient, Elliptical Marquee, Magnetic Lasso, Quick Selection) correctly show a bare label.
  - **Except one: the Quick Selection button advertises `(Q)`, and that is wrong.** Quick Selection has no `shortcut` in the registry and is not a customizable action, while `Q` is bound to *toggle Quick Mask* — which is the button sitting in the very next group of the same rail, labelled `Enter Quick Mask (Q)`. Two buttons in one toolbar claim the same key; pressing `Q` always toggles Quick Mask and never selects Quick Selection.
- **No foreground / background swatches.** The toolbox stylesheet still carries `.colors` / `.colorStack` / `.foreground` / `.background` rules from an earlier layout, but nothing renders them — color editing lives in the [Color panel](#color-panel) alone.

### Options Bar

The 32 px horizontal strip directly under the menu bar, sharing the app header with it and sitting above the toolbox and canvas. It is present for every tool once a document is open — there is no "no tool selected" state (the editor boots with Move active) and no toggle that hides it, though the pre-document start screen and the WebGL2 warning are separate shells that have no options bar at all. Three zones, left to right: the tool's name, that tool's own controls, and a trailing group of document-wide toggles that has nothing to do with the tool.

- **The name is the registry `label`**, so the bar reads `Paint Bucket`, `Pen Tool`, and `Dodge/Burn` where the toolbox and this document often use the shorter names. The bar declares `role="toolbar"` with an `aria-label` rebuilt per tool (`Brush options`, `Crop options`), and — exactly like the [toolbox](#toolbox) rail — ships **no arrow-key handler or roving tabindex**, so the ARIA toolbar keyboard pattern is not implemented and each control is an ordinary tab stop.
- **Which controls appear is a single registry lookup**, `toolRegistry[activeTool].optionsComponent`. 21 of the 23 tools name one (20 distinct components — the two marquees share one), and all of them are **statically imported** rather than lazy-loaded. The active set is swapped wholesale on tool change, so local state inside it — an open fill/stroke color popover, for instance — is discarded on the way out and does not reopen on the way back.
- **Two tools have no options component at all**: **Eyedropper** and **Lasso**. The name and its separator still render, followed by empty space. For the Lasso that matches the tool, which has no parameters; for the [Eyedropper](#eyedropper) it is a gap, since the sampling logic implements 3×3 and 5×5 area modes with no control anywhere to reach them.
- **Only the control area scrolls.** It takes the leftover width with `overflow-x: auto`, while the tool name (80 px floor) and the trailing group never shrink — so a control set too wide for the window scrolls horizontally within its own zone instead of pushing the name or the trailing toggles off the ends.

**The trailing group is not tool-scoped.** It renders at the right of the bar for *every* tool, gated only on the matching view modes:

- **Grid size** — appears whenever View → Show Grid is on, and this is the **only place in the app that can change the grid size**. There is no menu item and no preference for it, so the grid has to be visible to be resized.
  - The slider is an **index into a computed list of stops**, not a pixel value. The stops are the powers of two from 2 to 1024, kept when a stop is at most **half the document's longest side** and at least **`floor(longest side ÷ 500)`** — so both the available spacings and the slider's travel change with the document. A 1000 px document offers `2, 4, 8, 16, 32, 64, 128, 256`; by 1500 px the 2 px stop is gone; at 4000 px the list is `8 … 1024`; at the 16384 px maximum only `32 … 1024` survive; and below 4 px the list would be empty, so it falls back to a single 1 px stop.
  - **The readout can disagree with the needle.** The grid size is never re-clamped — it defaults to 16 px and nothing re-derives it when the document changes — so whenever 16 is not a stop (any document whose longest side is under 32 px, and also the 16384 px maximum) the label still reads `16px` and the grid still draws at 16 px, while the needle rests on the nearest stop instead. Touching the slider is what reconciles the two, by snapping the value onto that stop.
- **Snap** — a checkbox mirroring View → Snap to Grid, shown under the same Show Grid condition. Turning the grid **on** force-enables snapping; turning it off leaves the flag exactly as it was. All seven places that consult it — move drags, arrow-key nudges, marquee drags, and the three transform paths — require **both** flags, so **View → Snap to Grid can sit checked while doing nothing at all**, which is the state you land in by enabling the grid and then hiding it again.
- **Dim pattern** and **Wrap** — the two [seamless-pattern](#seamless-pattern-preview) checkboxes, shown whenever Show Seamless Pattern is on. A divider separates them from the grid controls only when both groups are present.

**Settings the bar shares between tools.** Two controls read as per-tool but are backed by single global values, so setting one wherever it is convenient changes it everywhere else it appears:

- **Aspect ratio** (the `W : H` inputs plus the lock toggle) is one setting stored at the top level of the tool-settings store rather than in any per-tool slice, and **four** tools mount it: the [Rectangular Marquee](#rectangular-marquee), the [Elliptical Marquee](#elliptical-marquee), the [Shape tool](#shape-tool), and [Crop](#crop). Lock 16:9 to crop a photograph, switch to the Shape tool, and rectangles come out 16:9 as well. The two inputs advertise `min="1"` but the store only floors them at **0.01**.
- **Feather** is one `marquee.feather` value shared by the [Rectangular Marquee](#rectangular-marquee), the [Elliptical Marquee](#elliptical-marquee), and the [Magic Wand](#magic-wand). The two marquees mount the *same* options component, so they cannot hold different feather radii from one another.

### Status Bar

A `role="status"` footer across the bottom of the window. Left group: the zoom percentage, the cursor's document X/Y, and the document's pixel dimensions. Right group, pushed over by a flexible spacer: memory, color mode, and color space.

- **The zoom readout is the bar's only interactive element**, and it carries two distinct pointer gestures.
  - **Double-click resets to 100% *and recenters*** — it sets zoom to 1× and pan back to 0,0, so a canvas that had been scrolled away returns to the middle rather than merely changing scale.
  - **Click-drag scrubs the zoom horizontally**, roughly 1% per pixel of travel, clamped to **10%–400%**. That is far tighter than the viewport's own 1%–6400% range, so the scrub cannot reach the zoom levels the keyboard and menu commands can. A **2 px dead zone** must be crossed before the drag counts as a scrub, which is what stops a plain click from nudging the zoom and lets the double-click through. The move and up listeners are global, and they are torn down on pointer-up, pointer-cancel, window blur, tab-hide, and unmount — so alt-tabbing mid-drag cannot leave the readout stuck following the mouse.
  - It is marked `role="button"` with `tabIndex={0}` but has **no key handler**, so it takes focus and is announced as a button while Enter and Space do nothing. Both gestures are pointer-only.
- **Memory** is the WASM heap plus the JS heap, refreshed on a **2 s interval** and rounded to whole MB. `performance.memory` is Chrome-only, so on Firefox and Safari the JS half reads 0 and the figure is the WASM heap alone. The readout is omitted entirely when the total comes back 0.
- **Color mode** appears only when the document is not RGB (see [Color Modes](#color-modes)); RGB documents leave that slot empty.
- **Color space** reads `Display P3` or `sRGB`, resolved **once at module load** by writing a P3 red into a 1×1 canvas and reading it back. It is a session-wide constant — dragging the window to a different display does not update it.

### UI
- **Foreground / background color**: live in the [Color panel](#color-panel) only — not in the toolbox. Swap has an icon button (and `X`); reset to black/white is keyboard-only (`D`), with no button anywhere.
- **Recent colors**: capped at 28, and seeded full with a 28-swatch starter palette — see [Recent colors](#recent-colors)
- **Panel visibility**: togglable per panel from the panel toolbar — see [Panel Docking & Layout](#panel-docking--layout). There is no separate sidebar-collapse toggle, and individual panels no longer collapse to a header; they are sized by their dock, split, or floating window instead.
- **Mask edit mode**: on/off
- **Draggable modals & drawers**: filter dialogs, pattern fill, layer effects, adjustments, the Brushes modal, and the reference image drawer can be repositioned by dragging the header bar (cursor: grab on hover; content interactions are not hijacked). Dockable panels use the docking system's own drag instead. The effects and reference drawers both sit immediately to the left of the right dock and shift as that dock is resized; vertically they differ — the **reference drawer stays pinned to the top** of the sidebar area, while the **effects drawer tracks the top edge of the Layers panel's dock group** (see [The Effects Drawer](#the-effects-drawer)).
- **Filter / pattern preview overlay**: when live preview is enabled the dim backdrop is removed and pointer-events on the overlay are disabled so the canvas is fully visible while the modal stays interactive

### Global UI Conventions
- **Slider double-click → reset**: every numeric slider in the UI (brush size, opacity, hardness, adjustment sliders, filter sliders, etc.) snaps back to its default value on double-click. The numeric text input inside the slider is exempt so double-clicks there select the value for editing instead.
- **Slider arrow-key step**: with a slider's numeric input focused, **↑ / ↓** increment / decrement the value by one step (log-scaled sliders like Levels gamma step proportionally), clamped to the slider's min / max. Enter blurs the input to commit.
- **Status-bar zoom double-click → 100%**: double-clicking the zoom percentage readout in the [status bar](#status-bar) resets the viewport zoom to 100% (1×) **and recenters the canvas** (pan back to 0,0). Dragging that same readout horizontally scrubs the zoom instead — see [Status Bar](#status-bar).
- **Canvas cursor by tool**: exactly **seven** tools hide the system cursor and draw a size ring on the overlay instead — brush, pencil, eraser, clone stamp, healing brush, dodge/burn, and sponge. The ring is a circle for all of them **except the pencil, which draws a square** to match its hard-edged square dab. **Only the Brush's ring reflects the tip**: the custom tip bitmap and the Angle rotation are passed through for `brush` and hard-coded to none/0° for the other six, so a rotated star tip still shows a plain circle under, say, the eraser. Clone stamp and healing brush replace the ring with the live source preview once a source is set. Every remaining tool gets a standard cursor — move and text have their own, and everything else (including **Spray**) falls through to a crosshair. Liquify draws its own ring from the Liquify brush size while its modal is open.
- **Color swatch selection**: clicking the foreground or background swatch in the Color panel makes it the one the picker, hex field, and RGBA sliders edit; clicking a recent-color swatch applies that color to whichever swatch is currently active. (The old double-click-to-expand behavior went away with panel collapsing.)
- **Layer name double-click → rename**: double-clicking a layer row's name turns it into an inline text input; Enter commits, Escape cancels.
- **Escape-to-close is per-dialog, not global.** There is no app-wide "Escape dismisses the front-most dialog" rule, and the app's modals fall into three groups. **Closes from anywhere**: New Document, Shape Size, and the group-adjustments info dialog, whose Escape is centralized on `document` by the modal host; the [Tilt-Shift](#blur) session, which binds Enter / Escape on `window`; and [Stroke Path](#paths-panel), which gets there by a different route — it selects its Width field on open, so focus is already inside. **Closes only once focus is inside**: the [filter dialogs](#filter-dialog-shared), Color LUT, [Export](#export-dialog-e), [Gradient](#gradient), Indexed Color, Pattern Fill, and both [Canvas Size and Image Size](#the-two-dialogs) — each binds Escape as an `onKeyDown` on a `<div>` that carries no `tabIndex` and autofocuses nothing, so the key is only seen when it bubbles up from a control the user has clicked or tabbed to. Open one from the menu and press Escape without touching anything and nothing happens. **Does not respond to Escape at all**: the [Brushes modal](#brush) (✕ only — it has no backdrop), its brush-export sub-dialog (✕ or backdrop), About and [Keyboard Shortcuts](#keyboard-shortcut-customization) (Close button or backdrop), and the [Liquify](#distort) panel (Apply / Cancel only — it renders no overlay). In every case where the dialog does not consume the key, Escape reaches the canvas instead and clears the active selection and any pending transform.
- **Menu submenus**: a menu item can carry a nested submenu, marked with a `›` arrow and opened by **hovering** the parent row (Image → Mode is the only one today). The flyout is positioned against the viewport rather than nested inside the dropdown — long menus like Filter set `overflow-y: auto`, which per CSS Overflow 3 forces the horizontal axis to `auto` too and would otherwise clip a `left: 100%` child at the padding box.

### Notifications & Error Toasts
Transient messages surface as toasts stacked in a fixed panel at the **top-right** of the window (max width 360px, newest appended at the bottom). The stack is announced to assistive tech via `role="status"` / `aria-live="polite"`.

- **Two levels**: `error` (red left border) and `info` (accent-colored left border). No title, no icon — just the message and a dismiss control.
- **Manual dismiss only**: toasts do **not** auto-expire on a timer; each stays until the user clicks its **×** button. Multiple messages accumulate in the stack rather than replacing one another.
- **Error triggers** (all routed through `notifyError`): failures to open a file, open/load or save a project, import a PSD / DNG / RAF, paste an image, or export (Quick Export PNG, Export…, or Export PSD); plus lower-level guards such as "Engine not ready", "No active layer", an empty decode result, and WebGL context init / restore failures. Messages that wrap an exception append a human-readable cause.
- **Info trigger**: importing a PSD whose unsupported layer types were rasterized posts an info toast noting the pixels are preserved but no longer editable as their original type.

### Canvas Right-Click Context Menu
Right-clicking the canvas opens a small menu with:
- **Define Brush Preset** — only shown when a marquee selection is active. Captures the selected pixels of the active layer as a new brush tip and opens the Brushes modal with the new preset selected. This is a **separate implementation** from Edit → Define Brush…, not a shared one: it names the tip "Custom Brush" without prompting and opens the modal, where the Edit-menu version prompts for a name and leaves the modal closed.
- **Deselect** — clears the active marquee selection (disabled when there is none).
- **Select All** — selects every pixel in the document (equivalent to ⌘A).

The menu is suppressed on coarse-pointer devices (touch) so long-press doesn't accidentally open it.

### Single-Key Shortcuts
Nineteen tools carry a default single-letter shortcut, and that is the complete set — every tool in the registry with a `shortcut` field: `V` move, `B` brush, `N` pencil, `E` eraser, `G` fill, `I` eyedropper, `S` clone stamp, `H` healing brush, `O` dodge & burn, `Y` sponge, `R` smudge, `M` rectangular marquee, `L` lasso, `W` magic wand, `U` shape, `T` text, `C` crop, `P` path, `J` spray. (Four of the 23 registered tools carry no letter and can only be reached from the [toolbox](#toolbox): **Gradient**, **Elliptical Marquee**, **Magnetic Lasso**, and **Quick Selection** — note that the toolbox nevertheless labels Quick Selection `(Q)`, a key that belongs to Quick Mask.) On top of those, the editor ships these global keys:

- **`X`** — swap foreground and background colors
- **`D`** — reset foreground/background to the defaults (black / white)
- **`Q`** — toggle Quick Mask mode
- **`[` / `]`** — decrement / increment the active tool's size by 1. The handler is an explicit tool list, **not** a lookup of "whichever size slider the tool exposes": brush **and dodge & burn** (both write the shared `brush.size`), smudge, pencil, eraser, clone stamp, healing brush, pen-tool stroke width, and shape-tool stroke width. **Three tools ship a Size slider that the brackets ignore** — Sponge, Spray, and Quick Selection; their size is slider-only.
  - **The brackets are not bound by the slider's ceiling.** They write straight through the store clamp — **1 – 5000 px** for every pixel-size setting (1 – 50 for the pen/shape stroke widths) — without consulting the options bar's document-scaled maximum. On a small document, where the Brush Size slider stops at 200, holding `]` walks the size well past the visible end of the slider, all the way to 5000.
  - The handler reports the key as handled for *every* tool, so `[` / `]` are swallowed even when the active tool has no size to change.
- **`Shift`** (held, paint tool, after a stroke on the active layer) — previews the straight-line stroke as a hairline from the last stroke endpoint to the cursor; shift+click commits it. Adding **Cmd/Meta** snaps to 15° and turns the preview blue. See Straight-Line Strokes.
- **`Space+drag`** / **middle-click drag** — temporary pan from any tool
- **`Cmd/Ctrl+scroll`** — zoom in / out (anchored to the viewport center, not the cursor); plain scroll pans. **Two-finger pinch** on touch devices zooms and pans together.
- **`Backspace` / `Delete`** (canvas focused) — when a marquee selection is active, clears the selected pixels on the active layer (GPU clear, undoable as "Clear Selection"); when no selection is active, removes the active layer from the document. Suppressed while a text input or text-layer edit is focused.
- **`Escape`** — cancels in-progress state: clears unstroked Path-tool anchors first, otherwise clears the active selection and any pending transform; ends text editing with the prior layer state restored.
- **`Enter`** — when the Path tool is active and ≥ 2 anchors are placed, strokes the in-progress path to pixels.
- **`Cmd/Ctrl + E`** — merge the active layer down into the layer below.

**Menu accelerator labels that are *display-only* (not wired to global key handling).** Several menu items render a keyboard accelerator next to their label, but — like the `⌘R` ruler accelerator noted under Rulers — the key combo is **not** bound; the action only fires when the menu item itself is clicked. These are: **New** (`⌘N`), **Open…** (`⌘O`), **Save Project** (`⌘S`), **Export…** (`⌥⇧⌘E`), **Quick Export PNG** (`⇧⌘E`), **New Layer** (`⇧⌘N`), **Duplicate Layer** (`⌘J`), **Group Layers** (`⌘G`), and **Fill** (`⇧F5`). Among the layer/file menu accelerators, only **Merge Down** (`⌘E`) is actually bound to a global key handler.

### Help Menu
- **Keyboard Shortcuts**: opens the Keyboard Shortcuts modal (see below) — this menu item is its entry point.
- **About Lopsy**: opens the About dialog.

### Keyboard Shortcut Customization
Single-key bindings are rebindable through the **Keyboard Shortcuts modal** (Help → Keyboard Shortcuts). The modal is **not** a projection of anything — it is a hand-written list of **32 rows in five sections** (Tools 15, Edit 7, View 5, Colors 2, Canvas 3), and only **17** of them are editable (the 15 Tools rows and the 2 Colors rows): rows carrying an action id render as a clickable key button, while the modifier-combo rows (`⌘Z`, `⌘C`, `⌘0`, `Esc`, `Enter`, `Space`, …) are fixed labels with no rebind affordance. Being hand-written, the list is incomplete on *both* sides — see below.

- Each editable row shows the action label and its current key. Clicking the key enters **listening mode** — the next key pressed becomes the new binding, lower-cased. Escape cancels; modifier-only presses are ignored, as is any key pressed with Cmd / Ctrl / Alt held (those combos aren't customizable).
- **Reset**: a per-row reset button (`↺`, shown only on rows that have actually been overridden) reverts that one binding to its default; a "Reset All" button in the header clears every override at once.
- **Persistence**: custom bindings live in `localStorage` (Zustand `persist` middleware), so they survive reloads and follow the user across sessions on the same browser.
- **A rebind takes effect immediately, with no reload** — the global single-key handler rebuilds its key → action map from the live store on every keystroke rather than caching one at startup.
- **But the store is not what the rest of the UI displays.** `getKey(actionId)` has exactly two callers, both inside the modal itself (the conflict check and the row rendering). Nothing else in the app consults it:
  - **Menu accelerators are hard-coded strings** in the menu definitions (`⌘Z`, `⇧⌘C`, …) and never read the store. In practice this costs nothing, since every menu accelerator is a modifier combo and modifier combos aren't customizable in the first place.
  - **Toolbox tooltips are hard-coded too**, and those *are* single-key bindings — so the rail keeps advertising a tool's default letter after the user has rebound it. See [Toolbox](#toolbox).

**The modal binds no keys of its own except while a row is armed** — which makes the one dialog about keyboard shortcuts the one where the keyboard still drives the canvas underneath. Its `keydown` listener is installed *only* for as long as a row is listening; the rest of the time the modal has no key handling at all, and the global handler's only guard is whether the event target is an `<input>` or `<textarea>`. A modal full of buttons passes that guard, so with the dialog open and no row armed:

- **`Escape` does not close it.** It falls through to the canvas, where it clears the active selection and cancels any pending transform. The modal closes only via its **Close** button or a click on the backdrop.
- **Every single-key shortcut still fires.** Pressing `B` switches the active tool behind the dialog, `X` / `D` change the colors, `[` / `]` resize the current tool, and `Backspace` / `Delete` clears the selected pixels or removes the active layer outright — all while the shortcut list is on screen.
- Arming a row plugs the gap for exactly one keystroke: the listening handler is registered on `window` in the **capture** phase and calls `preventDefault` + `stopPropagation`, so the key being captured is consumed instead of reaching the canvas.
- The conflict banner is cleared when another row is armed, not when the rebind lands — so it stays on screen after the binding it describes has already been written.
- Clicking an armed key button a second time cancels listening, the same as Escape. **Reset All** takes effect immediately, with no confirmation step.

**What the modal does *not* cover.** The rebindable rows are a hard-coded list inside the modal, not a projection of the tool registry, so it has drifted out of step with the tools that actually ship a shortcut.

The drift is not for want of a derived list — the codebase ships **three** registry-derived answers to "which key belongs to which action", and the modal uses none of them. `SHORTCUT_TO_TOOL` (tool registry) is a key → tool map whose only references outside its own module are a unit test asserting its contents and a mock standing in for it, so **nothing in the app reads it**. `getAllActionIds()` (shortcut store) returns exactly the list the modal is missing — every tool with a shortcut, plus the three non-tool actions — and has **no importer at all, not even a test**. Only `buildKeyToActionMap()` is live, and it is called by the key dispatcher, never by the UI. The modal instead walks its own `getAllCustomizableActionIds()` over the hard-coded 32 rows, which is why every gap below exists and why adding a tool to the registry does not add a row here:

- **Four tools have a working default key but no row in the modal** — Healing Brush (`H`), Sponge (`Y`), Smudge (`R`), and Spray (`J`). Their keys work on the canvas; they simply cannot be rebound or even seen here.
- **`Q` (toggle Quick Mask) has no row either.** It is a first-class customizable action in the store — it sits alongside swap-colors and reset-colors in `NON_TOOL_ACTION_IDS` — but the modal's Colors section lists only Swap Colors and Reset Colors, so there is no UI to rebind it.
- Because conflict detection walks the modal's *own* row list, these five actions are also **invisible to the conflict check** (see below): rebinding some other tool onto `H`, `Y`, `R`, `J`, or `Q` reports no conflict at all.

**The fixed rows are an incomplete inventory too.** Every combo the modal lists is genuinely bound, but **nine bound combos have no row anywhere in it**:

| Combo | Action | Still reachable from |
|-------|--------|----------------------|
| `⌘A` | Select All | Select menu |
| `⇧⌘I` | Invert Selection | Select menu |
| `⇧⌘C` | Copy Merged | Edit menu |
| `⌘'` | Show / Hide Grid | View menu |
| `⌘;` | Show / Hide Guides | View menu |
| `⌘⇧X` | Liquify | Filter menu |
| `⇧⌘L` | Auto Tone | Image menu |
| `⌥⇧⌘L` | Auto Contrast | Image menu |
| `⇧⌘B` | Auto Color | Image menu |

There is no **Select** section in the modal at all, so the two selection commands have nowhere to sit; the grid and guide toggles are simply missing from the View section that does exist. All nine remain labelled in the menu bar, so the cost is discoverability rather than function — but the modal cannot be read as the app's shortcut reference. It is the mirror image of the *display-only accelerator* problem under [Single-Key Shortcuts](#single-key-shortcuts): the menu bar advertises combos that are **not** wired, while the modal omits these nine that **are**.

**Conflict detection warns, but does not prevent — and the modal keeps displaying the losing key.** When the pressed key already belongs to another *listed* action, the modal shows a banner naming it (`"E" is already used by Eraser`). That banner is purely informational: the rebind is written to the store unconditionally on the same keystroke, with no confirm step and no way to back out other than rebinding again or hitting reset. The runtime key map then resolves the collision by **dropping the other action's binding entirely** — the loser is left with no key at all. It also releases the key the *rebound* action used to own, so a single rebind puts **two** keys out of action: the loser keeps none, and the winner's old letter now does nothing. Rebind Brush onto `E` and pressing `B` afterwards selects nothing at all.

The modal, however, reads each row's key through `getKey(actionId)`, which falls back to the *default* whenever a row has no override of its own — so the displaced action still displays its original letter. Rebind Brush onto `E` and the Eraser row goes on showing **E** while pressing `E` selects the Brush.

**And once a key has been displaced, the conflict banner starts naming the wrong action.** `findConflict` scans the modal's own rows *in display order* and reports the first whose `getKey` matches — but `getKey` answers with the default for any row that has no override, including a row that has just lost its key. So both the winner and the loser claim the same letter, and whichever sits higher in the list wins the report. Rebind **Eraser** onto `B`, then try to bind Pencil to `B` as well: the banner reads `"B" is already used by Brush`, because Brush precedes Eraser in the Tools section — while the action that actually owns `B` at runtime is the Eraser. The authoritative resolver (`buildKeyToActionMap`, the same function the dispatcher uses) is never consulted by the modal.

**Bindings are not restricted to single characters.** Nothing in the modal or the store checks the length of `e.key`, so a non-printing key is accepted verbatim and stored lower-cased: pressing `F1` binds the string `f1`, pressing an arrow key binds `arrowup`. These do resolve at runtime (the tool-shortcut handler looks up `e.key.toLowerCase()` the same way), and the handler runs **before** the arrow-key nudge handler — so binding a tool to an arrow key genuinely takes that arrow away from nudging. The key button renders the raw string upper-cased, giving labels like `ARROWUP`.

- **Tool shortcuts fire with Shift held.** The single-key dispatcher excludes Cmd, Ctrl, and Alt but not Shift, and it lower-cases the key first — so `⇧B` selects the Brush exactly as `B` does. This overlaps the Shift-held straight-line preview: typing a tool letter while holding Shift for a line switches tools.

---

## Reference Image Drawer

A floating, draggable, resizable drawer (toggled by the **Reference** button on the panel toolbar) for keeping reference images alongside the canvas. It is *not* part of the docking system — it floats over the workspace, parked against the left edge of the right dock and tracking that dock's width as the dock is resized. Default size **300 × 300**, minimum **200 × 200**. Below a **600 px** viewport width the whole sidebar area is hidden, so the drawer is unavailable on narrow screens.

**Loading images**
- **Empty state**: a dashed drop zone reading "Drop an image here or click to browse". Click it to open the file picker, or drag image files onto it.
- The file picker accepts `image/*` and is **multi-select** — every chosen file is appended in order and the last one becomes the active reference.
- Non-image files are filtered out and any file the browser can't decode is skipped **silently** (no toast, no placeholder row).
- Once at least one image is loaded, the **+** tile at the end of the thumbnail strip is the way to add more.
- **Known gap — drag-and-drop only works in the empty state.** The drop handlers live on the drop zone, and the drop zone is replaced by the viewer as soon as an image loads. Dropping a file on a loaded drawer therefore bubbles to the app-level drop handler and **opens that file as a document / import** (PSD, DNG, `.lopsy`, or a plain image) instead of adding a reference.

**Viewing**
- **Auto-fit on load**: each newly added image is scaled with `min(containerW / w, containerH / h, 1)` and centered — it fits the drawer, but is never *upscaled* past 100 %. Switching to an image that has no stored view state fits it the same way.
- **Zoom**: mouse wheel, **1.07× per notch**, anchored on the cursor so the point under the pointer stays put, clamped to **0.05× – 20×**. The wheel event is stopped at the drawer, so scrolling over a reference never zooms the canvas underneath.
- **Pan**: click and drag anywhere in the preview (cursor turns from grab to grabbing). Pointer-downs that land on a button, input, or slider are ignored so controls still work.
- **Opacity**: a **number field (0 – 100)**, not a slider; typed values are clamped to that range.
- **Flip horizontal / vertical**: mirrors via a negative scale plus a compensating translate, so the image flips **in place** rather than sliding out of view.
- **Per-image view state**: zoom, pan, opacity, and both flips are tracked independently per image (keyed by image id), so switching references restores each one's framing.
- **Thumbnail strip**: 40 × 40 cover-cropped tiles, active tile outlined in the accent color, strip scrolls horizontally. Click a tile to switch. The **trash** button removes the *active* image (revoking its blob URL) and clamps the selection to the nearest remaining image; removing the last one returns the drawer to the drop zone.
- **Known gap**: thumbnails are click-only `<img>` elements with no `tabIndex` and no key handler, so the strip can't be reached or operated from the keyboard.

**Window chrome**
- **Drag to reposition**: the drag handler is on the whole drawer, but the preview, controls bar, thumbnail strip, and drop zone all stop the event, and inputs/buttons/labels are excluded — so in practice the **header bar** (and the thin border gutter) is what you grab.
- The drag is **unclamped**: unlike floating dock panels, nothing pulls the drawer back if you drag it off-screen.
- **Bottom-right resize handle** sets the drawer's width/height directly on the element (minimum 200 px each).
- **Closing discards everything.** The drawer is conditionally mounted, so toggling it off unmounts the panel: loaded images, their view states, the dragged position, and the resized dimensions are all gone on reopen, and the blob URLs of any images that weren't explicitly removed are never revoked.
- Images are pure client-side blob URLs — no upload, no backend.

---

## Panel Docking & Layout

Eight panels — **Navigator, Info, Color, Layers, Channels, History, Paths, Text** — live in a docking system rather than a fixed sidebar. Each is a tab that can be docked to any workspace edge, split alongside another panel, grouped into tabs, or floated as its own window. (The Reference Image drawer, layer-effects drawer, and Adjustments panel are *not* part of this system — they remain free-floating drawers.)

### Panel Toolbar
- A vertical rail on the far right with one icon per dockable panel, plus a **Reference** button for the reference-image drawer. An icon is highlighted while its panel is somewhere in the layout.
- Clicking an icon does one of three things depending on the panel's current state: **absent** → add it at its default spot; **present but not the active tab of its group** → bring that tab forward; **present and already active** → close it.
- Closing a panel is toolbar-only — tabs have no close (`×`) button.
- Panels re-added from the toolbar land in the **right dock**, inserted so the vertical order stays canonical (Navigator, Info, Color, Text, Channels, History, Paths, then Layers at the bottom, mirroring the pre-dock sidebar).

### Default Layout
- A **Color/Info** tab group above a **Layers/Channels** tab group in the right dock (50 / 50 split), with **Color** and **Layers** as the active tabs; the other four panels (Navigator, History, Paths, Text) start closed.
- Default dock thickness: left 280 px, right 312 px, top 220 px, bottom 220 px.
- On a **coarse-pointer device** (touch), a first run starts with *no* panels open so the canvas gets the whole screen.

### Dragging & Drop Targets
Dragging starts on a tab (or a floating window's tab bar) after **5 px** of pointer movement; a ghost chip follows the cursor and a translucent indicator previews exactly where the panel will land.

- **Workspace edge** — release within **28 px** of the host's left/right/top/bottom edge to dock there. The panel is appended to that dock's stack: left/right docks stack vertically, top/bottom docks stack horizontally.
- **Upper portion of an existing panel** — release over the top two-thirds of a group (where its tab bar sits, by convention) to join it as a **tab**. Groups hold at most **3 tabs**; dropping on a full group falls through to a side split instead.
- **Bottom third of an existing panel** — release over the bottom third to drop the panel as a new group **below** the target in the stack (reordering) rather than combining.
- **Open space** — release a *tab* anywhere else to **float** it in a new window, sized from the group it came from (capped at 420 × 480). A whole floating window released over open space simply stays where it was dragged.
- **Escape** during a drag cancels it; a dragged floating window snaps back to where it started.
- Self-drops are no-ops: dropping a tab back on its own group just activates it, and a lone tab can't split its own group.
- Dragging a floating window whose group is a single tab moves the **whole window**; with 2–3 tabs, dragging a tab extracts just that panel and dragging the empty part of the tab bar moves the window.

### Tab Keyboard Navigation
Tab strips follow the WAI-ARIA tabs pattern, so a group's tabs are reachable without a pointer:

- **Left/Up** and **Right/Down** move to the previous/next tab and wrap around at either end; **Home** / **End** jump to the first / last tab.
- Selection *follows focus* — arrowing onto a tab activates its panel immediately, no Enter or Space needed.
- Roving tabindex: only the active tab is in the Tab order, so a single <kbd>Tab</kbd> press enters the strip and the next one leaves it for the panel body.
- Each tab is wired to its panel with `aria-controls` / `role="tabpanel"` so screen readers announce the pairing.

### Floating Windows
- Dragged by the tab bar, resized from **all eight** edges and corners (minimum 200 × 140).
- Clicking anywhere in a window raises it above the others.
- A floating window dropped onto a docked target docks all of its tabs at once; dropped onto another floating window it merges as tabs (still subject to the 3-tab cap).
- If the browser window shrinks, stray floating panels are pulled back inside the workspace automatically.

### Resizing
- **Dock splitters** sit between each dock and the canvas: drag to set that dock's thickness, clamped to **160 – 800 px**.
- **Split dividers** inside a dock redistribute space between panes (each pane keeps at least ~90 px).
- The canvas fills whatever space the docks leave.

### Persistence
- The full layout — dock trees, tab groups, active tabs, split fractions, dock sizes, and floating window rects — is written to `localStorage` under `dock:layout:v1`, and flushed synchronously on `beforeunload`.
- **The ~400 ms delay is a trailing throttle, not a debounce.** `schedulePersist` starts a timer on the first change and then *refuses to restart it* — later changes only swap the pending payload — so a continuous drag (a splitter, a floating window) writes the latest layout every 400 ms for as long as it lasts, rather than once when the pointer comes up. A debounce would coalesce the whole gesture into one write. Either way the final state always lands, at most 400 ms after the last change.
- Persisted layouts are re-validated on load: unknown panel ids, duplicated panels, out-of-range sizes, and malformed nodes are dropped or clamped, and a layout that can't be repaired falls back to the default. If `localStorage` is unavailable the app still works — the layout just doesn't survive a reload.
- **Known gap**: the store exposes a `resetLayout` action that restores the default arrangement, but nothing in the UI calls it yet — there is currently no "Reset Panel Layout" menu item or button.

---

## Paths Panel

A flat list of the document's stored vector paths plus a three-button toolbar. It is a *consumer* of paths — nothing in the panel creates one.

**Where stored paths come from**
- The **Path / Pen tool**, when an in-progress anchor list is committed.
- The **Shape tool with Output = path**: finishing the drag rasterizes nothing — the raster preview drawn during the drag is rolled back with an `undo()` and a closed path is added instead. Ellipses become 4-anchor Bezier ellipses; every other mode (including a 4-sided "rectangle") becomes a straight-sided polygon, so **corner radius is not carried into path output**. A drag smaller than 1 px in both axes is discarded.
- **Select → Selection to Path**.
- **Boolean path operations** (Unite / Subtract / Intersect / Exclude), which consume both source paths and add the result.

Every new path is auto-named `Path 1`, `Path 2`, … from a counter that **never resets** — it keeps climbing for the life of the page, so opening a second document continues the numbering rather than restarting at 1.

**The list**
- Click a row to select it; **clicking the selected row again deselects it**, which disables all three toolbar buttons.
- Empty state reads "No paths".
- **Known gap — rows are keyboard-focusable but not keyboard-operable.** Each row is a `role="option"` with `tabIndex={0}` and no key handler, so Tab reaches a path but Enter / Space can't select it. (Same pattern as the Brushes modal tab rail, the color picker sliders, the layer-row drag grip, and the layer-effects list.)
- **Known gap**: the store exposes `renamePath`, but nothing in the UI calls it — there is no rename affordance (no double-click, no context menu), so path names are whatever the counter assigned.

**Toolbar** (all three disabled until a path is selected)
- **Stroke Path** opens the **Stroke Path modal** rather than stroking immediately: a **Width** number field pre-filled from the Path tool's current stroke width and auto-selected on open (clamped and rounded to **1 – 50 px** on confirm), and a read-only **Color** row showing the **foreground color** swatch — the color is not editable here. `Enter` or **Stroke** rasterizes onto the **active layer**; `Escape`, **Cancel**, or a click on the backdrop dismisses it.
- **Path to Selection** rasterizes the path's Bezier outline into a full-document mask on a 2D canvas and installs it as the selection. Notes: it needs **≥ 2 anchors**; the mask keeps the fill's **anti-aliased edges** (alpha is copied straight into the mask, so the selection has soft borders); an **open path is implicitly closed** before filling, so converting one selects the chord-closed region; and the resulting selection's bounds are the **whole document**, not the path's bounding box.
- **Delete Path** removes the selected path and clears the selection.

---

## Navigator Panel

### Minimap Thumbnail
- A live thumbnail of the **composited document**, sized to the panel's width with the document's aspect ratio preserved and capped at **300 px tall**.
- The image is produced by the engine, not by copying the on-screen canvas: `readCompositeThumbnail` downscales the composite texture **on the GPU** (blit shader, LINEAR filtering) into a small RGBA8 texture and reads back only that, returning an 8-byte header (`width`, `height` as u32 LE) followed by RGBA pixels, which the panel unpacks and `putImageData`s onto a 2D canvas. Only the thumbnail-sized result crosses the GPU boundary, so the cost is independent of document size — a full-composite readback would be ~67 MB per tick at 4K. The composite texture is flipped to LINEAR filtering for the downscale and restored to NEAREST afterwards so the compositor's final blit never samples bilinearly.
- **Refresh cadence**: a 200 ms interval (5 Hz), but ticks are **skipped entirely while any pointer gesture is in progress**. The readback stalls the GPU pipeline, so painting, panning, moving, transforming, marquee-dragging, gradients, crop, mesh warp, and tilt-shift all suppress it. When the gesture ends, one **catch-up tick** is scheduled on the next event-loop turn so the thumbnail reflects the final pixels without waiting out the interval — but that tick now runs through the same dirty gate as an idle one (#726), so a gesture that changed no pixels (a wheel burst that only panned, a marquee drag, a cancelled transform) ends with no readback at all.
- **Idle ticks are additionally gated on the composite having actually changed.** The scheduler consults a monotonic *composite-input version* that bumps on two signals: a new `document` reference (any layer property, order, add/remove, mask, effects, document resize, background, color mode, or adjustment-node edit) and any pixel-data mutation. **Pan and zoom deliberately do not bump it** — navigating changes only the viewport transform applied at the final blit, not the composite texture itself. On a document nobody is editing, the 200 ms poll therefore reads nothing at all rather than stalling the pipeline five times a second. **Four UI-store fields bump it too** — `channelVisibility`, `maskMode`, `adjustments`, and `adjustmentsEnabled` (#723). Three of them earn it: the mask-edit and Quick Mask overlays are drawn *into* the composite texture and image adjustments are applied to it (compositor steps 4 and 4b), yet each is toggled by a plain button click that never touches the canvas pointer path — so with only the document/pixel signals nothing marked the composite dirty and the minimap kept showing the pre-toggle state until some unrelated edit came along. The **first** tick after mount always fires regardless — the last-read version starts at a sentinel no real version can equal — so the thumbnail paints once even on a document nobody ever modifies.
- **`channelVisibility` is the odd one out of those four: hiding a channel changes the minimap not at all.** The channel mask is a `final_blit.glsl` uniform, applied on the composite → screen step, while the minimap is blitted off the composite texture itself by the plain `blit` shader — whose only uniform is the source sampler. The readback an eye toggle schedules therefore repaints a byte-identical thumbnail. Harmless, but worth knowing which way round it is: **the minimap is not a preview of what the channel toggles do to the canvas.**
- **Wheel and trackpad navigation counts as an interaction.** Wheel events are discrete rather than pointer-tracked, so the end of a scroll burst is inferred from a **150 ms trailing timeout**: the first wheel event marks the app as interacting and each subsequent one restarts the timer. The flag is only cleared if no paint stroke, pan, or tool gesture is still running when it fires, so a stroke that began mid-burst keeps suppression alive.

### Viewport Indicator
- A translucent blue rectangle (`rgba(74, 158, 255, …)`) showing the visible viewport bounds within the document.
- **Click or drag anywhere on the minimap** to recenter the viewport on that point — pointer-down recenters immediately and captures the pointer, so a drag scrubs the view continuously. The indicator itself is **not** a draggable object: it is `pointer-events: none`, so there is no separate "grab the rectangle" affordance and no way to drag it relative to where you grabbed it. The minimap shows a crosshair cursor.
- The rectangle is floored at **4 px** in each axis so it stays visible when zoomed far out, and the computed rect is not clamped to the thumbnail — the wrapper's `overflow: hidden` is what keeps it from escaping.

### Zoom Slider
- **Range: 10 % – 600 %**, not the full canvas zoom range. The slider is log-scaled as `0.1 × 60^(position/100)` over a 0–100 track (step 0.5).
- Because the viewport itself allows 0.01× – 64×, the slider **cannot reach most of that range**: its reported position clamps to the 0.1× – 6× window, so at any zoom above 600 % (or below 10 %) the handle pins to the end of the track while the readout keeps showing the true zoom.
- **Double-click the slider** to snap back to 100 %.
- **Zoom readout**: the current zoom as a rounded percentage.

---

## Channels Panel

A per-layer view of the active layer's RGBA channels, modeled on Photoshop's Channels palette.

- **Rows**: RGB (composite), Red, Green, Blue, Alpha. Each row has a colored swatch dot, a label, a live thumbnail, and — on the four single-channel rows — an eye toggle. A row whose channel is hidden is dimmed. With no active layer the rows still render, minus their thumbnails.
- **Per-channel visibility**: the eye toggles feed a `vec4` channel mask that is applied in **`final_blit.glsl`**, the very last step that puts the composite on screen (`rgb *= mask.rgb`, `a *= mask.a`). Two consequences: hiding a channel **zeroes** it rather than isolating it (hide Red and you see the cyan-ish remainder, not a red separation), and because it lands after compositing it is a **view-only** filter — export, flatten, layer thumbnails, the **Navigator minimap**, and saved projects are all unaffected (the minimap samples the composite texture one step *before* the mask is applied; see [Navigator Panel](#navigator-panel)). The one other surface it does reach is the **seamless pattern preview**, drawn in that same final-blit pass and masked after the tile wrap, so every repeated tile is affected along with the center one. Hiding **Alpha** multiplies the whole composite's alpha by 0, which blanks the on-screen document to the transparency checkerboard — the shader composites over the checker only when the *document* background is itself transparent, which it always is (see [Document](#document)), so this is not a conditional in practice.
- **Thumbnails**: **40 × 20**, produced on the **GPU**. `readChannelThumbnail` / `readLayerThumbnail` blit the active layer's texture down into a small RGBA8 texture and read back only that, returning an 8-byte header (`width`, `height` as u32 LE) followed by RGBA pixels; the panel unpacks it into `ImageData` and letterboxes it into the 40 × 20 canvas when the aspect doesn't match. The CPU per-pixel extraction loop this replaced moved ~67 MB **per channel** per update on a 4K layer (#683). Reads are retried on up to **10** animation frames while the engine is still warming up, then give up and leave the tile blank.
- **The four channel tiles are opaque grayscale.** `channel_extract.glsl` writes the selected channel into all three of R / G / B and forces **alpha to 1**, so an untouched layer's R / G / B / Alpha tiles read as **solid black** while the RGB tile above them is empty — the tiles are never checkerboarded, and Alpha shows white where the layer is opaque.
- **The tiles are the layer's raw stored channels, not its contribution to the image.** All five sample the layer texture directly, so layer opacity, blend mode, mask, and layer effects are all excluded — as is the channel visibility set by this panel's own eye toggles (see the known gap below).
- **A group empties the panel without emptying its rows.** Groups are registered with the engine but composite their children through a scratch FBO, so a group's own texture never leaves the 1 × 1 lazy placeholder; select one and all five tiles come back as a single transparent pixel.
- Thumbnails re-render whenever the **active** layer's pixel-data version increments — painting on any other layer leaves them alone. That version bumps once per *committed* edit rather than per input event: a brush stroke bumps at stroke end, and since #732 a **shape or gradient drag bumps only on pointer-up**. Both keep updating the canvas live off the GPU preview path, so mid-drag these tiles — along with the Layers-panel thumbnail and the histogram behind Curves / Levels, the two other surfaces that read back off this version — still show the pre-drag pixels. That is deliberate: firing these readbacks per pointer-move accounted for the great majority of a 4K shape drag's wall clock. **The three are no longer alike in *how* they read, though.** These Channels tiles and the histogram still call `readLayerThumbnail` synchronously from their effects; the **Layers-panel** thumbnail was moved off that path in #743 and now queues through `requestThumbnailRead`, which dedupes per layer id and flushes every queued layer in one idle tick. The bytes were never the problem — 24 × 24 × 4 is 2,304 of them — but a synchronous `glReadPixels` forces a pipeline flush that waits on every draw call the compositor still has in flight, and reacting to a pixel-version bump landed that stall on the frame right after the pen came up. Batching means one stall per tick instead of one per dirty layer, and it lands while the browser is idle. The visible trade is that a Layers thumbnail can now settle a beat after the Channels tile beside it. (The Navigator's composite-dirty signal listens to the same notification, but it suppresses ticks during any pointer gesture anyway, so its minimap is unchanged either way.)
- Rows are keyboard-operable: `tabIndex={0}` plus an Enter / Space handler (unlike the Paths and layer-effects lists).
- **Known gap — the active channel does nothing.** Clicking a row sets `activeChannel` in the UI store and highlights that row, but **nothing reads it**: it has no consumers outside the panel, so it does not scope the eyedropper, curves, filters, or painting to a single channel. It is a selection highlight only.
- **Known gap**: the RGB composite row's thumbnail is a plain layer thumbnail — it does **not** reflect the R / G / B visibility toggles, because the channel mask is applied at the screen blit and the thumbnail path samples the layer texture directly.

---

## Info Panel

A compact numeric readout — section headings with label/value pairs under them, no controls, nothing clickable. It is **much thinner than Photoshop's Info panel**: there is no color sample under the cursor (no RGB / HSB / CMYK row), no document-size or scratch line, no per-tool hint text, and no units — every value is a bare document-space integer.

- **Cursor X / Y**: pointer position in document coordinates, rounded to whole pixels and **not clamped to the artboard** — hovering the grey surround reads out negative or past-the-edge coordinates. Updates are coalesced to **one write per animation frame**, and they keep coming while the pointer is outside the canvas element so long as a tool drag or a pan is in progress.
- **Canvas W / H**: document dimensions.
- **Layer X / Y / W / H**: the active layer's origin, plus its width and height when it has them. The **whole Layer section disappears when no layer is active**, and W and H are dropped *independently*, which makes the section ragged by layer type: a **raster** or **shape** layer shows all four values; a **group** shows X and Y only; a **text** layer never shows H at all (the text model has no height field) and shows W only for *area* text, because point text stores a null width.
- **Selection X / Y / W / H**: the active marquee's bounding box. Present only while a selection is active.
- **The Cursor readout goes dead whenever a selection is active.** It is not merely re-anchored during a transform — with any selection live it stops tracking the pointer entirely and prints the selection's own top-left, so the Cursor rows simply duplicate the Selection X / Y rows two lines below. The live pointer coordinate is still available — the [Status Bar](#status-bar) reads the same store field unconditionally — but not from this panel.

---

## Text Panel

A dockable typography panel (a superset of the text options bar) for styling the active/selected committed text layer. Grouped into four sections:

- **Font**: the same searchable font browser as the options bar, a **weight** dropdown (only the weights the family ships), a **style** dropdown (Normal / Italic), and a row of **recent fonts** used this session (session-only, click to re-apply).
- **Character**: **Size** (1 – 500 px), **Line height** (0.5 – 4×, step 0.05, default 1.4), **Letter spacing** (−20 – 200 px, step 0.5, default 0).
- **Paragraph**: an **alignment** button group (left / center / right / justify) and **Paragraph spacing** (0 – 200 px, default 0).
- **Decoration**: **underline (U)** and **strikethrough (S)** toggles.

Panel edits and options-bar edits share the same apply path (`apply-text-setting.ts`): changing a control updates the tool default *and*, when a committed text layer is active, re-styles that layer and records one history entry per edit (slider drags coalesce into a single entry). Letter spacing and paragraph spacing are applied inside the WASM engine because cosmic-text implements neither.

---

## Symmetry

- **Axes**: horizontal, vertical, both (4-way), or radial. Radial symmetry mirrors each dab into **2 - 32 evenly-rotated copies** around the center (kaleidoscope-style) and takes precedence over the horizontal/vertical mirrors when its segment count is ≥ 2.
- **Radial segment count**: the Radial Symmetry button is a toggle that switches radial **on at 8 segments** and off by zeroing the count. While it is on, a number input appears; the store rounds and clamps whatever it receives to **0 - 32**, so a typed value above 32 is pulled back down, and 0 or 1 simply turns radial off (the count must reach 2 before any mirroring happens).
- **Center**: configurable, defaulting to the canvas center. The center is resolved **once at pointer-down** and stored in layer-local coordinates for the whole stroke, so moving the symmetry center mid-stroke is not possible.
- Available on brush, pencil, and eraser. The symmetry config (axes, center, radial segment count) is global, so it applies to whichever of these tools is active. Only the Brush options bar exposes the **Radial Symmetry** toggle and its segment-count number input; the Pencil options bar exposes just the horizontal/vertical toggles (radial set from the Brush still applies to pencil/eraser strokes), and the Eraser inherits the active config without its own toggles.
- **The center marker is drawn for five tools that do not mirror.** The overlay gates the ringed crosshair on the *registered paint-tool set* — brush, pencil, eraser, clone stamp, healing brush, dodge/burn, sponge and spray — while the mirroring itself lives only in the brush/pencil/eraser stroke paths (`mirrorBatchPoints` / `getMirroredPoints` are imported by `paint-handlers.ts`, `brush-stroke.ts`, `pencil-stroke.ts` and `eraser-stroke.ts` and by nothing else; no `*_gpu.rs` dab engine mentions symmetry at all). So selecting Sponge or Clone Stamp with a symmetry axis enabled still shows the center marker sitting on the canvas, and strokes ignore it completely — the marker reads as an active-mode indicator but is only a reminder that the setting exists. Smudge, which is not in the paint-tool set, shows no marker and likewise does not mirror.
- **Cmd/Meta+click** on the canvas while any symmetry mode (horizontal, vertical, or radial with 2+ segments) is active moves the symmetry center to the click point without painting a dab. Lets the user reposition the mirror axis directly from the canvas without opening a settings panel.
- **Caveat — this intercept is global, not brush-only.** The check runs at the top of the canvas pointer-down handler, before the tool guards and before any tool dispatch, and it is not scoped to the paint tools. So while *any* symmetry axis is enabled, a Cmd/Meta+click is swallowed by the symmetry-center move for **every** tool — which suppresses the other documented Cmd/Meta gestures (shape and marquee 1:1 lock, gradient 15° snap, transform snap, Path anchor convert, the Cmd+shift 15° snap on straight-line brush/pencil/eraser strokes, and the Cmd half of the Clone Stamp / Healing source-set). Alt/Option still sets the stamp and healing source. Turn symmetry off to get those gestures back.

---

## Color

- **Color spaces**: sRGB, Display P3, Rec. 2020, Linear sRGB
- **FP16 / wide gamut**: RGBA16F textures when GPU supports `EXT_color_buffer_float`
- **EDR passthrough**: unclamped values for extended dynamic range displays

### Color Panel

The only surface that edits the foreground and background colors directly — there are **no foreground/background swatches in the toolbox**. With the panel closed, the swatches can still be changed by the eyedropper, the `X` / `D` shortcuts, a double-click on a shape's fill/stroke swatch, or clicking an existing text layer with the Text tool (which adopts that layer's color).

- **Swatch stack**: a 32px square holding the **foreground** swatch (24px, top-left, drawn over) and the **background** swatch (16px, bottom-right, behind) — the overlapping Photoshop arrangement. Clicking either one makes it the *active* swatch, marked with an accent border plus a 1px accent ring. Active-swatch choice is panel-local React state, so it is not persisted and reverts to the foreground whenever the panel remounts.
- **Swap** sits beside the stack as an icon button (`ArrowUpDown`, labelled *Swap Colors (X)*). **There is no reset button** — restoring black/white is keyboard-only, via `D`.
- **Every swatch in the panel is a real `<button>`** with `aria-label="Color: rgb(r, g, b)"`, painted over an 8px conic-gradient checkerboard so partial alpha reads visually. The label reports RGB only; alpha is not announced.
- The active swatch is what the picker, the hex field, and the sliders all read and write — the panel has a single editing target rather than separate controls per swatch.

### Color Picker (shared component)

Used by the Color panel, the Gradient modal, Gradient Map stops, the shape fill/stroke popover, and the guide-color picker. Every surface is a `<canvas>` redrawn on color change and on resize (via `ResizeObserver`), allocated with the app's wide-gamut `contextOptions`.

- **SV square**: white → full-hue horizontally, transparent → black vertically. Drag sets saturation from x and brightness from `1 - y`, both clamped to the box.
- **Hue bar**: 0 – 360° across the six primaries.
- **Alpha bar**: 0 – 100% over the current color, quantized to two decimals (`round(x * 100) / 100`).
- **Hue is preserved through neutrals**: when the incoming color has `r === g === b` the picker keeps the hue it already had instead of letting the RGB→HSV round-trip collapse it to 0. Dragging brightness down to black and back up returns the same hue rather than snapping to red.
- **Grayscale documents** get a different picker entirely: the SV square and hue bar are replaced by a single black → white value ramp that emits a neutral `r = g = b`, with the alpha bar below it.
- **Indexed documents** replace the picker with the **document palette** as a swatch grid (up to 256 entries, capped at 160px tall and scrolling so it can't push the sliders out of the panel). The entry matching the active color gets the accent ring — matched on RGB only, so alpha is ignored for that highlight.

### Hex field and sliders

- **Hex**: a 6-character monospace input rendered uppercase, prefixed by a static `#`. Commits on **Enter** or blur; unparseable input silently reverts to the current color. The parser also accepts 3- and 8-digit forms, but `maxLength={6}` puts the 8-digit RGBA form out of reach here, and the commit deliberately **keeps the swatch's existing alpha** rather than taking one from the hex.
- **Sliders follow the document color mode**: RGB → **R / G / B** 0 – 255; Grayscale → a single **K** 0 – 255; Lab → **L** 0 – 100 and **a** / **b** −128 – 127; CMYK → **C / M / Y / K** 0 – 100. The **Alpha** slider (0 – 100) is always present, in every mode including Indexed.
- Indexed documents keep the ordinary **R / G / B sliders and hex field** even though the picker is gone, so an arbitrary color can still be typed — it just snaps to the nearest palette entry on the way in.
- The Lab and CMYK sliders hold no state of their own: they are derived from the active sRGB color on every render and converted straight back on change, so a long series of small drags can round-trip a unit or two away from where it started.
- **Every write path is funnelled through `convertColorToDocMode`** — the picker, the hex field, each slider, and the recent/palette swatches alike. Grayscale clamps to luminance and Indexed snaps to the palette; Lab and CMYK pass through untouched, since those modes are sRGB-backed in the swatch model (see [Color Modes](#color-modes)).

### Recent colors

- A wrapping strip of 16px swatches at the top-right of the panel, capped at **28**. Clicking one applies it to whichever swatch is currently active.
- The store **ships all 28 slots pre-filled** with a fixed starter palette (neutrals, saturated primaries, pastels, earth tones), so the strip is never empty and adding a color always evicts the oldest.
- "Recent" means *painted with*, not *picked*: entries are appended when a stroke, path stroke, fill, spray, text commit, or shape lands — the shape tool pushes fill and stroke separately, and the gradient tool pushes **both** the foreground and background color on commit. **Choosing a color in the Color panel does not record it, and neither does the eyedropper.**
- Re-using a color moves it back to the front rather than duplicating it. The dedupe compares **alpha too**, so the same RGB at two different opacities occupies two separate slots.

### Gaps in the picker

- **It is mouse-only.** Every surface binds `mousedown` plus window-level `mousemove` / `mouseup`, with no pointer or touch events — so the picker cannot be operated by touch or stylus at all, even though the app ships a touch-first default layout (no panels open on a coarse-pointer device) and supports pinch-zoom on canvas.
- **The surfaces are focusable but keyboard-inoperable.** The SV square, hue bar, alpha bar, and value ramp each carry `role="slider"` and `tabIndex={0}` with full ARIA value attributes, but no key handler is attached — tabbing to one and pressing an arrow key does nothing.
- **`compact` is dead code.** The prop switches the picker to a single spectrum bar that can only pick at 100% saturation and 100% brightness (no SV square, no alpha), but no call site passes it, so that branch is unreachable in the app.

---

## Color Modes

**Image → Mode** sets a document-level color mode, Photoshop-style: **RGB Color**, **Grayscale**, **Indexed Color…**, **CMYK Color**, **Lab Color**. The current mode carries a checkmark. Only Indexed opens a dialog (it needs a palette size up front); the rest convert on click. Any mode other than RGB also shows its name in the **status bar**, left of the color-space readout.

A single capability table (`getColorModeCapabilities()`) is the source of truth for what each mode permits, so panels, menus, and tools agree instead of each running its own ad-hoc check.

| Mode | Layers | Chroma adjustments | R/G/B curve tabs | HSL blend modes | Color panel shows |
|------|--------|--------------------|------------------|-----------------|-------------------|
| RGB | yes | yes | yes | yes | HSV picker + R/G/B/A sliders |
| Grayscale | yes | no | no | no | value ramp + **K** slider (0 – 255) |
| Indexed | **no** — single flat surface | no | no | no | the document palette as a swatch grid |
| CMYK | yes | no | no | no | **C/M/Y/K** sliders (0 – 100 each) |
| Lab | yes | no | no | no | **L** (0 – 100) + **a** / **b** (−128 – 127) sliders |

The hex field stays available in every mode.

### Converting between modes

A conversion snapshots history *before* it bakes, so the whole thing — including Indexed's flatten — is **one undo step**. In-flight strokes are flushed into their layer textures first, so nothing half-painted survives in the old space. Alongside the pixels:

- **Text and shape colors, and all five effect colors** (stroke, drop shadow, outer glow, inner glow, color overlay) go through the same constraint the pixels do — a grayscale document is not left with a colored drop shadow.
- **Chroma-producing adjustment nodes are stripped** from group stacks: Hue/Saturation, Color Balance, Channel Mixer, Photo Filter, Gradient Map, Black & White, plus Saturation. Otherwise a Color Balance node would simply reintroduce the color the bake just removed. The same nodes disappear from the Adjustments panel's Add menu.
- **Hue / Saturation / Color / Luminosity blend modes coerce to Normal** and drop out of the blend-mode dropdown (its **Composite** group) in every mode but RGB. The stated reason is that they decompose RGB into HSL, which is meaningless once a texture holds encoded Lab or ink channels — accurate for Hue and Saturation, though Color and Luminosity are really Rec. 709 luma transfers that assume sRGB-ish channels rather than HSL round-trips (see [Blend Modes](#blend-modes)). Either way the gate is the same `hasHslBlendModes` capability flag.
- The **foreground and background swatches** are re-expressed in the new mode's value space, so the next stroke matches what the picker shows.

Every paint entry point — brush/pencil/eraser, spray, fill, gradient (per stop), shape (fill and stroke), and text — routes its color through a shared `toDocumentColor()`. The mode's constraint therefore holds even for colors that arrived from a brush preset, the eyedropper, or tool settings saved under a previous mode.

### Per-mode notes

- **Grayscale** — pixels are baked on the GPU to Rec. 709 luma (`0.2126 R + 0.7152 G + 0.0722 B`). The bake covers the **whole layer even under an active selection**: a mode change must not leave part of a layer in the old space. The picker collapses from the HSV square to a black→white value ramp.
- **Indexed** — flattens the document, then builds a palette of at most **256 colors** via a median-cut quantizer and snaps every pixel to the nearest entry. The dialog collects **Colors** (2 – 256, default 256) and a **Dither (Floyd–Steinberg)** checkbox (off by default), warns up front when more than one layer will be flattened, and takes **Enter** to convert / **Escape** to cancel. Palette building subsamples on a fixed stride above 262,144 pixels so a 4K canvas stays bounded — the snap itself still visits every pixel. The palette is stored on the document, shown in the Color panel as a swatch grid, and persisted in the `.lopsy` manifest. **Adding a layer is refused** while Indexed is active, with an info toast: *"Indexed mode does not support layers. Convert to RGB first."*
- **Lab** — the only mode whose layer textures hold something other than sRGB. Pixels are stored as encoded CIELAB (L in R, a in G, b in B), and the engine decodes for display (`u_docColorMode == 1` in `final_blit.glsl`), for the export composite, and for the eyedropper — which decodes *before* averaging its sample square, since the transform is non-linear. The panel's L/a/b sliders drive a TypeScript mirror of the Rust math, used for single colors only so the two can't drift on bulk pixel work. Stored 8-bit, matching Photoshop's 8-bit Lab; a/b quantization costs a few sRGB units at saturated gamut corners.
- **CMYK** — sRGB-backed. The C/M/Y/K sliders are a unit system over sRGB rather than stored ink, and **a CMYK document does not yet render any differently from an RGB one**. The naive ink model is a bijection with sRGB — its round trip is lossless across the whole cube — so there is no gamut to clip; a real difference needs profile-based conversion with ink limits. Native ink storage is blocked on the paint pipeline owning the alpha channel (dabs write coverage there and premultiply by it), leaving no fourth channel free for black.

### Declared but not enforced

The capability table also declares that Indexed has no gradients and no anti-aliasing, and that the non-RGB modes hide the Levels R/G/B channel tabs. Nothing reads those three flags. In practice: the **Gradient tool still works in an Indexed document** (each stop snaps to the palette, but the GPU interpolates freely *between* snapped stops), paint tools still anti-alias, and the **Levels editor still shows its R / G / B tabs in every mode** — it never consults the capability table at all, so a Grayscale or Lab document can still be given a per-channel Levels remap even though the adjacent Curves editor correctly collapses to the composite curve alone. The layer guard has a matching hole — it covers New Layer, Group, and Duplicate, but not the Text tool, so an Indexed document can still gain a second layer.

The chroma-node filter has a hole of the same shape. **New Document** filters the default node set against the chosen mode, and converting a document strips the chroma nodes it no longer allows — but **Flatten Image** re-seeds the root group with the unfiltered default set while keeping the document's mode. Flattening a Grayscale, Lab, or CMYK document therefore gives it a fresh **Hue / Saturation** node, one the mode's own Add menu would refuse to offer. It arrives at identity, so nothing changes until a slider moves, but its controls are live.

More generally, the palette snap runs **only at conversion time**. Pixels painted afterwards are constrained just at the *color* level (via `toDocumentColor`), not per-pixel, so anti-aliased edges, gradient interpolation, and soft brushes all put off-palette pixels into an Indexed document as you keep working in it.

---

## History

- Undo/redo with labeled snapshots (the 50 most recent states are kept — each push keeps the last 49 plus the new one, and the oldest silently falls off)
- **Undo** (`⌘Z`) / **Redo** (`⇧⌘Z`) from the Edit menu or keyboard
- **A pixel snapshot is a GPU texture copy, not compressed pixel data.** Pushing one blits each layer's texture into a second texture held inside the engine and keeps an opaque handle; nothing is read back into JS and nothing is compressed. The engine's own note puts the blit at ~1 ms per layer against ~100 ms for the readback-plus-compress pass it replaced (#535, 2026-05-23). The RLE codec still ships, but its only remaining callers are the filter and Color-LUT preview commits (the `.lopsy` writer uses gzip); undo has not touched it since. The trade is memory: the snapshot of a 4096 × 4096 layer is another 4096 × 4096 texture on the GPU.
- **Only the layers you changed pay for a snapshot.** A push re-blits the layers marked dirty; every other layer carries its handle over from the previous snapshot as long as its position and raster dimensions are unchanged, so adjacent states share textures rather than duplicating the whole stack. A layer the engine holds no texture for — or a zero-sized one — stores an empty sentinel instead, which restores as a 1 × 1 transparent upload, so a layer that had no engine texture when the snapshot was taken comes back blank rather than being left alone.
- **A paint stroke's snapshot is usually taken before it is asked for.** At pointer-up the just-painted layer is queued for snapshotting on the next idle tick, so the following push can adopt a ready-made handle instead of blitting mid-gesture; beginning another stroke first simply forces that work to run synchronously at push time. Switching the active layer used to release that queued handle there and then, because the outgoing raster layer was cropped back to its content bounds on the same frame and its texture would no longer match. **Since #743 both halves are deferred together**: the crop is scheduled on a `requestIdleCallback` (500 ms timeout, `setTimeout` fallback) and `invalidateCachedSnapshot` now runs *inside* that callback, immediately before the crop. So the queued handle survives a layer switch and is dropped only if and when the crop actually runs — which is the consistent pairing, since a cancelled crop leaves the texture exactly as the queued snapshot found it. See [Layer Texture Lifecycle](#layer-texture-lifecycle-crop-on-switch-expand-on-return) for when the crop is cancelled.
- **Metadata-only snapshots** skip the texture copy entirely and record just the model. They back **Add Layer**, **Add Text Layer**, **Group Layers**, **Toggle Visibility**, **Reorder Layer**, **Change Opacity**, **Change Blend Mode**, **Add / Remove / Toggle Mask**, every layer-effect edit (`Edit Drop Shadow`, `Enable Stroke`, …), and every Path-tool edit (**Add Path**, **Move Path Anchor**, **Straighten Path Anchor**, **Edit Path Handle**, **Split Path Segment**). Undoing one of them never touches the GPU at all: it restores the document model, the selection, and the paths, and leaves every layer texture exactly as it is.
- **What a snapshot carries**: the document model, the marquee selection, and the workspace's **stored vector paths** (the path list plus the selected path id) — in both the metadata and the pixel-bearing variants. Paths are restored alongside the document on undo *and* redo, which is what makes Path-tool edits reversible; before they were part of the snapshot shape, anchor drags, handle drags, segment splits, spline conversions, and path creation were all invisible to undo. **Quick-mask pixels are still not in a snapshot** — see the caveat under Quick Mask Mode.
- **Restoring is more than a texture swap.** Every undo and redo step first drops an active float and cancels a scheduled prefloat — a stale float keeps its expanded dimensions in the engine's layer descriptor and would misplace the restored texture (issue #706) — then restores each layer texture from the snapshot, resets the tracked engine state, clears every cached JS pixel buffer, and re-pushes all layer descriptors. Undo additionally finalizes a stroke still pending when it fires; redo does not.
- **Undoing does not make the document clean again.** The dirty flag is raised by every push and is never lowered by undo or redo, so stepping all the way back to the start still trips the unsaved-changes guard on New / Open. Only Save Project, PSD import, any export, and creating or opening a document clear it (see *Open / Save*).
- **Known defect — snapshot textures are never freed.** Nothing releases a snapshot once it has landed in the undo or redo stack: not the 50-state trim, which drops the oldest snapshot without releasing the handles no newer state still shares; not the redo-stack clear that every push performs; and not New Document / Open, whose engine reset releases layer, mask, stroke, selection, clipboard, and float textures but does not touch the snapshot store. The engine exports a `clearGpuSnapshots` entry point for exactly this purpose and **it has no caller anywhere in the app.** GPU texture memory therefore grows with the number of pixel-edits made and is reclaimed only when the WebGL context itself goes away (a reload, or context-loss recovery). The one place snapshot handles *are* released is the speculative pre-float the Move tool builds and then discards.

### History Panel
- Rows are numbered from **0 — "Original"**; every later row shows the label of the action that produced it (`Brush`, `Merge Down`, `Clear Selection`, …). Row 0 is literally the original only while the stack is under its cap — once the oldest snapshot has been trimmed the row still reads "Original" but lands on the oldest state still retained, which may be many edits in.
- **A fresh document opens with two rows, not one.** On the first painted frame after a document is created or opened, the renderer records a baseline snapshot labeled `New Document` if the undo stack is empty — so rows 0 ("Original") and 1 ("New Document") describe the same pixels and clicking either lands in the same place.
- The row matching the current state is highlighted in the accent color. Clicking any row walks to it by running `undo` or `redo` once per row crossed. There is no random-access restore, and each of those steps is a full restore (a texture blit per layer, an engine re-sync, every JS pixel cache dropped), so jumping thirty rows costs thirty of them.
- **Undone steps stay in the list** below the current position, dimmed in the disabled text color, and clicking one redoes forward into it. They are discarded the moment a new edit is pushed (the redo stack is cleared on every push).
- The list is its own scroll area (120 px minimum, 250 px maximum) and scrolls to the **bottom** whenever the undo stack length changes — which after an undo means the furthest *future* row, not the current one.
- At most **51 past rows** are reachable: `Original` plus the 50 snapshots the cap allows, with any undone steps listed below them.
- A single gesture can produce two rows. Hold-to-smooth pushes the freehand stroke as its own `Brush` entry before rasterizing the smoothed one, so returning to the pre-stroke state takes two undos (see *Brush → Hold-to-smooth*). **Dodge / Burn, Sponge, Clone Stamp, Healing Brush, and Spray do it on every stroke**, and the first of the two rows is mislabeled `Eraser` — see the defect note under [Dab Engines](#dab-engines-shared-across-paint-tools).
- The plain **"No history"** placeholder shows only while *both* stacks are empty — in practice just the gap between opening a document and its first rendered frame, since the baseline snapshot lands there.

---

## Document

- **Name**: defaults to **`lopsy`** — "Untitled" appears nowhere in the app — and **no UI renames it**. The name is only ever inherited from a file: an opened image, PSD, DNG, or RAF takes the file's name, a `.lopsy` project restores the name it was saved with, and a dropped or pasted image adopts its filename. It matters because it seeds every export filename, so a document built from scratch saves as `lopsy.png` / `lopsy.psd` unless you retype the Export dialog's **Filename** field — which renames that one export, not the document.
- **Dimensions**: width x height
- **Background**: chosen in the New Document dialog as **White** or **Transparent** — but the choice is made in *pixels*, not in a document property. White fills the `Background` layer with opaque white; Transparent leaves it empty. The document's own `backgroundColor` field is hard-coded to `rgba(0, 0, 0, 0)` at every site that creates a document (new, opened image, initial boot) and no UI writes it, so it is effectively dead state that only round-trips through `.lopsy` save/load — and the transparency checkerboard is always what sits behind the layer stack.
- **Color mode**: RGB (default), Grayscale, Indexed, Lab, or CMYK — see Color Modes
- Entirely client-side, no backend

---

## App Shell, Install & Persistence

### Installable, but not offline
- A **web app manifest** (`public/manifest.webmanifest`, linked from `index.html`) declares name and short name `Lopsy`, `display: standalone`, `start_url: /`, and background / theme colors of `#1e1e1e`, with three icon entries — 192 px, 512 px, and the 512 again marked `purpose: maskable` — alongside a separate `apple-touch-icon` link and a matching `theme-color` meta. A browser that offers installation therefore gets a standalone window with its own icon and title-bar color.
- **Installing does not buy offline use.** `main.tsx` registers `/sw.js` on every load where `navigator.serviceWorker` exists, but `public/sw.js` is two lines — `install → skipWaiting()`, `activate → clients.claim()`. It declares **no `fetch` handler and never touches the Cache API**, so it caches nothing and contributes nothing to loading the app; its only effect is that a newly deployed worker takes control immediately instead of waiting for every tab to close. There is no build-time PWA tooling in the project (no Workbox, no `vite-plugin-pwa`), so `public/sw.js` is copied verbatim into the build and is exactly what ships.
- **A failed registration is unhandled.** The call is a bare `navigator.serviceWorker.register('/sw.js')` with no `.catch()` — two lines below it, `initWasm().catch(() => {})` does swallow its own failure — so a refused registration (insecure origin, storage blocked, private mode) surfaces as an unhandled promise rejection in the console. Nothing else breaks, because nothing in the app depends on the worker.
- Hosting is configured as a single-page app: `public/_redirects` maps `/* → /index.html 200`.
- `index.html` also carries the link-preview surface — Open Graph and Twitter `summary_large_image` tags pointing at `public/og-image.jpg`, plus the page title and description.

### Browser zoom and gestures are suppressed app-wide
- `index.html` ships `maximum-scale=1.0, user-scalable=no` in its viewport meta, and `main.tsx` adds **capture-phase `window` listeners** — at capture specifically so nothing downstream can stop propagation first — that `preventDefault()` on **ctrl/meta + wheel**, on `gesturestart` / `gesturechange` / `gestureend`, and on **ctrl/meta + `+` / `-` / `=` / `0`**.
- So the page itself never zooms or pinches: those inputs are free to drive the canvas zoom instead (see [Viewport](#viewport)). The keydown suppressor lists the four browser-zoom keys only — `⌘1` is not among them — but `handleZoomShortcut` calls `preventDefault()` for `=`, `-`, `0` **and** `1`, so every canvas zoom shortcut cancels its own default as well.

### What survives a reload
- **Exactly two things, both in `localStorage`.** The app uses no IndexedDB, no cookies, no OPFS, and no Cache API anywhere in `src/`.
  1. **`dock:layout:v1`** — the panel layout (see [Panel Docking → Persistence](#persistence)).
  2. **`lopsy-shortcut-customizations`** — the Zustand `persist` store behind [Keyboard Shortcut Customization](#keyboard-shortcut-customization), holding only the `customShortcuts` override map.
- **The two are not equally careful.** The dock layout is re-validated on load and anything malformed is repaired or dropped. The shortcut store declares no `version`, no `migrate`, and no `merge`, so whatever JSON sits under its key is adopted as the override map verbatim. An override therefore outlives the action it names: seeding `{ 'ghost-tool': 'b' }` makes `buildKeyToActionMap` hand `b` to the dead id **and delete Brush's binding entirely** — `B` then selects nothing and the Brush has no key at all, with no row in the shortcuts modal to explain it, because the modal renders its own hand-written row list rather than the stored map. **Reset All** clears it.
- **Everything else is memory-only.** Tool settings (every tool's size / opacity / hardness / mode), the foreground and background colors, the recent-colors strip, **brush presets** — both what `Save Current` snapshots and every tip imported from an `.abr` — patterns, reference images, guides, the selection, the undo history, and the viewport all reset on reload.
- **For most of that there is no route across a reload at all.** Tool settings, brush presets, patterns, and reference images are absent from the `.lopsy` project format as well (see [Native Project Format](#native-project-format-lopsy)), so saving a project does not rescue them either. The Brushes modal's **Export** button — the `.json` preset library — is the only way to carry a custom brush from one session to the next, which is what that button is for.
- **There is no light theme.** `.theme-light` is named in the repo's own contributor docs, but no stylesheet defines the class and nothing in the app ever sets it. The dark palette in `tokens.css` is the only one that ships, and there is no theme control anywhere in the UI.

### Dev-only debug hooks
- `main.tsx` hangs a set of `window.__*` handles for the Playwright suite — the editor, UI, tool-settings, pattern, shortcut, and dock stores, the pixel-data manager, `__readCompositedPixels` / `__readLayerPixels`, and project save / load / RAF-import helpers. The whole block sits behind `import.meta.env.DEV`, so a production build exposes none of it.

---

## File I/O & Export

### Open / Save
- **New** (`⌘N`, menu-only accelerator): blank document with width/height/background prompt, plus a **Color Mode** dropdown offering RGB Color / Grayscale / CMYK Color / Lab Color. Indexed is deliberately absent — as in Photoshop it is conversion-only, since a meaningful palette has to be quantized from existing pixels. The initial fill is written already encoded for the chosen mode — a new document is created before the canvas mounts, so there is no engine to bake through, and a literal white buffer would open as maximum chroma in Lab. The default adjustment-node set is filtered to what the mode allows, so a new Grayscale document does not ship with chroma nodes, and the toolbox swatches are normalized into the mode's value space the same way a conversion does. **The background choice also decides the layer count**: White creates *two* raster layers — an opaque `Background` plus an empty `Layer 1`, which starts active — while Transparent creates only the (empty) `Background`, and that is the active layer. (The second layer is additionally gated on the mode supporting added layers, which excludes only Indexed — a mode this dialog does not offer.) Resets the viewport zoom and pan so the fresh canvas always lands fit-to-view, even after working on a much larger document.
- **New Document tip strip**: the modal shows a 💡 *Tip:* line drawn from a fixed list of eight one-liners (symmetry, the seamless pattern tool, group adjustments, guide colors, raw formats, ABR brush import, an update note, and a link to the GitHub repo). One is chosen **at random per mount** — it does not rotate while the modal is open — and it is rendered as raw HTML so the last entry's link is clickable. One of the eight is inaccurate: it advertises **TIF** support, which does not exist (no `.tif` in any file picker, no TIFF image importer — the TIFF parser in the tree is internal to the DNG decoder, and a `.tif` dropped on the app falls through to the browser `<img>` decode and fails).
- **Open…** (`⌘O`, menu-only accelerator): open a PNG/JPEG/GIF (first frame)/BMP/WebP/PSD/DNG/RAF/.lopsy from disk. The picker lists every supported extension explicitly rather than `image/*` — mixing the two makes Chrome on macOS collapse the dialog down to a single filter.
- **Two routing paths, not one.** The File-menu picker routes inline **by extension** (`.lopsy` → project loader, `.psd` → PSD importer, `.dng` / `.raf` → the Rust RAW decoders, anything else → browser `<img>` decode). The pre-document flow — the New Document modal's "Open file" button and drag-and-drop — instead uses the shared `classifyOpenFile` helper, which checks the same four extensions but falls back to the **MIME type** (`image/*`) rather than attempting a decode. The practical difference is at the edges: a file with an image MIME type but an odd extension opens on drop and fails from the menu picker, while an unrecognized file dropped on the canvas is silently ignored (the New Document modal's button surfaces a friendly error instead).
- **Drag-and-drop is always live**, not just before a document exists — the drop target is the whole app shell as well as the canvas. Dropping an image onto an open document adds it as a layer (see Paste / Drop behavior); dropping a `.psd`, `.dng`, `.raf`, or `.lopsy` **replaces** the open document.
- **Unsaved-changes guard**: **New**, **Open…**, and **Open Project…** check the document's dirty flag and put up a browser `confirm()` — "You have unsaved changes. Are you sure you want to continue?" — before discarding work. Closing or reloading the tab triggers the browser's own `beforeunload` warning. The drop path performs **no** such check: a `.psd` or `.lopsy` dropped onto a dirty document replaces it immediately.
- The dirty flag is cleared by **Save Project** and by **PSD import** — and also by any **export**, since the shared download helper marks the document clean. Exporting a PNG therefore silences the unsaved-changes warnings even though nothing was saved to a project file.
#### PSD Import

- **Open PSD**: rebuilds layers, masks, blend modes, and effects from the PSD reader (Rust). **Grayscale**, **RGB**, and **CMYK** files are accepted at 8-bit and 16-bit depth. Grayscale files carry a single color plane, which is replicated across G and B on import, and the document opens *in* Grayscale mode; CMYK files are converted to RGB (naive `(1−C)(1−K)` channel math) for both the per-layer and merged-composite paths and open as RGB. Remaining color modes (indexed, Lab, duotone, …) are rejected with an unsupported-color-mode error — whose text still reads *"only RGB is supported"* and so understates what the reader actually accepts.
- **Channel compression**: all four PSD encodings are decoded — raw (0), **PackBits** RLE (1), **ZIP without prediction** (2), and **ZIP with prediction** (3, both 8- and 16-bit, the 16-bit variant re-emitting big-endian samples after undoing the per-row delta). An unrecognized compression id is a **hard error rather than a zero-fill**, deliberately: a silently zeroed channel would import as an all-black layer with nothing to indicate the data was lost.
- **Blend modes**: the 16 Lopsy modes map to and from their PSD four-character keys (`norm`, `mul `, `scrn`, … and `smud` for Exclusion). PSD ships more modes than Lopsy does, and **any unrecognized key falls back to Normal silently** — a Linear Dodge or Divide layer imports looking wrong rather than failing.
- **Groups** arrive as section-divider records, so a folder left closed in Photoshop imports collapsed. Group masks round-trip the same way leaf masks do (the writer emits them on the divider record). Clipping is carried on leaf layers; groups always import unclipped. The clipping flag is **preserved but not honored** — it survives the round trip out to PSD again, while Lopsy renders every clipped layer unclipped (see Layer Properties → Clip to below).
- **Photoshop-native layer kinds are flattened to pixels**, counted, and reported through the info toast: **text** (`TySh`/`tySh`), **smart objects** (`SoLd`/`SoLE`/`PlLd`), **fill layers** (`SoCo` solid, `GdFl` gradient, `PtFl` pattern), and **adjustment layers** (16 keys — `levl`, `curv`, `brit`, `hue `/`hue2`, `blnc`, `selc`, `grdm`, `phfl`, `mixr`, `blwh`, `vibA`, `expA`, `post`, `thrs`, `nvrt`). The pixels survive; editability as the original type does not.
- **Lock state is not imported** — every layer arrives unlocked regardless of how it was saved.
- Effects are read only from Lopsy's own `lyEf` block, so a PSD written by Photoshop imports with **all effects disabled** (see *Layer Effects*).

#### PSD Export

- **Export PSD** (File menu): serialises the current document via the PSD writer at **16-bit** precision — the menu passes 16 explicitly, and the exporter's 8-bit default is unreachable from the UI. Depth selects the channel encoding: 16-bit planes are written as **ZIP with prediction**, the (unreachable) 8-bit path as **PackBits**. Pass-through groups are written as `normal`, since PSD has no pass-through discriminant and `pass-through` is deliberately absent from the blend-index table. A Grayscale document writes header mode 1 with one color channel per layer; **every other mode — including Lab and CMYK — is written as RGB**.
- **The merged composite is computed separately, in Rust** — `flatten_layers` (`engine-rs/crates/lopsy-core/src/psd/flatten.rs:18`) walks every visible layer bottom-to-top, applying masks and opacity. It ignores **clipping masks and layer effects** and treats every group as pass-through, so in a reader that only shows the flattened preview, a document built on effects or non-pass-through groups will not match what Lopsy renders. Clipping is the exception that costs nothing: Lopsy's own compositor ignores `clipToBelow` too (see Layer Properties), so on that one axis preview and canvas already agree. Layer-aware readers rebuild from the layer records and are unaffected.
- **The structural exclusions above are not the whole story — the blend math itself is a second implementation, and it disagrees with the canvas.** `flatten.rs` is a CPU reimplementation (`blend_colors` in `lopsy-core/src/blend.rs`) that shares no code with the GPU's `blend.glsl`. Three separate divergences, all reproducible from a native `cargo test` against `flatten_layers`:
  - **Color space.** The flatten path linearizes on read (`srgb_to_linear`, `:134`) and re-encodes on write (`linear_to_srgb`, `:94`), i.e. it blends in **linear light** — while the canvas blends in **gamma-encoded sRGB** (see [Blend Modes](#blend-modes)). Every non-opaque or non-Normal pixel therefore lands somewhere different. Measured, 8-bit: Overlay gray-50 % over gray-75 % gives **137** in the PSD and **191** on canvas; Screen gray-50 % over itself **167 vs 192**; Multiply gray-50 % over itself **61 vs 64**; a 50 %-alpha red over blue **(188, 0, 187) vs (128, 0, 127)**. The two agree only where the transfer curve has fixed points — fully opaque Normal, and blends whose operands are already 0 or 255 (Difference of pure red over pure blue matches exactly).
  - **Color Dodge / Color Burn guard ordering is reversed.** `blend.rs` tests the *destination* first (`:21`, `:30`); `blend.glsl` tests the *source* first (`:70`, `:77`). Where both guards fire the results are opposites: white dodged over black is **black in the PSD, white on canvas**; black burned over white is **white in the PSD, black on canvas**. This one is pure integer math — it is unaffected by the color-space gap and would survive fixing it.
  - **Saturation with an achromatic source.** When `sat(src) == 0`, the shader substitutes the *destination's* own HSL saturation (`blend.glsl:108`), leaving the destination essentially untouched; the Rust path passes the literal 0 through `set_saturation` and **flattens the destination to gray**. So the common "paint gray in Saturation mode" gesture is a near no-op on canvas and a full desaturation in the exported preview.
- **What does not survive the trip out**: group adjustment-node stacks, layer color tags, lock state, and text editability (text layers are written as raster at their rendered texture size). Effects are written only when at least one is **enabled**, so a layer carrying configured-but-disabled effects exports none.
- **Color and structure**: a Display P3 profile is embedded as image resource 1039 for wide-gamut documents, and the writer's sRGB profile otherwise. Layer names are written as Unicode (`luni`) and group nesting as section dividers (`lsct`).
- **Known defect — masks from a loaded project export corrupt.** The exporter builds the mask byte view as `new Uint8Array(layer.mask.data.buffer)` (`src/io/psd.ts:166`), omitting the `byteOffset`/`byteLength` that every other mask read in the codebase passes. When the mask is a **view into a larger buffer** — exactly what opening a `.lopsy` produces, since masks are sliced straight out of the project file's own ArrayBuffer — the export reads from the start of that whole buffer instead of from the mask. The exported mask channel then contains the opening bytes of the `.lopsy` file rather than mask pixels. Masks created in-session via Add Mask, or imported from a PSD, are freshly allocated at offset 0 and export correctly.

### Native Project Format (.lopsy)
- **Save Project** (`⌘S`, menu-only accelerator): writes the full editor state to a `.lopsy` file and triggers a browser download. Round-trips every layer (raster pixels, text, shape, group), masks **and their enabled flag**, blend modes, opacity, visibility, **lock state**, position, clip-to-below, layer effects, group adjustment node stacks **and the group-wide bypass**, group collapse state, the active layer, the document's name / size / background / **color mode** (plus the **Indexed palette** when there is one), and the workspace's stored vector paths (Paths panel) and canvas guides. (Files saved before paths/guides were serialized simply omit those fields and load with an empty path/guide set; likewise the color mode is an optional manifest field, so projects saved before color modes existed load as RGB.)
- **Layer color tags do not round-trip.** A tag is set from the Layers-panel context menu and drawn as a colored bar down the row, but `colorTag` is absent from the serialized layer shape — it is neither written on save nor read on load, so saving and reopening a project **silently clears every tag**.
- **Not stored in the file at all**: the current selection, the undo history, quick-mask state, reference images, tool settings, and the viewport. Loading always finishes with **fit-to-view**, so zoom and pan are not restored — a project saved at 400 % reopens fitted to the window.
- **Open Project…**: file picker filtered to `.lopsy`. Restores all of the above. **Layer pixels are gzip-compressed; mask bytes are stored raw**, so mask-heavy documents compress noticeably worse than their pixel content suggests.
- **Format**: binary container — `LOPSY\0` magic + uint16 version + uint32 manifest-length + UTF-8 JSON manifest + per-layer gzipped RGBA blobs + per-mask raw byte blobs (referenced from the manifest by index). Text and shape layers record the **true dimensions of their rendered bitmap** alongside their logical size, because a text layer's logical width is its box width rather than its raster extent and the load path cannot infer one from the other. Entirely client-side; no server round-trip.
- **Load guards**: a missing magic prefix is rejected as "not a valid `.lopsy` file"; a file whose format version is **newer than the app supports** is refused with an explicit "saved with a newer version of Lopsy" message rather than parsed optimistically; and a blob-size table claiming more entries than the file can hold is caught before the read loop can walk off the end of the buffer. Any failure surfaces as an error toast and leaves the open document untouched.

### Export Dialog (`⌥⇧⌘E`)
Opened from File → Export… The `⌥⇧⌘E` shown next to the menu item is a display-only accelerator (not wired to a global key handler). A modal dialog with a live thumbnail preview (debounced ~200 ms) and inline options:

- **Format**: PNG, JPEG, WebP, BMP
- **Quality** (JPEG / WebP only): 1 - 100% slider, default 92
- **PNG Quality**: two-button toggle —
  - **Regular** — 8-bit PNG via `canvas.toBlob`
  - **High** — 16-bit PNG via the Rust engine, preserving FP16 precision for wide-gamut workflows
- **Filename**: editable text field; the document name is used by default and the format-appropriate extension (`.png`, `.jpg`, `.webp`, `.bmp`) is appended automatically
- A live pixel-dimension readout (`W × H px`) sits under the preview
- **Enter** confirms; **Escape** cancels (the handler is on the dialog, so it responds once focus is inside it)

**Color-managed output**: when the document is in a wide-gamut working space (Display P3), exports carry the correct color metadata so other apps interpret the pixels faithfully — PNG and JPEG are tagged with a colorimetrically-correct Display P3 ICC profile (Bradford-adapted colorants, true piecewise-sRGB transfer curve), PSD embeds the matching working-space profile, and BMP (which cannot carry a profile) is converted P3 → sRGB before encoding. sRGB documents keep their historical sRGB tagging unchanged. WebP is tagged by its own encoder.

**Embedded credit**: PNG exports carry a `Software: Lopsy` text chunk plus a `Comment` of "Made with Lopsy — http://lopsy.art"; JPEG exports carry the same note as a JPEG comment segment. WebP and BMP carry no note.

### Quick Export PNG (`⇧⌘E`)
One-shot PNG export through the GPU compositor — no dialog, no preview, uses the document name as the filename and quality 92. (The `⇧⌘E` shown in the menu is a display-only accelerator, not wired to a global key handler.)

### DNG / RAW Import
Camera RAW files are decoded entirely in Rust before being uploaded to a GPU layer — JS never touches the raw sensor data. Both decoders hand back **f32 RGBA**, uploaded straight into the layer's RGBA16F texture, so a raw import never round-trips through an 8-bit canvas.

**Shared import mechanics (both formats).** The decode is a **synchronous main-thread call** into WASM, so the importer opens a *loading* modal (`Opening DNG…` / `Opening RAF…`) and deliberately yields **two** animation frames first — rAF callbacks run *before* paint, so a single yield would commit the modal to the DOM without ever painting it. Both paths then build the document identically: create a 1 × 1 transparent document, wait up to 60 frames for the engine, let the decoder upload into the active layer, and only then resize the document and layer to the decoded dimensions and rename both after the file. The JS-side pixel-cache entry for that layer is **dropped** afterwards so the forced full re-sync cannot overwrite the freshly uploaded GPU texture with the 1 × 1 placeholder, and the viewport is fit to the new size. Because the document is made through the normal path, a raw import still receives the standard four identity adjustment nodes on its root group (see *Default adjustment stack*). Every pipeline stage logs diagnostics to the browser console (`[DNG tags]` / `[DNG step]` / `[RAF]` lines recording the tags read, the matrices chosen, and the center pixel after each stage); only width, height, BaselineExposure, and the tone curve are returned to JS.

#### DNG (including Apple ProRAW)
- **Container**: a TIFF IFD parser handling both byte orders. The full-resolution image is found by scanning **every SubIFD and keeping the one with the largest pixel count**, falling back to IFD0 when a file has no SubIFDs — so an embedded preview or thumbnail is never mistaken for the main image. Color metadata is read from IFD0 *or* the SubIFD, whichever carries it.
- **Compression**: uncompressed (8- or 16-bit), **lossless JPEG** (SOF3 / ITU T.81 process 14 — all seven predictor modes, both tiled and single-strip), and **deflate/zlib**. Any other compression is rejected with an explicit error; lossy JPEG and JPEG XL are not supported.
- **Two layouts**: *Linear DNG* (PhotometricInterpretation 34892 — Apple ProRAW, already demosaiced) and *CFA DNG* (32803, **bilinear** Bayer demosaic covering RGGB / BGGR / GRBG / GBRG, defaulting to RGGB when the pattern tag is absent). Any other photometric interpretation is rejected.
- **LinearizationTable** (tag 50712) is applied before normalization whenever present: ProRAW stores 10-bit ADC codes through a roughly cubic table, and skipping it leaves shadows dramatically too bright.
- **Normalization** subtracts BlackLevel (accepted as either RATIONAL or SHORT) and divides by WhiteLevel — but when **no** linearization table was applied and the measured maximum is below a quarter of WhiteLevel, the **measured max wins instead**, because Apple writes WhiteLevel 65535 even for 10-bit data. With a table present WhiteLevel is authoritative and that heuristic is skipped.
- **Color**: white balance from AsShotNeutral, then camera → sRGB. **ForwardMatrix is preferred and used as-is** (it maps AsShotNeutral to D50 by construction and is already neutral-preserving); the fallback inverse-ColorMatrix is **column-scaled ("neutralized") first**, because its raw row sums are far from 1 and would otherwise map neutral gray to magenta. The **D65-calibrated ColorMatrix2 / ForwardMatrix2 are preferred** over the illuminant-A CM1 / FM1, since the XYZ → sRGB step assumes D65. Both passes run **unconditionally, including on ProRAW**, whose pixels are camera-native even though AsShotNeutral ≈ [1, 1, 1] — skipping them leaves a gray-green cast.
- **Tone**: BaselineExposure (a straight 2^EV linear gain) → ProfileToneCurve (control points expanded into a 4096-entry LUT) → sRGB gamma.
- **Auto-levels finish.** Apple ships a deliberately near-linear ProfileToneCurve, so without a final stretch the render is flat. The decoder builds a 1024-bin **Rec. 709 luminance** histogram and clips **0.2 % from the bottom and 0.1 % from the top** (white is clipped less, to protect highlight detail), then applies that black/white point **equally to all three channels** so white balance is preserved — a composite-RGB Levels move, not a creative curve. It is skipped entirely when the resulting range is under 0.05, so an already-flat image is never blown up.
- **ProfileGainTableMap** (tag 52525 — Apple's proprietary local tone map) is parsed but **never applied in the browser**. The opt-in is an *environment variable* (`DNG_ENABLE_GAINMAP`, with `DNG_GAINMAP_SCALE` to tune it), and a WASM build has no environment, so the check can never succeed however the file is authored: the entire apply path is unreachable in the shipped app. (Its parser is still correct — it reads big-endian data even inside a little-endian TIFF, matching the DNG SDK's stream format.) BaselineExposure is applied outside that branch so it runs exactly once either way.
- **EXIF / TIFF Orientation** (tag 0x0112) is applied last, swapping width and height for orientations 5 – 8, so portrait shots load upright.
- Only iPhone ProRAW files have been tested; other cameras' DNGs take the same path untested.

#### Fujifilm RAF
Renders X-Trans and Bayer sensor files with camera-JPEG-style color.

- **Compressed RAF is supported.** The decoder implements Fujifilm's **14-bit lossless** compression directly: a block-size table followed by per-block bitstreams each starting on a 16-byte boundary, every block covering a 6-pixel-wide vertical strip decoded in 6-line groups (matching the 6 × 6 X-Trans repeat), with residuals in a Golomb–Rice code whose parameter adapts to per-color-class running magnitude statistics. **Lossy and 12-bit variants are not supported** and return a clear, actionable error asking the user to shoot Uncompressed or convert to DNG — as does a file whose data survives decode but fails a plausibility check. Compression is detected from the TIFF flag **OR** a structural heuristic run over the strip bytes, because some compressed files report a byte count matching the uncompressed size.
- **CFA phase auto-detection**: for X-Trans the 6 × 6 pattern's row/column shift is measured from the image data and the base pattern rotated to match, rather than trusting the crop offsets.
- **White balance uses the camera's as-shot multipliers** from makernote tag 0xF00D when present, expressed as `[r/g, 1, b/g]`. **Gray-world auto-WB is only the fallback** for third-party writers that omit the tag.
- **Demosaic**: X-Trans uses an edge-directed **Markesteijn-style 3-pass** demosaic that reconstructs green from four directional candidates weighted by local homogeneity, then fills R/B from the smooth color-difference planes; Bayer uses bilinear. A nearest-neighbour X-Trans mode exists for diagnostics but is reachable only from Rust tests — the browser entry point always takes the defaults (Markesteijn, denoise on).
- **Color matrix** is per **sensor generation**, not per body: five hard-coded groups (X100VI / X-T5 / X-H2 / X-S20; the X-T4 / X-Pro3 / X100V era; the X-T3 / X-Pro2 / X100F era; the X-T2 / X-Pro1 / X100S era; and GFX), with the X-Trans IV matrix as the fallback for any unrecognized model. The values are the DNG ColorMatrix1 integers scaled by 1/10000, converted camera → XYZ → sRGB, then **column-scaled ("neutralized")** so neutral input stays neutral.
- **Post-demosaic chain** (all in linear light unless noted): luma **bilateral denoise** (radius 2, range σ 0.03 — bridges sensor grain without touching real edges) → **film-simulation saturation boost** → **1.3× exposure boost** (raw data occupies only ~30 % of the 14-bit range because cameras expose for highlights) → **highlight desaturation** (pixels above 1.0 are blended toward neutral gray so unevenly-clipped channels render white instead of tinted) → **base curve** → sRGB gamma → **capture sharpening** (a mild luma-only unsharp mask at 0.10 strength, chroma untouched to avoid color fringing) → clamp to [0, 1] → EXIF orientation.
- **The film simulation drives both saturation and tone**, read from makernote tag 0x1401: Velvia → 1.40× saturation, Provia → 1.20×, Astia and the portrait variants → 1.12×, Classic Chrome → 1.15×, Pro Neg → 1.10×. The same tag picks the base curve (Provia / Astia / Velvia / Classic Chrome). **Provia is the fallback** when the tag is missing or unrecognized — not Velvia.
- **DR400 is compiled in but unreachable.** The curve is defined and documented, but the film-mode mapping never returns it, and the dynamic-range makernote tag (0x1400) is parsed into the metadata struct and then never read. No file can currently select it.
- **The 49-body white-balance preset table is dead data.** 341 measured `[R, G, B]` presets across 49 Fujifilm bodies and their illuminants ship compiled into the binary with lookup helpers — and **nothing calls them.** Outside the module's own unit tests there is not one reference, so the table never influences a decode; white balance comes from the as-shot tag or gray-world as described above.
- **DCP profile support is parse-only.** A complete Adobe DNG Color Profile reader (color matrices, tone curve, HSL maps) exists and has **no consumers** — there is no UI to select a profile and nothing routes one into the color stage. Its own module notes list exactly that wiring as outstanding work.
