/**
 * Document-level color mode (Photoshop's Image > Mode).
 *
 * - `rgb`      — full RGBA working space (default).
 * - `grayscale`— pixels constrained to R=G=B; faithful in the RGB compositor.
 * - `indexed`  — pixels snapped to a ≤256-color document palette; flat document.
 * - `lab`      — layer textures store encoded CIELAB; native Lab blending.
 * - `cmyk`     — layer textures store ink (R=C, G=M, B=Y, A=K); flat document.
 *
 * Grayscale/Indexed keep RGBA textures with constrained values, so they need
 * no engine rendering changes. Lab/CMYK are native modes handled by the engine
 * (`doc_color_mode` uniform + display decode).
 */
export type DocumentColorMode = 'rgb' | 'grayscale' | 'indexed' | 'lab' | 'cmyk';

/**
 * Known limits of the current implementation:
 *
 * - CMYK documents are flat. All four channels carry ink (R=C, G=M, B=Y and
 *   the alpha slot holds K), so nothing is left to composite with. Supporting
 *   layers means a second texture per layer to carry alpha, mirrored through
 *   every layer operation (upload, duplicate, rotate, scale, crop, clipboard,
 *   undo snapshots) plus dual-target dab rendering.
 * - CMYK conversion is a naive ink model with no ICC profile, so it
 *   approximates print rather than matching it.
 * - Lab is stored 8-bit, matching Photoshop's 8-bit Lab. a/b quantization
 *   costs a few sRGB units at saturated gamut corners.
 * - PSD export writes RGB for every mode except Grayscale.
 */
