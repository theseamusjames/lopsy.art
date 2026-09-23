// tinyjs backend. Lopsy has no backend of its own ("No backend" in
// CLAUDE.md) — the page does all the work, so this stays empty until a
// desktop-only capability (native file dialogs, recent files) needs it.
export const api: Record<string, TinyApiHandler> = {};

export function init(_app: TinyApp): void {}
