/**
 * The MIME type of a Lopsy layer handed over to be graded: the engine's
 * 16-bit layer blob (`readLayerPixelsLz4U16`), uploaded as it is. It loads
 * through the non-RAW pipeline with a transparent background, so the
 * layer's transparency survives the grade. A module of its own, so the
 * Grade screen can name it without loading the engine.
 */
export const LOPSY_LAYER_MIME = 'application/x-lopsy-layer16';
