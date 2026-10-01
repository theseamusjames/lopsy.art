/**
 * Blog posts are long-form and technical, so on top of the tutorial Markdown
 * subset (paragraphs, lists, `>` notes, inline formatting) they get:
 *
 *   `##` / `###` / `####` headings, with anchor ids
 *   fenced code blocks (``` or ~~~, optional language)
 *   images on a line of their own, with an optional "caption"
 *   galleries: two or more image lines with no blank line between them; a
 *     "caption" on any one of them is shown under the whole strip
 *   pipe tables with a `---` separator row
 *   `---` horizontal rules
 */

import { escapeHtml, renderInline, renderMarkdown, stripMarkdown } from '../tutorials/markdown';
import { WORDS_PER_MINUTE } from './blog-config';
import { renderDotRule } from './dot-rule';
import type { PostBlock, PostImage, TableAlign } from './types';

const FENCE_OPEN = /^(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;
const TABLE_SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;

export interface BodyParseResult {
  blocks: PostBlock[];
  errors: string[];
}

export function headingId(text: string): string {
  return stripMarkdown(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function readAlign(cell: string): TableAlign {
  const isLeft = cell.startsWith(':');
  const isRight = cell.endsWith(':');
  if (isLeft && isRight) return 'center';
  if (isRight) return 'right';
  if (isLeft) return 'left';
  return null;
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const next = lines[index + 1]?.trim() ?? '';
  return (lines[index] ?? '').trim().startsWith('|') && TABLE_SEPARATOR.test(next);
}

/**
 * Splits a post body into blocks. Prose between special blocks is kept as raw
 * Markdown. `lineOffset` is the file line the body starts on, for error messages.
 */
export function parsePostBody(markdown: string, lineOffset = 1): BodyParseResult {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: PostBlock[] = [];
  const errors: string[] = [];
  const usedIds = new Map<string, number>();
  let prose: string[] = [];

  const flushProse = (): void => {
    const text = prose.join('\n').trim();
    if (text) blocks.push({ kind: 'prose', markdown: text });
    prose = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    const fence = FENCE_OPEN.exec(trimmed);
    if (fence) {
      flushProse();
      const marker = fence[1] ?? '```';
      const isClose = (candidate: string): boolean => {
        const t = candidate.trim();
        return t.length >= marker.length && t === (marker[0] ?? '`').repeat(t.length);
      };
      const close = lines.findIndex((l, j) => j > i && isClose(l));
      if (close === -1) {
        errors.push(`Line ${i + lineOffset}: code block is never closed with ${marker}.`);
        break;
      }
      blocks.push({ kind: 'code', lang: (fence[2] ?? '').toLowerCase(), code: lines.slice(i + 1, close).join('\n') });
      i = close + 1;
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      flushProse();
      const level = (heading[1] ?? '').length;
      const text = heading[2] ?? '';
      if (level === 1) errors.push(`Line ${i + lineOffset}: use \`## \` or deeper; the page title comes from \`title\`.`);
      if (level > 4) errors.push(`Line ${i + lineOffset}: headings go down to \`####\`.`);
      if (level >= 2 && level <= 4) {
        const base = headingId(text);
        const count = (usedIds.get(base) ?? 0) + 1;
        usedIds.set(base, count);
        blocks.push({ kind: 'heading', level: level as 2 | 3 | 4, text, id: count === 1 ? base : `${base}-${count}` });
      }
      i += 1;
      continue;
    }

    if (IMAGE_LINE.test(trimmed)) {
      flushProse();
      const run: Array<{ image: PostImage; caption: string }> = [];
      for (let match = IMAGE_LINE.exec(trimmed); match; match = IMAGE_LINE.exec((lines[i] ?? '').trim())) {
        const alt = (match[1] ?? '').trim();
        if (!alt) errors.push(`Line ${i + lineOffset}: image "${match[2] ?? ''}" is missing alt text.`);
        run.push({ image: { src: match[2] ?? '', alt }, caption: (match[3] ?? '').trim() });
        i += 1;
      }
      const [first] = run;
      if (run.length === 1 && first) {
        blocks.push({ kind: 'figure', image: first.image, caption: first.caption });
      } else {
        const caption = run.find((item) => item.caption)?.caption ?? '';
        blocks.push({ kind: 'gallery', images: run.map((item) => item.image), caption });
      }
      continue;
    }

    if (RULE.test(trimmed)) {
      flushProse();
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      flushProse();
      const header = splitRow(trimmed);
      const align = splitRow(lines[i + 1] ?? '').map(readAlign);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        rows.push(splitRow(lines[i] ?? ''));
        i += 1;
      }
      blocks.push({ kind: 'table', header, align, rows });
      continue;
    }

    prose.push(line);
    i += 1;
  }
  flushProse();

  return { blocks, errors };
}

export function postImages(blocks: readonly PostBlock[]): PostImage[] {
  return blocks.flatMap((block) => {
    if (block.kind === 'figure') return [block.image];
    if (block.kind === 'gallery') return block.images;
    return [];
  });
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Reading time in whole minutes (at least 1). Code is skimmed, not read, so it is left out. */
export function readingMinutes(blocks: readonly PostBlock[]): number {
  const words = blocks.reduce((total, block) => {
    switch (block.kind) {
      case 'prose':
        return total + countWords(stripMarkdown(block.markdown));
      case 'heading':
        return total + countWords(block.text);
      case 'figure':
        return total + countWords(block.caption);
      case 'table':
        return total + countWords([...block.header, ...block.rows.flat()].join(' '));
      default:
        return total;
    }
  }, 0);
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

function renderTable(block: Extract<PostBlock, { kind: 'table' }>): string {
  const cell = (tag: 'th' | 'td', text: string, index: number): string => {
    const align = block.align[index];
    return `<${tag}${align ? ` class="align-${align}"` : ''}>${renderInline(text)}</${tag}>`;
  };
  const head = `<tr>${block.header.map((text, index) => cell('th', text, index)).join('')}</tr>`;
  const body = block.rows
    .map((row) => `<tr>${block.header.map((_, index) => cell('td', row[index] ?? '', index)).join('')}</tr>`)
    .join('\n');
  return `<div class="table-scroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/** Prompts and prose read better wrapped than scrolled sideways, especially on phones. */
const WRAPPED_LANGUAGES = new Set(['text', 'txt', 'plaintext', 'markdown', 'md', 'prompt']);

function renderCode(block: Extract<PostBlock, { kind: 'code' }>): string {
  const lang = escapeHtml(block.lang);
  const classes = WRAPPED_LANGUAGES.has(block.lang) ? 'code-block is-wrapped' : 'code-block';
  const langAttrs = lang ? ` data-lang="${lang}"` : '';
  const codeClass = lang ? ` class="language-${lang}"` : '';
  // Long blocks scroll inside a capped height, so the <pre> must be focusable for keyboard users.
  return `<div class="${classes}"${langAttrs}><pre tabindex="0"><code${codeClass}>${escapeHtml(block.code)}</code></pre></div>`;
}

/**
 * The scroller is a focusable region so keyboard users can scroll it with the
 * arrow keys; the outer wrapper is where the page script adds prev/next buttons.
 */
function renderGallery(block: Extract<PostBlock, { kind: 'gallery' }>, renderImage: (image: PostImage) => string): string {
  const items = block.images.map((image) => `<li>${renderImage(image)}</li>`).join('');
  const caption = block.caption ? `<figcaption>${renderInline(block.caption)}</figcaption>` : '';
  return `<figure class="post-gallery-figure"><div class="post-gallery"><div class="post-gallery-scroller" role="region" aria-label="Image gallery" tabindex="0"><ul>${items}</ul></div></div>${caption}</figure>`;
}

/** `renderImage` draws the `<img>` so the caller controls URLs and dimensions. */
export function renderPostBody(blocks: readonly PostBlock[], renderImage: (image: PostImage) => string): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'prose':
          return renderMarkdown(block.markdown);
        case 'heading':
          return `<h${block.level} id="${block.id}"><a class="heading-anchor" href="#${block.id}">${renderInline(block.text)}</a></h${block.level}>`;
        case 'code':
          return renderCode(block);
        case 'figure': {
          const caption = block.caption ? `<figcaption>${renderInline(block.caption)}</figcaption>` : '';
          return `<figure class="post-figure">${renderImage(block.image)}${caption}</figure>`;
        }
        case 'gallery':
          return renderGallery(block, renderImage);
        case 'table':
          return renderTable(block);
        case 'rule':
          return `<div class="dot-break" role="separator">${renderDotRule()}</div>`;
      }
    })
    .join('\n');
}
