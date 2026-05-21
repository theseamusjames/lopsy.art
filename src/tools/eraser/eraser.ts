export interface EraserSettings {
  readonly size: number;
  readonly hardness: number;
  readonly opacity: number;
}

export function defaultEraserSettings(): EraserSettings {
  return { size: 10, hardness: 0.8, opacity: 1 };
}
