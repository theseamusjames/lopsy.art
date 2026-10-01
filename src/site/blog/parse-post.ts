import { SLUG_PATTERN, isValidDate, parseFrontmatterBlock, readPublished } from '../tutorials/parse-tutorial';
import { DESCRIPTION_MAX, DESCRIPTION_MIN, TITLE_MAX } from '../tutorials/site-config';
import { parsePostBody, readingMinutes } from './post-body';
import type { Post, PostFrontmatter } from './types';

export interface PostParseResult {
  post: Post | null;
  errors: string[];
  warnings: string[];
}

function readFrontmatter(fields: Map<string, string>, errors: string[], warnings: string[]): PostFrontmatter {
  const title = fields.get('title') ?? '';
  const description = fields.get('description') ?? '';
  const { date: published, sortKey: publishedAt } = readPublished(fields.get('published') ?? '');
  const updated = fields.get('updated') || published;
  const heroSrc = fields.get('hero') ?? '';
  const heroAlt = fields.get('heroAlt') ?? '';
  const shareSrc = fields.get('share') ?? '';
  const shareAlt = fields.get('shareAlt') || heroAlt;

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
  if (heroSrc && !heroAlt) errors.push('`hero` needs a `heroAlt` description.');
  if (shareSrc && !shareAlt) errors.push('`share` needs a `shareAlt` (or `heroAlt`) description.');

  const tags = (fields.get('tags') ?? '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);

  return {
    title,
    description,
    summary: fields.get('summary') || description,
    published,
    publishedAt,
    updated,
    author: fields.get('author') || null,
    tags,
    hero: heroSrc ? { src: heroSrc, alt: heroAlt } : null,
    share: shareSrc ? { src: shareSrc, alt: shareAlt } : null,
    isDraft: fields.get('draft') === 'true',
  };
}

/**
 * Parses a post's `index.md`: a `---` frontmatter block, then the article
 * body in Markdown (see post-body.ts for what it supports).
 */
export function parsePost(slug: string, source: string): PostParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalized = source.replace(/\r\n?/g, '\n');

  if (!SLUG_PATTERN.test(slug)) {
    errors.push(`Directory name "${slug}" must be lowercase words separated by hyphens.`);
  }

  const frontmatterMatch = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!frontmatterMatch) {
    return { post: null, errors: [...errors, 'Missing `---` frontmatter block at the top.'], warnings };
  }

  const frontmatter = readFrontmatter(parseFrontmatterBlock(frontmatterMatch[1] ?? ''), errors, warnings);
  const bodyStartLine = frontmatterMatch[0].split('\n').length;
  const body = parsePostBody(normalized.slice(frontmatterMatch[0].length), bodyStartLine);
  errors.push(...body.errors);
  if (body.blocks.length === 0) errors.push('The post has no body.');

  if (errors.length > 0) return { post: null, errors, warnings };

  return {
    post: { ...frontmatter, slug, blocks: body.blocks, readingMinutes: readingMinutes(body.blocks) },
    errors,
    warnings,
  };
}
