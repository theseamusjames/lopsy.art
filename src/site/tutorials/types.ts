export type TutorialLevel = 'Beginner' | 'Intermediate' | 'Advanced';

export interface TutorialImage {
  /** Path relative to the tutorial's directory, e.g. `01-open.webp`. */
  src: string;
  alt: string;
}

export interface TutorialStep {
  title: string;
  /** Anchor id, e.g. `step-1`. */
  id: string;
  image: TutorialImage;
  /** Markdown source of the blurb (without the image line). */
  body: string;
}

export interface TutorialFrontmatter {
  title: string;
  description: string;
  /** ISO date, YYYY-MM-DD. */
  published: string;
  /** `YYYY-MM-DDTHH:MM` (UTC), for ordering. The time is `00:00` when `published` gives none. */
  publishedAt: string;
  /** ISO date, YYYY-MM-DD. Defaults to `published`. */
  updated: string;
  level: TutorialLevel | null;
  /** Minutes. */
  duration: number | null;
  tags: string[];
  related: string[];
  cover: TutorialImage | null;
  isDraft: boolean;
}

export interface Tutorial extends TutorialFrontmatter {
  slug: string;
  /** Markdown source of everything between the frontmatter and the first step. */
  intro: string;
  steps: TutorialStep[];
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface SourceTutorial {
  slug: string;
  /** Contents of `index.md`. */
  source: string;
  /** Every other file in the tutorial directory, keyed by file name. */
  assets: Map<string, Uint8Array>;
}
