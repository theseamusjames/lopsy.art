/**
 * The small Markdown subset tutorials are written in. Deliberately minimal —
 * anything not listed here renders as literal text:
 *
 *   Blocks: paragraphs, `- ` bullet lists, `1. ` numbered lists, `> ` notes
 *   Inline: **bold**, *italic*, `code`, [links](/url), [[Ctrl+Z]] key caps
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

const SAFE_URL = /^(https?:\/\/|mailto:|\/|#|\.\.?\/|[\w-]+(\.[\w-]+)*(\/|$|#|\?))/i;

export function isSafeUrl(url: string): boolean {
  return SAFE_URL.test(url) && !/^\s*javascript:/i.test(url);
}

function renderLink(text: string, url: string): string {
  if (!isSafeUrl(url)) return text;
  const isExternal = /^https?:\/\//i.test(url) && !url.startsWith('https://lopsy.art');
  const rel = isExternal ? ' rel="noopener"' : '';
  return `<a href="${url}"${rel}>${text}</a>`;
}

export function renderInline(markdown: string): string {
  const codeSpans: string[] = [];
  const withoutCode = markdown.replace(/`([^`]+)`/g, (_, code: string) => {
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return `\uE000${codeSpans.length - 1}\uE000`;
  });

  return escapeHtml(withoutCode)
    .replace(/\[\[([^\]]+)\]\]/g, (_, keys: string) =>
      keys.split('+').map((key) => `<kbd>${key.trim()}</kbd>`).join('+'),
    )
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text: string, url: string) => renderLink(text, url))
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/\uE000(\d+)\uE000/g, (_, index: string) => codeSpans[Number(index)] ?? '');
}

type BlockKind = 'p' | 'ul' | 'ol' | 'note';

function blockKind(line: string): BlockKind {
  if (/^[-*]\s+/.test(line)) return 'ul';
  if (/^\d+\.\s+/.test(line)) return 'ol';
  if (/^>\s?/.test(line)) return 'note';
  return 'p';
}

function renderBlock(kind: BlockKind, lines: string[]): string {
  switch (kind) {
    case 'ul':
    case 'ol': {
      const items = lines.map((line) => `<li>${renderInline(line.replace(/^([-*]|\d+\.)\s+/, ''))}</li>`);
      return `<${kind}>${items.join('')}</${kind}>`;
    }
    case 'note': {
      const text = lines.map((line) => line.replace(/^>\s?/, '')).join(' ');
      return `<aside class="note">${renderInline(text)}</aside>`;
    }
    case 'p':
      return `<p>${renderInline(lines.join(' '))}</p>`;
  }
}

/** Renders a chunk of Markdown to HTML, one block per blank-line-separated group. */
export function renderMarkdown(markdown: string): string {
  const html: string[] = [];
  const groups = markdown.trim().split(/\n\s*\n/);

  for (const group of groups) {
    const lines = group.split('\n').map((line) => line.trim()).filter(Boolean);
    let current: { kind: BlockKind; lines: string[] } | null = null;

    for (const line of lines) {
      const kind = blockKind(line);
      const isContinuation = current !== null && (current.kind === kind || kind === 'p');
      if (current && isContinuation) {
        if (kind === 'p' && current.kind !== 'p') {
          const last = current.lines.length - 1;
          current.lines[last] = `${current.lines[last]} ${line}`;
        } else {
          current.lines.push(line);
        }
        continue;
      }
      if (current) html.push(renderBlock(current.kind, current.lines));
      current = { kind, lines: [line] };
    }
    if (current) html.push(renderBlock(current.kind, current.lines));
  }

  return html.join('\n');
}

/** Plain-text version of inline Markdown, for meta tags and structured data. */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^\s*([-*]|\d+\.|>)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
