import type {
  Tutorial,
  TutorialFrontmatter,
  TutorialImage,
  TutorialLevel,
  TutorialStep,
} from './types';
import { DESCRIPTION_MAX, DESCRIPTION_MIN, TITLE_MAX } from './site-config';

export interface ParseResult {
  tutorial: Tutorial | null;
  errors: string[];
  warnings: string[];
}

const LEVELS: readonly TutorialLevel[] = ['Beginner', 'Intermediate', 'Advanced'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PUBLISHED = /^(\d{4}-\d{2}-\d{2})(?:[ T]([01]\d|2[0-3]):([0-5]\d))?$/;
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Parses `key: value` lines. Values stay raw strings; typing happens in `readFrontmatter`. */
export function parseFrontmatterBlock(block: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
    fields.set(key, value);
  }
  return fields;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isValidDate(value: string): boolean {
  return ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/**
 * `published` may carry an optional UTC time (`2026-09-25 18:40`) so tutorials
 * released on the same day still list newest first. Only the date is shown.
 */
function readPublished(raw: string): { date: string; sortKey: string } {
  const match = PUBLISHED.exec(raw);
  if (!match) return { date: raw, sortKey: raw };
  const date = match[1] ?? '';
  return { date, sortKey: `${date}T${match[2] ?? '00'}:${match[3] ?? '00'}` };
}

function readFrontmatter(
  fields: Map<string, string>,
  errors: string[],
  warnings: string[],
): TutorialFrontmatter {
  const title = fields.get('title') ?? '';
  const description = fields.get('description') ?? '';
  const { date: published, sortKey: publishedAt } = readPublished(fields.get('published') ?? '');
  const updated = fields.get('updated') || published;
  const levelRaw = fields.get('level') ?? '';
  const durationRaw = fields.get('duration') ?? '';
  const coverSrc = fields.get('cover') ?? '';
  const coverAlt = fields.get('coverAlt') ?? '';

  if (!title) errors.push('Missing `title`.');
  if (title.length > TITLE_MAX) {
    warnings.push(`\`title\` is ${title.length} characters; search results truncate after ~${TITLE_MAX}.`);
  }
  if (!description) errors.push('Missing `description`.');
  if (description && (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX)) {
    warnings.push(
      `\`description\` is ${description.length} characters; aim for ${DESCRIPTION_MIN}–${DESCRIPTION_MAX}.`,
    );
  }
  if (!isValidDate(published)) errors.push('`published` must be a date in YYYY-MM-DD form, optionally followed by a UTC time as HH:MM.');
  if (!isValidDate(updated)) errors.push('`updated` must be a date in YYYY-MM-DD form.');
  if (isValidDate(published) && isValidDate(updated) && updated < published) {
    errors.push('`updated` is earlier than `published`.');
  }

  const level = LEVELS.find((l) => l.toLowerCase() === levelRaw.toLowerCase()) ?? null;
  if (levelRaw && !level) errors.push(`\`level\` must be one of: ${LEVELS.join(', ')}.`);

  const duration = durationRaw ? Number(durationRaw.replace(/\s*min(utes)?$/i, '')) : null;
  if (duration !== null && (!Number.isInteger(duration) || duration <= 0)) {
    errors.push('`duration` must be a whole number of minutes.');
  }

  if (coverSrc && !coverAlt) errors.push('`cover` needs a `coverAlt` description.');

  const tags = splitList(fields.get('tags')).map((tag) => tag.toLowerCase());
  if (tags.length === 0) warnings.push('No `tags`; related tutorials are matched by tag.');

  return {
    title,
    description,
    published,
    publishedAt,
    updated,
    level,
    duration: duration !== null && Number.isInteger(duration) && duration > 0 ? duration : null,
    tags,
    related: splitList(fields.get('related')),
    cover: coverSrc ? { src: coverSrc, alt: coverAlt } : null,
    isDraft: fields.get('draft') === 'true',
  };
}

function parseStep(heading: string, lines: string[], index: number, errors: string[]): TutorialStep | null {
  const label = `Step ${index + 1} ("${heading}")`;
  const images: TutorialImage[] = [];
  const bodyLines: string[] = [];

  for (const line of lines) {
    const match = IMAGE_LINE.exec(line.trim());
    if (match) {
      images.push({ alt: (match[1] ?? '').trim(), src: match[2] ?? '' });
    } else {
      bodyLines.push(line);
    }
  }

  const body = bodyLines.join('\n').trim();
  const image = images[0];
  if (!heading) errors.push(`Step ${index + 1} has an empty heading.`);
  if (images.length !== 1) errors.push(`${label} needs exactly one image, found ${images.length}.`);
  if (image && !image.alt) errors.push(`${label} image is missing alt text.`);
  if (!body) errors.push(`${label} has no text.`);
  if (!image) return null;

  return { title: heading, id: `step-${index + 1}`, image, body };
}

/**
 * Parses a tutorial's `index.md`:
 *
 *   ---
 *   frontmatter
 *   ---
 *   intro paragraphs
 *   ## Step heading
 *   ![alt](image.webp)
 *   step text
 */
export function parseTutorial(slug: string, source: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalized = source.replace(/\r\n?/g, '\n');

  if (!SLUG_PATTERN.test(slug)) {
    errors.push(`Directory name "${slug}" must be lowercase words separated by hyphens.`);
  }

  const frontmatterMatch = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!frontmatterMatch) {
    return { tutorial: null, errors: [...errors, 'Missing `---` frontmatter block at the top.'], warnings };
  }

  const frontmatter = readFrontmatter(parseFrontmatterBlock(frontmatterMatch[1] ?? ''), errors, warnings);
  const content = normalized.slice(frontmatterMatch[0].length);
  const [intro = '', ...sections] = content.split(/^## /m);

  if (/^# /m.test(content)) {
    errors.push('Use `## ` for step headings only; the page title comes from `title`.');
  }
  if (sections.length === 0) errors.push('A tutorial needs at least one `## ` step.');

  const steps = sections
    .map((section, index) => {
      const [headingLine = '', ...lines] = section.split('\n');
      return parseStep(headingLine.trim(), lines, index, errors);
    })
    .filter((step): step is TutorialStep => step !== null);

  if (errors.length > 0) return { tutorial: null, errors, warnings };

  return {
    tutorial: { ...frontmatter, slug, intro: intro.trim(), steps },
    errors,
    warnings,
  };
}
