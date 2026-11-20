// @vitest-environment jsdom
import '../../test/canvas-mock';
import { describe, expect, it } from 'vitest';

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

await import('../../commands');
const { getCommand } = await import('../../commands/registry');
const { validateParams } = await import('../../commands/params');
const { KEY_BINDINGS } = await import('./key-bindings');
const { toolRegistry } = await import('../../tools/tool-registry');
type KeyBinding = import('./key-bindings').KeyBinding;

const KEY_HANDLER_SOURCES = import.meta.glob(
  [
    '/src/app/useKeyboardShortcuts.ts',
    '/src/app/delete-key.ts',
    '/src/app/shortcuts/edit-shortcuts.ts',
    '/src/app/shortcuts/tool-shortcuts.ts',
    '/src/app/shortcuts/zoom-shortcuts.ts',
  ],
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>;

const bindings = Object.entries(KEY_BINDINGS as Record<string, KeyBinding>);

/** Every key handler, in the order of inventory section 4. A new handler must be added here and to KEY_BINDINGS. */
const HANDLERS = [
  'escapeDismissPopover', 'textEditingKeys', 'spaceHeld', 'escapePenDraft', 'escapeDeselect', 'enterPenStroke',
  'deleteMaskClear', 'deleteSelectedPixels', 'deleteLayer',
  'toolLetter', 'swapColors', 'resetColors', 'toggleQuickMask', 'arrowNudge', 'bracketSize',
  'zoomIn', 'zoomOut', 'zoomFit', 'zoomActualSize',
  'liquify', 'copy', 'copyMerged', 'cut', 'paste', 'mergeDown', 'selectAll', 'invertSelection', 'deselect',
  'toggleGrid', 'toggleGuides', 'undo', 'redo', 'autoTone', 'autoContrast', 'autoColor',
  'keyupRelease', 'pasteEvent', 'windowBlur',
];

/** Calls the bound handlers made before they ran commands; none may come back beside runKeyCommand. */
const REPLACED_CALLS = [
  /\.undo\(\)/, /\.redo\(\)/, /\.copy\(\)/, /\.cut\(\)/, /copyMerged\(\)/, /\.mergeDown\(\)/,
  /\bselectAll\(\)/, /invertSelectionAction\(/, /deselectAndCommit\(/, /\.toggleGrid\(/, /\.toggleGuides\(/,
  /applyAuto(Tone|Contrast|Color)\(/, /openLiquify\(/, /\.setActiveTool\(/, /swapColors\(/, /resetColors\(/,
  /toggleQuickMaskMode\(/, /\.removeLayer\(/, /if \(clearActiveLayerMask\(\)\)/, /clearSelectedLayerPixels\(activeId, sel/,
];

function usedKeyCommands(): string[] {
  const names = Object.values(KEY_HANDLER_SOURCES).flatMap((source) =>
    [...source.matchAll(/runKeyCommand\('([A-Za-z]+)'/g)].map((match) => match[1]!),
  );
  return [...new Set(names)].sort();
}

describe('keyboard handler bindings', () => {
  it('lists every key handler exactly once', () => {
    expect(Object.keys(KEY_BINDINGS)).toEqual(HANDLERS);
  });

  it('binds each handler to a registered command or exempts it with a reason', () => {
    for (const [name, binding] of bindings) {
      if ('exempt' in binding) {
        expect(binding.exempt.length, name).toBeGreaterThan(20);
        continue;
      }
      const command = getCommand(binding.command);
      expect(command, `${name} runs ${binding.command}`).toBeDefined();
      if (name === 'toolLetter') continue;
      expect(() => validateParams(binding.command, command!.params, binding.params), name).not.toThrow();
    }
  });

  it('runs a command from exactly the handlers bound to one', () => {
    const bound = bindings.filter(([, binding]) => 'command' in binding).map(([name]) => name).sort();
    expect(usedKeyCommands()).toEqual(bound);
  });

  it('starts commands only through runKeyCommand, and no longer makes the calls the commands replaced', () => {
    for (const [path, source] of Object.entries(KEY_HANDLER_SOURCES)) {
      expect(source, path).not.toMatch(/invokeFromUi\(/);
      for (const call of REPLACED_CALLS) expect(source, `${path}: ${call}`).not.toMatch(call);
    }
  });

  it('lets every tool letter, default or customised, select its tool through tool.select', () => {
    const command = getCommand('tool.select')!;
    for (const id of Object.keys(toolRegistry)) {
      expect(() => validateParams('tool.select', command.params, { tool: id }), id).not.toThrow();
    }
  });
});
