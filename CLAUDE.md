# Lopsy — Development Rules

Read SPEC.md for the full product specification.

## Language & Types

- TypeScript only. No `.js` or `.jsx` files. All source is `.ts` or `.tsx`.
- Strict mode (`"strict": true` in tsconfig).
- No `any`. Use `unknown` and narrow, or define proper types.
- Prefer interfaces for object shapes, type aliases for unions/intersections.
- Export types from the file that defines them. Don't re-export from barrel files.

## Project Structure

```
src/
  app/              # App shell, layout, routing (single page)
  components/       # Reusable UI components (Button, Slider, etc.)
    ComponentName/
      ComponentName.tsx
      ComponentName.module.css
      ComponentName.stories.tsx
      ComponentName.test.tsx
  panels/           # Right sidebar panels (Layers, Color, History, etc.)
  toolbox/          # Left sidebar tool icons and tool selection
  tools/            # Tool logic — one directory per tool
    brush/
      brush.ts          # Pure logic (no DOM, no React)
      brush.test.ts     # Unit tests for the logic
      BrushOptions.tsx   # Options bar UI for this tool
      BrushOptions.module.css
  engine/           # Core rendering engine (WebGL, canvas compositing)
  layers/           # Layer model, blend modes, masks
  history/          # Undo/redo system
  selection/        # Selection model and operations
  filters/          # Filter implementations (blur, sharpen, noise, etc.)
  adjustments/      # Image adjustment implementations
  icons/            # Custom SVG icon components (Lucide style)
  styles/           # Global CSS: tokens.css, reset.css, fonts.css
  types/            # Shared TypeScript type definitions
  utils/            # Small pure utility functions
public/
  fonts/            # Self-hosted woff2 font files
e2e/                # Playwright end-to-end tests
```

## Styling

- **CSS Modules only**. Every component gets a co-located `.module.css` file.
- No inline styles. No `style` props. No CSS-in-JS. No style objects in TypeScript. Zero styling logic in `.ts`/`.tsx` files.
- Use CSS custom properties from `src/styles/tokens.css` for all colors, spacing, radii, shadows, font sizes, and z-index values.
- No CSS frameworks (no Tailwind, no Bootstrap, no styled-components).
- Dark theme is the default. Light theme toggles via `.theme-light` on the root element.

## Architecture

- **Separate logic from UI**. Each tool has a pure logic module (`tool.ts`) that is framework-agnostic — no React, no DOM. React components call into the logic module.
- **Editor engine is not React**. The WebGL rendering pipeline, layer compositing, and canvas interaction live in `src/engine/` and are plain TypeScript classes/functions. React wraps the engine for UI, but the engine must work without React.
- **State**: Zustand for UI state (selected tool, panel visibility, etc.). The document model (layers, history, selection) is a custom store — not Zustand, not Redux.
- **No backend**. Everything runs in the browser. No API calls for core functionality.
- **Web Workers** for heavy computation (filters, image encode/decode). Keep the main thread free.

## Tools

Each tool follows this pattern:
1. `src/tools/<name>/<name>.ts` — pure logic. Handles input events (as plain data, not DOM events), produces operations on the document model. Fully unit-testable without a browser.
2. `src/tools/<name>/<name>.test.ts` — unit tests for the logic.
3. `src/tools/<name>/<Name>Options.tsx` — React component for the tool's options bar. Reads/writes tool settings via Zustand.
4. `src/tools/<name>/<Name>Options.module.css` — styles for the options bar.

Tool logic modules must not import React, DOM APIs, or any rendering code.

## Components

- One component per directory. Directory name matches component name (PascalCase).
- Every component has a `.stories.tsx` file for Storybook.
- Props interfaces are defined in the component file, not in a separate types file.
- Prefer composition over configuration. Small, focused components over large ones with many props.
- No default exports. Use named exports.

## Icons

- Use Lucide React (`lucide-react`) for standard icons.
- Custom editor icons (brush, eraser, lasso, etc.) go in `src/icons/` as React components.
- Custom icons follow Lucide conventions: 24x24 viewBox, 2px stroke, round linecap/linejoin, no fill.

## Testing

- **Unit tests**: Vitest. Co-located with source files (`foo.test.ts` next to `foo.ts`).
- **E2E tests**: Playwright. Located in `e2e/` directory.
- **Storybook**: Storybook 8+. Stories co-located with components.
- Tool logic must have unit tests. Test the math, not the rendering.
- Every new component needs a Storybook story before it's considered complete.

## Commands

```bash
npm run dev          # Start Vite dev server
npm run build        # Production build
npm run test         # Run Vitest unit tests
npm run test:e2e     # Run Playwright E2E tests
npm run storybook    # Start Storybook dev server
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
```

## Code Style

- No default exports (except where required by frameworks, e.g. Storybook meta).
- Prefer `const` over `let`. Never use `var`.
- Prefer early returns over nested conditionals.
- Functions should do one thing. If a function is longer than ~40 lines, consider splitting it.
- Name booleans with `is`/`has`/`should` prefixes.
- Name event handlers with `handle` prefix in components (`handleClick`, `handleDrag`).
- Name callbacks passed as props with `on` prefix (`onClick`, `onDrag`).
- No comments explaining *what* code does. Comments only for *why* something non-obvious is done.
- No TODO comments in committed code — use GitHub issues.

## Git

- Branch names: `theseamusjames/<short-description>`.
- Commit messages: imperative mood, concise. ("Add brush tool", not "Added brush tool").
- One logical change per commit.

## Dependencies

- Minimize dependencies. Before adding a package, consider if it can be done in < 50 lines of code.
- Current stack: React, Vite, Vitest, Playwright, Storybook, Zustand, Lucide React.
- No CSS frameworks. No UI component libraries (no MUI, Chakra, Radix, etc.).
- Fonts: Inter (UI), JetBrains Mono (monospace). Self-hosted woff2 in `public/fonts/`.

## Performance

- Never block the main thread with heavy computation. Use Web Workers.
- Rendering hot paths (brush strokes, pan/zoom) must not allocate objects in tight loops — pre-allocate and reuse.
- Lazy-load features that aren't needed on startup (filters, adjustment dialogs, font browser).
- Target: 60fps for pan, zoom, and brush strokes on a 4000x4000 canvas with 20 layers.
