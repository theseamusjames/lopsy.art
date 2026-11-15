import type { PathAnchor } from '../tools/path/path';

export interface StoredPath {
  readonly id: string;
  readonly name: string;
  readonly anchors: readonly PathAnchor[];
  readonly closed: boolean;
}
