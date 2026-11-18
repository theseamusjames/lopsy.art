import type { LibraryView } from '../types';

/** The view as sorted plain data, for comparing views from different devices. */
export function canonicalView(view: LibraryView): unknown {
  const sorted = <T>(map: ReadonlyMap<string, T>) => [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    assets: sorted(view.assets),
    versions: sorted(view.versions),
    albums: sorted(view.albums),
    settings: sorted(view.settings),
  };
}
