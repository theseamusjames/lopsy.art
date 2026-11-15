/**
 * Document-level color mode (Photoshop's Image > Mode).
 *
 * - `rgb`      — full RGBA working space (default).
 * - `grayscale`— pixels constrained to R=G=B; faithful in the RGB compositor.
 * - `indexed`  — pixels snapped to a ≤256-color document palette; flat document.
 * - `lab`      — layer textures store encoded CIELAB; native Lab blending.
 * - `cmyk`     — sRGB pixels edited in C/M/Y/K units; gamut clamp is a no-op
 *                until an ICC profile lands (see the note below).
 *
 * Only Lab stores encoded pixels; every other mode is backed by sRGB. The
 * engine's `doc_color_mode` uniform and display decode exist for Lab alone.
 */
export type DocumentColorMode = 'rgb' | 'grayscale' | 'indexed' | 'lab' | 'cmyk';

/**
 * Known limits of the current implementation:
 *
 * - CMYK does not yet change how anything renders. The naive ink model is a
 *   bijection with sRGB — the round trip is exactly lossless across the whole
 *   cube — so there is no gamut to clip and no visible difference from RGB.
 *   A real difference needs profile-based conversion with ink limits.
 * - CMYK cannot store ink channels natively: the paint pipeline owns the alpha
 *   channel (dabs write coverage there and premultiply by it), so there is no
 *   fourth channel free for black. Native ink storage would need a second
 *   texture per layer mirrored through every layer operation.
 * - Lab is stored 8-bit, matching Photoshop's 8-bit Lab. a/b quantization
 *   costs a few sRGB units at saturated gamut corners.
 * - PSD export writes RGB for every mode except Grayscale.
 */
