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
| `@lopsy/ui/styles/tokens.css` | The design tokens: colours (among them the filled buttons', `--color-primary-*` and `--color-danger-*`, under which white text is at least 4.5:1 in every state, and `--color-slider-fill`, the primary blue), spacing, radii, fonts, sizes, z-index, shadows |
| `@lopsy/ui/styles/reset.css` | The reset and base element styles, including the default focus ring |
| `@lopsy/ui/styles/fonts.css` | The `@font-face` rules for Inter and Jersey 10 |
| `@lopsy/ui/Slider` | The slider: label, range, value box with an optional suffix, double-click reset, and a fill along the track from its origin to the thumb (0 when the range runs both sides of it, else the left end, or `fillFrom`); `format`, `parse`, `unit`, `disabled`, `fillFrom` |
| `@lopsy/ui/ZoomReadout` | The zoom level, as a button: drag left or right on it to zoom (1 % a pixel, 10 % to 400 %), double-click it or press Enter for 100 %, and the arrow keys step to the next 10 % |
| `@lopsy/ui/StatusBar` | The 24 px bar along the bottom of a window: `StatusBar` (a labelled footer, a polite live region unless `isLive` is false), `StatusItem` (a reading; `name` is said before it and not shown, `isEmphasized` for a state worth noticing), `StatusNumber`, `StatusDivider`, `StatusSpacer`, and `STATUS_ITEM_CLASS` for a control that sits in the bar as an item |
| `@lopsy/ui/Menu` | A dropdown or context menu: `Menu`, `MenuItem` (accent icon, title, detail line), `MenuSeparator`, `MenuGroup` |
| `@lopsy/ui/a11y/arrow-keys` | `HANDLES_ARROW_KEYS_ATTR`, which marks a control that handles the arrow keys itself, for a shortcut handler that listens in the capture phase (Lopsy's) |
| `@lopsy/ui/a11y/focus-trap` | Tab stops inside a dialog, wrapping Tab, handing focus back when it closes |
| `@lopsy/ui/a11y/layers` | Which open dialog or popover answers Escape and keeps Tab |
| `@lopsy/ui/a11y/use-menu-keys` | A menu's keyboard: arrows, Home and End, letters, Escape and Tab |
| `@lopsy/ui/a11y/radio-keys` | A group of `role="radio"` buttons as one Tab stop, moved with the arrows |
| `@lopsy/ui/a11y/use-announcement` | The text for a polite live region, said once a state has settled |
| `@lopsy/ui/a11y/use-select-on-focus` | A text field whose whole text is selected when it takes focus, also after a click in Safari (whose mouseup would otherwise drop the selection) |

Import the three stylesheets once, from the app's entry point: fonts,
tokens, then reset. Both apps import them after their components, so the
reset's `:focus-visible` ring outranks a CSS Module's plain
`outline: none`; a component that draws its own ring does it in a
`:focus-visible` rule, as the Slider does (`MEMORY.md`).

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
