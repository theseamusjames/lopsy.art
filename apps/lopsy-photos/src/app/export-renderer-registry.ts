/**
 * Where export finds its renderer. Rendering needs the engine, which the
 * Edit view owns; it registers a factory here once it has loaded. Until
 * then exports fail with a clear message instead of writing nothing.
 */

import type { ExportRenderer } from '@lopsy/photos-core/export/types';

export type ExportRendererFactory = () => ExportRenderer | Promise<ExportRenderer>;

let factory: ExportRendererFactory | null = null;

export const NO_RENDERER_MESSAGE = 'Exporting needs the editing engine, which has not loaded in this build yet.';

export function setExportRendererFactory(next: ExportRendererFactory | null): void {
  factory = next;
}

export function hasExportRenderer(): boolean {
  return factory !== null;
}

/** The registered renderer, or one that fails every photo with NO_RENDERER_MESSAGE. */
export async function getExportRenderer(): Promise<ExportRenderer> {
  if (factory !== null) return factory();
  return {
    render: () => Promise.reject(new Error(NO_RENDERER_MESSAGE)),
  };
}
