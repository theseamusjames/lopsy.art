# Tutorials

Step-by-step tutorials published at <https://lopsy.art/tutorials/>. Each one
is a Markdown file plus its screenshots. They're turned into static HTML at
build time. There's no backend and no database, and no JavaScript runs on
the pages.

## Add a tutorial

1. Copy `_template/` to a new folder. The folder name is the URL slug, so use
   lowercase words joined by hyphens: `tutorials/remove-a-background/` is
   published at `/tutorials/remove-a-background/`.
2. Fill in the frontmatter and write the steps in `index.md`. Each `## `
   heading is one step with exactly one image and a short blurb. Don't add a
   "look at the finished result" step: the finished image is shown under the
   title automatically (the last step's image, or `finished` if set).
3. Drop the screenshots next to `index.md` and reference them by file name.
4. Run `npm run dev` and open <http://localhost:5173/tutorials/>. Pages
   reload as you save, and drafts are shown.
5. Remove `draft: true` when it's ready. `npm run build` fails on content
   errors (missing images, alt text, fields, or unknown `related` slugs) and
   warns when a title or description falls outside search-friendly lengths.

Folders starting with `_` are ignored.

## Screenshots

- Use **WebP** (or JPEG) at around **1600px wide**, and keep each file under
  about 200 KB. PNG, JPEG, WebP and GIF are accepted.
- Make the `cover` a **JPEG** (about 1200×750). It's the social share image,
  and some networks won't show WebP link previews.
- Width and height are read from the file and written into the HTML, so
  pages don't jump around while images load.
- Every image needs alt text that describes what the screenshot shows. It's
  read by screen readers and used by image search.
- Number files in step order (`01-open.webp`, `02-select.webp`, ...) so the
  folder stays readable. The names also show up in image URLs, so make
  them descriptive.

## Writing format

Only this Markdown subset is supported. Anything else renders as plain text.

| Syntax | Result |
| --- | --- |
| `**bold**`, `*italic*`, `` `code` `` | Inline emphasis |
| `[text](/tutorials/other-slug/)` | Link. Prefer linking to other tutorials. |
| `[[Ctrl+Shift+Z]]` | Keyboard key caps |
| `- item` / `1. item` | Bullet / numbered list |
| `> **Tip:** text` | Highlighted note |

## What gets generated

- `/tutorials/`: the list page, newest first by `published`. Add a UTC
  time (`published: 2026-09-25 18:40`) when several tutorials share a date;
  without one, same-day tutorials fall back to alphabetical order.
- `/tutorials/<slug>/`: one page per tutorial with breadcrumbs, the finished
  image right under the title and date, the steps,
  a call to action, and up to three related tutorials (the ones listed in
  `related` first, then the ones sharing the most tags).
- `/sitemap.xml`: every tutorial with its `updated` date.

Every page gets a canonical URL, Open Graph and Twitter card tags, and
schema.org JSON-LD (`HowTo` with one `HowToStep` per step, `BreadcrumbList`,
and `CollectionPage`/`ItemList` on the list page).

The generator lives in `src/site/tutorials/`, the page styles in
`src/site/tutorials/tutorials.css`, and the Vite glue in
`scripts/vite-plugin-tutorials.ts`.
