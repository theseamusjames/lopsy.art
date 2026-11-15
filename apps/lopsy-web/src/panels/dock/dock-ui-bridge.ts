/**
 * Two-way indirection between the dock store and ui-store, so neither
 * imports the other (they form an import cycle otherwise: ui-store →
 * tool-registry → ShapeOptions → dock-store → ui-store).
 *
 * - ui-store's backward-compatible `togglePanel` action delegates to the
 *   dock store's handler, registered here at dock-store init.
 * - The dock store publishes the set of open panels after every layout
 *   change; ui-store registers a sink that mirrors it into its
 *   `visiblePanels` field. The last published set is cached so
 *   registration order doesn't matter.
 */

type PanelToggleHandler = (panelId: string) => void;
type VisiblePanelsSink = (panels: Set<string>) => void;

let toggleHandler: PanelToggleHandler | null = null;
let visiblePanelsSink: VisiblePanelsSink | null = null;
let lastPublished: Set<string> | null = null;

export function setPanelToggleHandler(fn: PanelToggleHandler): void {
  toggleHandler = fn;
}

export function togglePanelById(panelId: string): void {
  toggleHandler?.(panelId);
}

export function setVisiblePanelsSink(fn: VisiblePanelsSink): void {
  visiblePanelsSink = fn;
  if (lastPublished) fn(lastPublished);
}

export function publishVisiblePanels(panels: Set<string>): void {
  lastPublished = panels;
  visiblePanelsSink?.(panels);
}
