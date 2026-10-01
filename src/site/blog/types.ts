export interface PostImage {
  /** File name next to the post's `index.md`, e.g. `pipeline.webp`. */
  src: string;
  alt: string;
}

export type TableAlign = 'left' | 'center' | 'right' | null;

export type PostBlock =
  /** Paragraphs, lists and `>` notes, rendered by the shared tutorial Markdown subset. */
  | { kind: 'prose'; markdown: string }
  | { kind: 'heading'; level: 2 | 3 | 4; text: string; id: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'figure'; image: PostImage; caption: string }
  /** Two or more image lines in a row: a sideways-scrolling strip with one optional caption under it. */
  | { kind: 'gallery'; images: PostImage[]; caption: string }
  | { kind: 'table'; header: string[]; align: TableAlign[]; rows: string[][] }
  | { kind: 'rule' };

export interface PostFrontmatter {
  title: string;
  description: string;
  /** Blurb on the blog list, which has room for more than a search snippet. Defaults to `description`. */
  summary: string;
  /** ISO date, YYYY-MM-DD. */
  published: string;
  /** `YYYY-MM-DDTHH:MM` (UTC), for ordering. The time is `00:00` when `published` gives none. */
  publishedAt: string;
  /** ISO date, YYYY-MM-DD. Defaults to `published`. */
  updated: string;
  /** Byline. Falls back to the site name in structured data and the feed. */
  author: string | null;
  tags: string[];
  /** Shown large under the post header and as the list thumbnail; the social share image unless `share` is set. */
  hero: PostImage | null;
  /** Link-preview image (ideally 1200×630) when the hero's shape doesn't suit one. */
  share: PostImage | null;
  isDraft: boolean;
}

export interface Post extends PostFrontmatter {
  slug: string;
  blocks: PostBlock[];
  /** Whole minutes, at least 1. Code blocks are not counted. */
  readingMinutes: number;
}

export interface SourcePost {
  slug: string;
  /** Contents of `index.md`. */
  source: string;
  /** Every other file in the post directory, keyed by file name. */
  assets: Map<string, Uint8Array>;
}
