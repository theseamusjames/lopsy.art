import { describe, expect, it } from 'vitest';
import { headingId, parsePostBody, postImages, readingMinutes, renderPostBody } from './post-body';
import type { PostImage } from './types';

const renderImg = (image: PostImage): string => `<img src="${image.src}" alt="${image.alt}">`;

function render(markdown: string): string {
  const { blocks, errors } = parsePostBody(markdown);
  expect(errors).toEqual([]);
  return renderPostBody(blocks, renderImg);
}

describe('parsePostBody', () => {
  it('keeps prose between special blocks and renders it with the shared subset', () => {
    const html = render('Intro **bold**.\n\n- one\n- two\n\n## Next\n\nMore text.');
    expect(html).toContain('<p>Intro <strong>bold</strong>.</p>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<p>More text.</p>');
  });

  it('gives headings unique anchor ids and keeps a trailing # that is part of the text', () => {
    const { blocks } = parsePostBody('## Undo *snapshots*\n\n### Undo snapshots\n\n## Why C#\n\n#### Closing ##');
    expect(blocks).toEqual([
      { kind: 'heading', level: 2, text: 'Undo *snapshots*', id: 'undo-snapshots' },
      { kind: 'heading', level: 3, text: 'Undo snapshots', id: 'undo-snapshots-2' },
      { kind: 'heading', level: 2, text: 'Why C#', id: 'why-c' },
      { kind: 'heading', level: 4, text: 'Closing', id: 'closing' },
    ]);
    expect(render('## Undo *snapshots*')).toBe(
      '<h2 id="undo-snapshots"><a class="heading-anchor" href="#undo-snapshots">Undo <em>snapshots</em></a></h2>',
    );
  });

  it('rejects # and ##### headings with the file line number', () => {
    expect(parsePostBody('Text\n\n# Title', 10).errors).toEqual([
      'Line 12: use `## ` or deeper; the page title comes from `title`.',
    ]);
    expect(parsePostBody('##### Deep').errors).toEqual(['Line 1: headings go down to `####`.']);
  });

  it('keeps fenced code verbatim and escaped, including Markdown-looking lines', () => {
    const md = '```rust\nfn a() {\n    // ## not a heading\n    let x = 1 < 2;\n}\n```';
    expect(render(md)).toBe(
      '<div class="code-block" data-lang="rust"><pre tabindex="0"><code class="language-rust">fn a() {\n    // ## not a heading\n    let x = 1 &lt; 2;\n}</code></pre></div>',
    );
  });

  it('supports tilde fences, longer fences and blocks without a language', () => {
    expect(render('~~~\n```\ninner\n```\n~~~')).toBe('<div class="code-block"><pre tabindex="0"><code>```\ninner\n```</code></pre></div>');
    expect(render('````\na\n```\n````')).toBe('<div class="code-block"><pre tabindex="0"><code>a\n```</code></pre></div>');
  });

  it('wraps prompt and prose blocks instead of scrolling them', () => {
    expect(render('```markdown\nA long line\n```')).toBe(
      '<div class="code-block is-wrapped" data-lang="markdown"><pre tabindex="0"><code class="language-markdown">A long line</code></pre></div>',
    );
    expect(render('```text\na\n```')).toContain('class="code-block is-wrapped"');
    expect(render('```ts\na\n```')).toContain('<div class="code-block" data-lang="ts">');
  });

  it('reports an unclosed code fence', () => {
    expect(parsePostBody('Intro\n\n```ts\nconst a = 1;').errors).toEqual([
      'Line 3: code block is never closed with ```.',
    ]);
  });

  it('turns a standalone image into a figure with an optional caption', () => {
    expect(render('![A diagram](pipe.webp "The **compositor** pipeline")')).toBe(
      '<figure class="post-figure"><img src="pipe.webp" alt="A diagram"><figcaption>The <strong>compositor</strong> pipeline</figcaption></figure>',
    );
    expect(render('![A diagram](pipe.webp)')).toBe('<figure class="post-figure"><img src="pipe.webp" alt="A diagram"></figure>');
  });

  it('turns consecutive image lines into a captionless gallery', () => {
    const { blocks, errors } = parsePostBody('![One](1.webp)\n![Two](2.webp)\n![Three](3.webp)\n\n![Solo](4.webp)');
    expect(errors).toEqual([]);
    expect(blocks).toEqual([
      { kind: 'gallery', images: [{ src: '1.webp', alt: 'One' }, { src: '2.webp', alt: 'Two' }, { src: '3.webp', alt: 'Three' }], caption: '' },
      { kind: 'figure', image: { src: '4.webp', alt: 'Solo' }, caption: '' },
    ]);
    expect(renderPostBody(blocks.slice(0, 1), renderImg)).toBe(
      '<figure class="post-gallery-figure"><div class="post-gallery"><div class="post-gallery-scroller" role="region" aria-label="Image gallery" tabindex="0"><ul>'
        + '<li><img src="1.webp" alt="One"></li><li><img src="2.webp" alt="Two"></li><li><img src="3.webp" alt="Three"></li>'
        + '</ul></div></div></figure>',
    );
  });

  it('shows a caption from any one gallery image under the whole strip', () => {
    const { blocks } = parsePostBody('![One](1.webp)\n![Two](2.webp)\n![Three](3.webp "Every step of the [tutorial](/tutorials/x/).")');
    expect(blocks[0]).toMatchObject({ kind: 'gallery', caption: 'Every step of the [tutorial](/tutorials/x/).' });
    expect(renderPostBody(blocks, renderImg)).toMatch(
      /<\/ul><\/div><\/div><figcaption>Every step of the <a href="\/tutorials\/x\/">tutorial<\/a>\.<\/figcaption><\/figure>$/,
    );
  });

  it('reports a gallery image without alt text on its own line', () => {
    expect(parsePostBody('Intro\n\n![One](1.webp)\n![](2.webp)').errors).toEqual(['Line 4: image "2.webp" is missing alt text.']);
  });

  it('requires alt text on images', () => {
    expect(parsePostBody('![](pipe.webp)').errors).toEqual(['Line 1: image "pipe.webp" is missing alt text.']);
  });

  it('renders pipe tables with alignment and inline formatting', () => {
    const html = render('| Size | Time |\n| :--- | ---: |\n| `4K` | 7.8 ms |\n| 2K | a \\| b |');
    expect(html).toBe(
      '<div class="table-scroll"><table><thead><tr><th class="align-left">Size</th><th class="align-right">Time</th></tr></thead>'
        + '<tbody><tr><td class="align-left"><code>4K</code></td><td class="align-right">7.8 ms</td></tr>\n'
        + '<tr><td class="align-left">2K</td><td class="align-right">a | b</td></tr></tbody></table></div>',
    );
  });

  it('treats a pipe line without a separator row as prose', () => {
    expect(render('| not a table |')).toBe('<p>| not a table |</p>');
  });

  it('renders --- as a rule but leaves list items alone', () => {
    const html = render('Above\n\n---\n\n- item');
    expect(html).toMatch(/^<p>Above<\/p>\n<div class="dot-break" role="separator"><svg class="dot-rule"[^]*<\/svg><\/div>\n<ul><li>item<\/li><\/ul>$/);
  });

  it('escapes raw HTML in prose', () => {
    expect(render('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });
});

describe('headingId', () => {
  it('slugs the plain text and falls back for symbol-only headings', () => {
    expect(headingId('The `u_hasSelection` uniform')).toBe('the-u-hasselection-uniform');
    expect(headingId('???')).toBe('section');
  });
});

describe('postImages', () => {
  it('lists figure and gallery images in order', () => {
    const { blocks } = parsePostBody('![a](1.webp)\n\ntext\n\n![b](2.webp)\n![c](3.webp)');
    expect(postImages(blocks).map((image) => image.src)).toEqual(['1.webp', '2.webp', '3.webp']);
  });
});

describe('readingMinutes', () => {
  it('counts prose at 230 words a minute, ignoring code, and never says 0', () => {
    const prose = Array.from({ length: 460 }, () => 'word').join(' ');
    const code = `\`\`\`\n${Array.from({ length: 2000 }, () => 'token').join(' ')}\n\`\`\``;
    expect(readingMinutes(parsePostBody(`${prose}\n\n${code}`).blocks)).toBe(2);
    expect(readingMinutes(parsePostBody('Short.').blocks)).toBe(1);
  });
});
