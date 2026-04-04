/** Grayscale alpha map for a custom brush tip (0 = transparent, 255 = full paint). */
export interface BrushTipData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** A saved brush preset with tip shape and stroke parameters. */
export interface BrushPreset {
  readonly id: string;
  readonly name: string;
  /** null = procedural circle (default round brush). */
  readonly tip: BrushTipData | null;
  readonly size: number;
  readonly hardness: number;
  /** Spacing between dabs as a percentage of brush size (1-200). */
  readonly spacing: number;
  /** Random perpendicular offset as a percentage (0-100). */
  readonly scatter: number;
  /** Brush tip rotation in degrees (0-360). */
  readonly angle: number;
  readonly opacity: number;
  readonly flow: number;
  /** true for user-created or imported presets; false for built-in. */
  readonly isCustom: boolean;
}
