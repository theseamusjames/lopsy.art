---
# Copy this folder to tutorials/<your-slug>/ — the folder name becomes the URL:
# https://lopsy.art/tutorials/<your-slug>/  (lowercase words joined by hyphens).
# Lines starting with # are comments. See tutorials/README.md for the full guide.

# Shown as the page <h1> and in search results. Aim for 60 characters or fewer
# and lead with what the reader will make, e.g. "Remove a Photo Background".
title: Your Tutorial Title

# The search-result snippet and the lede under the title. 50–160 characters.
description: One or two sentences on what the reader will make and which Lopsy tools they will use along the way.

# YYYY-MM-DD. Bump `updated` whenever you meaningfully change the steps.
# `published` can end with a UTC time (2026-01-01 14:30) so tutorials released
# the same day still list newest first. Only the date is shown on the page.
published: 2026-01-01
updated: 2026-01-01

# Optional. One of: Beginner, Intermediate, Advanced.
level: Beginner

# Optional. Rough minutes to complete.
duration: 10

# Comma-separated, lowercase. Related tutorials are matched by shared tags.
tags: photo editing, selections

# Optional. Slugs of tutorials to feature first under "Related tutorials".
# Empty slots are filled automatically by shared tags.
related:

# Optional. The image for list cards and social shares. Defaults to the last
# step's image (usually the finished result). Use a JPEG around 1200×750:
# some social networks won't show WebP link previews.
cover:
coverAlt:

# Optional. The finished result, shown right under the title and date with no
# step text. Defaults to the last step's image. Set it when the last step's
# screenshot isn't the finished piece (an Export dialog, for example).
finished:
finishedAlt:

# Drafts appear in `npm run dev` but are left out of production builds.
draft: true
---

A short introduction: what the reader will make, and why it's worth doing.
Mention any starting image they need. This part is optional — delete it if
the description already says enough.

## Open your image

![Lopsy with a photo of a mountain lake open on the canvas](01-open.webp)

Each `## ` heading starts a new step. Every step needs exactly **one** image
(with alt text describing what the screenshot shows) and at least one
paragraph of text.

Inline formatting: **bold**, *italic*, `code`, [links](/tutorials/), and key
caps like [[Ctrl+Z]] or [[Shift]].

## Make your change

![The Layers panel with a new adjustment layer added above the photo](02-change.webp)

Lists work too:

- Bullet points start with a dash.
- Keep each step to one idea.

1. Numbered lists start with a number and a dot.
2. Use them for sequences inside a step.

> **Tip:** Lines starting with `>` become a highlighted note.

## Export the result

![The Export dialog with PNG selected](03-export.webp)

Finish with the result. The last step's image is used as the cover when
`cover` is left empty, and as the finished image at the top of the page when
`finished` is left empty.
