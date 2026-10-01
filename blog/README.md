# Blog

The technical blog published at <https://lopsy.art/blog/>. Like the
[tutorials](../tutorials/README.md), each post is a Markdown file plus its
images, turned into static HTML at build time. There's no backend, no
database and no client-side JavaScript beyond the optional swatch copier.

## Add a post

1. Copy `_template/` to a new folder. The folder name is the URL slug, so use
   lowercase words joined by hyphens: `blog/gpu-undo-snapshots/` is published
   at `/blog/gpu-undo-snapshots/`.
2. Fill in the frontmatter and write the post in `index.md`.
3. Drop images next to `index.md` and reference them by file name.
4. Run `npm run dev` and open <http://localhost:5173/blog/>. Pages reload as
   you save, and drafts are shown.
5. Remove `draft: true` when it's ready. `npm run build` fails on content
   errors (missing images, alt text or fields, an unclosed code block, a `#`
   heading) and warns when a title or description falls outside
   search-friendly lengths.

Folders starting with `_` are ignored.

## Frontmatter

| Field | |
| --- | --- |
| `title` | Required. The `<h1>` and the search-result title. Aim for 60 characters or fewer. |
| `description` | Required. The lede under the title and the search snippet. 50–160 characters. |
| `summary` | Optional. The blurb on the blog list and the subheadline under the post title, which can run longer than `description`. Defaults to `description`. Inline Markdown works. Every card ends with a "Read more..." link. |
| `published` | Required. `YYYY-MM-DD`, optionally with a UTC time (`2026-10-01 14:30`) to order same-day posts. |
| `updated` | Optional. Defaults to `published`. Shown in the byline when it differs. |
| `author` | Optional. Shown in the byline, the feed and structured data. |
| `tags` | Optional. Comma-separated, lowercase. |
| `share`, `shareAlt` | Optional. The link-preview image and the blog-list thumbnail, for when the hero's shape doesn't suit those, e.g. a square hero. Use a 1200×630 JPEG (1.91:1, what Open Graph recommends). `shareAlt` defaults to `heroAlt`. |
| `hero`, `heroAlt` | Optional. A large image under the header: wider than the text on desktop when it's landscape, the text's width when it's square or portrait, and edge to edge on phones. Also the list thumbnail and the share image unless `share` is set. |
| `draft` | `true` to keep the post out of production builds. |

## Writing format

Everything the [tutorial format](../tutorials/README.md#writing-format)
supports works here (bold, italic, inline code, links, `[[Key]]` caps, lists,
`>` notes, hex swatches). Posts also get:

- **Headings**: `## `, `### ` and `#### `. Each gets an id from its text, so
  `## GPU snapshots` can be linked as `#gpu-snapshots`. Don't use `# `; the
  title comes from the frontmatter.
- **Code blocks**: fenced with three backticks (or tildes), with an optional
  language after the opening fence. The language is shown as a label and each
  block gets a Copy button; there's no syntax highlighting. Blocks marked
  `text`, `markdown`, `md` or `prompt` wrap long lines (best for prompts and
  prose), while everything else scrolls sideways inside its box.
- **Figures**: an image on a line of its own, `![alt text](file.webp)`, with
  an optional caption: `![alt text](file.webp "Caption")`. Alt text is
  required. Images must sit next to `index.md`.
- **Galleries**: two or more image lines with no blank line between them
  become a sideways-scrolling strip of images (alt text is still required).
  Images in a gallery don't get their own captions; put a `"caption"` on any
  one of the lines and it's shown under the whole strip. On desktop it's the width of the text with arrow buttons;
  on phones it runs edge to edge and scrolls by swiping.
- **Tables**: pipe tables with a separator row. Colons in the separator align
  columns: `---:` right, `:---:` centre.
- **Rules**: `---` on a line of its own, drawn as the same spreading dot line that sits under the post byline and the blog heading.

Raw HTML isn't supported; it's escaped and shown as text.

## Images

Use WebP or JPEG at around 1600px wide and keep each file under about 200 KB.
Width and height are read from the file and written into the HTML. Files in a
post folder that nothing references produce a warning and aren't published.

## What gets generated

- `/blog/`: the list page, newest first.
- `/blog/<slug>/`: one page per post with breadcrumbs, a byline with the date
  and reading time, and links to up to three other recent posts.
- `/blog/feed.xml`: an Atom feed with the full text of every post. Every blog
  page links to it with `<link rel="alternate">`, and the site footer
  links to it as "Subscribe via RSS" on every page.
- Each post and the list page are added to `/sitemap.xml`.

Every page gets a canonical URL, Open Graph and Twitter card tags, and
schema.org JSON-LD (`BlogPosting` and `BreadcrumbList` on posts, `Blog` on
the list page).

The generator lives in `src/site/blog/` (it reuses the page layout and
Markdown renderer from `src/site/tutorials/`), the article styles in
`src/site/blog/blog.css`, and the Vite glue in `scripts/vite-plugin-site.ts`.
