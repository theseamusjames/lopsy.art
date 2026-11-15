import { describe, expect, it } from 'vitest';
import { escapeHtml, isSafeUrl, renderInline, renderMarkdown, stripMarkdown } from './markdown';

describe('escapeHtml', () => {
  it('escapes markup-significant characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('renderInline', () => {
  it('renders bold, italic and code', () => {
    expect(renderInline('**Bold** and *italic* and `x < y`')).toBe(
      '<strong>Bold</strong> and <em>italic</em> and <code>x &lt; y</code>',
    );
  });

  it('does not format inside code spans', () => {
    expect(renderInline('`**not bold**`')).toBe('<code>**not bold**</code>');
  });

  it('renders key caps', () => {
    expect(renderInline('Press [[Ctrl+Shift+Z]]')).toBe('Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>');
  });

  it('renders internal and external links', () => {
    expect(renderInline('[next](/tutorials/foo/)')).toBe('<a href="/tutorials/foo/">next</a>');
    expect(renderInline('[site](https://example.com)')).toBe(
      '<a href="https://example.com" rel="noopener">site</a>',
    );
  });

  it('drops unsafe link targets but keeps the text', () => {
    expect(renderInline('[click](javascript:alert(1))')).not.toContain('href');
  });

  it('escapes raw HTML', () => {
    expect(renderInline('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('leaves lone asterisks alone', () => {
    expect(renderInline('2 * 3 = 6')).toBe('2 * 3 = 6');
  });
});

describe('isSafeUrl', () => {
  it('accepts http(s), root-relative, anchors and relative paths', () => {
    for (const url of ['https://a.b', 'http://a.b', '/x', '#step-2', './img.webp', 'img.webp']) {
      expect(isSafeUrl(url)).toBe(true);
    }
  });

  it('rejects script and data URLs', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,hi')).toBe(false);
  });
});

describe('renderMarkdown', () => {
  it('splits paragraphs on blank lines and joins wrapped lines', () => {
    expect(renderMarkdown('One\ntwo\n\nThree')).toBe('<p>One two</p>\n<p>Three</p>');
  });

  it('renders bullet and numbered lists', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('joins wrapped list item lines into the item', () => {
    expect(renderMarkdown('- first line\n  continues\n- second')).toBe(
      '<ul><li>first line continues</li><li>second</li></ul>',
    );
  });

  it('renders a paragraph followed directly by a list', () => {
    expect(renderMarkdown('Intro:\n- a')).toBe('<p>Intro:</p>\n<ul><li>a</li></ul>');
  });

  it('renders notes', () => {
    expect(renderMarkdown('> **Tip:** try it\n> twice')).toBe(
      '<aside class="note"><strong>Tip:</strong> try it twice</aside>',
    );
  });

  it('returns an empty string for empty input', () => {
    expect(renderMarkdown('  \n ')).toBe('');
  });
});

describe('stripMarkdown', () => {
  it('reduces formatting to plain text', () => {
    expect(stripMarkdown('Press [[Ctrl+Z]] to **undo** the [last](/x) `step`.\n\n- next')).toBe(
      'Press Ctrl+Z to undo the last step. next',
    );
  });
});

describe('colour swatches', () => {
  it('turns hex code spans into swatches and leaves other code alone', () => {
    const html = renderInline('Fill with `#C8272F`, not `#1` or `rgb(0,0,0)`.');
    expect(html).toContain('<button type="button" data-copy="#C8272F"');
    expect(html).toContain('<code>#1</code>');
    expect(html).toContain('<code>rgb(0,0,0)</code>');
  });

  it('renders a list of named colours as a palette only when asked', () => {
    const markdown = '- Paper `#F2E4C6`\n- Sky `#0E2446` → `#FFC75E`';
    const palette = renderMarkdown(markdown, { shouldRenderPalettes: true });
    expect(palette).toMatch(/^<ul class="palette" aria-label="Palette">/);
    expect(palette.match(/class="swatch-tile"/g)).toHaveLength(3);
    expect(palette).toContain('<div class="palette-colors is-ramp">');
    expect(palette).toContain('<span class="palette-label">Sky</span>');

    expect(renderMarkdown(markdown)).toMatch(/^<ul><li>Paper <button/);
  });

  it('keeps a list as a list when any item is not a named colour', () => {
    const html = renderMarkdown('- Paper `#F2E4C6`\n- Then fill it with `#C8272F` and deselect', { shouldRenderPalettes: true });
    expect(html).toMatch(/^<ul><li>/);
  });
});

