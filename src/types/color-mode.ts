/**
 * Document-level color mode (Photoshop's Image > Mode).
 *
 * - `rgb`      — full RGBA working space (default).
 * - `grayscale`— pixels constrained to R=G=B; faithful in the RGB compositor.
 * - `indexed`  — pixels snapped to a ≤256-color document palette; flat document.
 * - `lab`      — layer textures store encoded CIELAB; native Lab blending.
 * - `cmyk`     — native ink channels (aux alpha texture); ink-space blending.
 *
 * Grayscale/Indexed keep RGBA textures with constrained values, so they need
 * no engine rendering changes. Lab/CMYK are native modes handled by the engine
 * (`doc_color_mode` uniform + display decode).
 */
export type DocumentColorMode = 'rgb' | 'grayscale' | 'indexed' | 'lab' | 'cmyk';
