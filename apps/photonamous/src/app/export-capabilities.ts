/**
 * What the engine can export. 16-bit TIFF needs the engine's `exportTiff16`,
 * which this build may not have yet; the Export dialog offers TIFF only
 * when it does.
 */

let tiff: Promise<boolean> | null = null;

/** Whether the engine in this build writes 16-bit TIFF. Loads the engine module once. */
export function tiffExportAvailable(): Promise<boolean> {
  tiff ??= import('@lopsy/engine-pkg/lopsy_wasm').then(
    (engine) => 'exportTiff16' in engine,
    () => false,
  );
  return tiff;
}
