# @lopsy/ui

The UI that Lopsy (`apps/lopsy-web`) and Photonamous (`apps/photonamous`)
share, so both speak one visual language. TypeScript and CSS Modules
source, consumed directly by each app's Vite build (no build step of its
own). React is a peer dependency.

New UI that more than one app uses goes here: a component in its own
directory with its CSS Module, a `.stories.tsx` (both apps' Storybooks
load this package's stories) and tests, following
`apps/lopsy-web/CLAUDE.md`. App-specific components stay in their app.

## What is in it

| Import | What |
|---|---|
| `@lopsy/ui/styles/tokens.css` | The design tokens: colours, spacing, radii, fonts, sizes, z-index, shadows |
| `@lopsy/ui/styles/reset.css` | The reset and base element styles, including the default focus ring |
| `@lopsy/ui/styles/fonts.css` | The `@font-face` rules for Inter and Jersey 10 |
| `@lopsy/ui/Slider` | The slider: label, range, value box with an optional suffix, double-click reset; `format`, `parse`, `unit`, `disabled` |
| `@lopsy/ui/Menu` | A dropdown or context menu: `Menu`, `MenuItem` (accent icon, title, detail line), `MenuSeparator`, `MenuGroup` |
| `@lopsy/ui/a11y/focus-trap` | Tab stops inside a dialog, wrapping Tab, handing focus back when it closes |
| `@lopsy/ui/a11y/layers` | Which open dialog or popover answers Escape and keeps Tab |
| `@lopsy/ui/a11y/use-menu-keys` | A menu's keyboard: arrows, Home and End, letters, Escape and Tab |
| `@lopsy/ui/a11y/radio-keys` | A group of `role="radio"` buttons as one Tab stop, moved with the arrows |
| `@lopsy/ui/a11y/use-announcement` | The text for a polite live region, said once a state has settled |

Import the three stylesheets once, at the app's entry point (fonts,
tokens, then reset), before any component.

## Fonts

`fonts.css` points at `/fonts/…` on the page's own origin. The package
does not ship the woff2 files: each app serves them from its own
`public/fonts/`, so an app that imports `fonts.css` needs those files
there too.

## Sizing the Slider

The slider's label and value box take their widths from
`--slider-label-width` and `--slider-value-width` (40 px each by
default). Set them on a panel so its sliders' tracks line up; the
slider's look is otherwise the same everywhere.

## Commands

From the repository root:

```bash
npm run test:ui        # Vitest
npm run typecheck:ui   # tsc --noEmit
npm run lint:ui        # ESLint
```
