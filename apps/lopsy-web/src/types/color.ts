export interface Color {
  readonly r: number; // 0-255
  readonly g: number; // 0-255
  readonly b: number; // 0-255
  readonly a: number; // 0-1
}

export interface HSLColor {
  readonly h: number; // 0-360
  readonly s: number; // 0-100
  readonly l: number; // 0-100
  readonly a: number; // 0-1
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  /** Only valid on group layers. Children blend directly into the parent
   *  composite as if the group folder were invisible — the group acts as an
   *  organisational container only. Matches Photoshop's default group mode. */
  | 'pass-through';
