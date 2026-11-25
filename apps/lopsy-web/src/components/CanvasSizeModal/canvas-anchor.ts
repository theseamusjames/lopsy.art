export type AnchorX = 0 | 0.5 | 1;
export type AnchorY = 0 | 0.5 | 1;

export interface CanvasAnchor {
  readonly x: AnchorX;
  readonly y: AnchorY;
}

/** The Canvas Size dialog's anchor grid, row by row from the top-left. */
export const CANVAS_ANCHORS: readonly CanvasAnchor[] = [
  { x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 },
  { x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 },
  { x: 0, y: 1 }, { x: 0.5, y: 1 }, { x: 1, y: 1 },
];

/** How the grid names an anchor: horizontal then vertical, e.g. ['left', 'top']. */
export function anchorWords(pos: CanvasAnchor): readonly [string, string] {
  return [
    pos.x === 0 ? 'left' : pos.x === 0.5 ? 'center' : 'right',
    pos.y === 0 ? 'top' : pos.y === 0.5 ? 'middle' : 'bottom',
  ];
}
