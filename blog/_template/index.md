---
# Copy this folder to blog/<your-slug>/ — the folder name becomes the URL:
# https://lopsy.art/blog/<your-slug>/  (lowercase words joined by hyphens).
# Lines starting with # are comments. See blog/README.md for the full guide.

# Shown as the page <h1> and in search results. Aim for 60 characters or fewer.
title: Your Post Title

# The search-result snippet and the lede under the title. 50–160 characters.
description: One or two sentences on what the post covers and why an engineer would want to read it.

# Optional. The blurb on the blog list and the subheadline under the title,
# which can run longer than the description. Defaults to the description.
summary:

# YYYY-MM-DD. Bump `updated` when you meaningfully revise the post.
# `published` can end with a UTC time (2026-01-01 14:30) so posts released the
# same day still list newest first. Only the date is shown on the page.
published: 2026-01-01
updated: 2026-01-01

# Optional. Shown in the byline, the feed and structured data.
author:

# Comma-separated, lowercase. Used for article tags in the page metadata and feed.
tags: rendering, webgl

# Optional. A large image shown under the title, as the thumbnail on the blog
# list and as the social share image. Use a JPEG around 1600 px wide (roughly
# 1.9:1 suits link previews; some networks won't show WebP). Without it the
# site-wide Lopsy image is used for shares.
hero:
heroAlt:

# Optional. A 1200×630 JPEG for link previews when the hero isn't that shape
# (a square hero, say). shareAlt defaults to heroAlt.
share:
shareAlt:

# Drafts appear in `npm run dev` but are left out of production builds.
draft: true
---

Open with the problem. The title and description are shown above this, so
start with the substance.

## A section heading

Use `## ` for sections and `### ` / `#### ` below them. Every heading gets an
anchor link, so readers can share `/blog/your-slug/#a-section-heading`.

```rust
fn main() {
    println!("Fenced code blocks keep their whitespace.");
}
```

![What the image shows, for screen readers](diagram.webp "An optional caption")

| Column | Right-aligned |
| --- | ---: |
| Pipe tables | 1.0 ms |
