import type { LibraryView } from '@lopsy/photos-core/library/types';
import type { SavedSearch } from '@lopsy/photos-core/search/rules';
import { useLibraryView, useSavedSearches } from '../../app/hooks';
import { useUi } from '../../app/store';
import type { Collection } from '../../library/asset-query';
import { datePrefixLabel } from '../../library/finding';

/** What the grid is showing, in words: its heading and the page title. */
export function collectionTitle(collection: Collection, view: LibraryView, saved: readonly SavedSearch[]): string {
  switch (collection.kind) {
    case 'all':
      return 'All photos';
    case 'recent':
      return 'Recent imports';
    case 'set-aside':
      return 'Set aside';
    case 'album':
      return view.albums.get(collection.albumId)?.name ?? 'Album';
    case 'keyword':
      return collection.keyword;
    case 'date':
      return datePrefixLabel(collection.prefix);
    case 'import':
      return 'Imported together';
    case 'saved':
      return saved.find((x) => x.id === collection.searchId)?.name ?? 'Saved search';
  }
}

export function useCollectionTitle(): string {
  const view = useLibraryView();
  const saved = useSavedSearches();
  const collection = useUi((s) => s.collection);
  return collectionTitle(collection, view, saved);
}
