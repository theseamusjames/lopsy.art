# Tutorials

Step-by-step tutorials published at <https://lopsy.art/tutorials/>. Each one
is a Markdown file plus its screenshots. They're turned into static HTML at
build time. There's no backend and no database. The only JavaScript is a
small inline script that copies colour swatches.

## Add a tutorial

1. Copy `_template/` to a new folder. The folder name is the URL slug, so use
   lowercase words joined by hyphens: `tutorials/remove-a-background/` is
   published at `/tutorials/remove-a-background/`.
2. Fill in the frontmatter and write the steps in `index.md`. Each `## `
   heading is one step with exactly one image and a short blurb. Don't add a
   "look at the finished result" step: the finished image is shown under the
   title automatically (the last step's image, or `finished` if set).
3. Drop the screenshots next to `index.md` and reference them by file name.
   If you saved the finished piece as a project, put the `.lopsy` file there
   too (named `<slug>.lopsy`) and set `project` in the frontmatter. The page
   then shows a "Follow along" box under the finished image with a button that
   opens the project in the editor.
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
| `` `#C8272F` `` | Colour swatch: a chip of the colour that copies the code when clicked |

### Palettes

A bullet list in the introduction where every item names colours renders as
a swatch panel instead of a list. Each item holds one or more named groups:

```
- Paper `#F2E4C6`, cream ink `#F7ECD3`
- Mustard `#E9A825` / `#F3C65A`
- Sky `#0E2446` → `#6B2F6A` → `#FFC75E`
- Shirt ink `#100C24` (the background, not an ink)
```

Colours joined by `→` become one continuous ramp. A short note may follow the
codes, ideally in parentheses. Start each group with its name. If any item
reads like a sentence ("Teal `#2F6E69` with dots in `#6FB3A8`") the whole list
stays an ordinary list, so write those as separate items.

## What gets generated

- `/tutorials/`: the list page, newest first by `published`. Add a UTC
  time (`published: 2026-09-25 18:40`) when several tutorials share a date;
  without one, same-day tutorials fall back to alphabetical order.
- `/tutorials/<slug>/`: one page per tutorial with breadcrumbs, the finished
  image right under the title and date, the "Follow along" box when it has a
  `project`, the steps,
  a call to action, and up to three related tutorials (the ones listed in
  `related` first, then the ones sharing the most tags).
- `/sitemap.xml`: every tutorial with its `updated` date.

Every page gets a canonical URL, Open Graph and Twitter card tags, and
schema.org JSON-LD (`HowTo` with one `HowToStep` per step, `BreadcrumbList`,
and `CollectionPage`/`ItemList` on the list page).

The "Open Project in Lopsy" button links to `/?open=<project URL>`. On
startup the editor fetches whatever `.lopsy` URL the `open` parameter names
and opens it (`src/io/project-url.ts`). The parameter is deliberately
undocumented in the app itself, with no menu item or dialog.

The generator lives in `src/site/tutorials/`, the page styles in
`src/site/tutorials/tutorials.css`, and the Vite glue in
`scripts/vite-plugin-tutorials.ts`.
