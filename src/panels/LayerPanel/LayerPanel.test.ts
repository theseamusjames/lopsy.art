// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { Root } from 'react-dom/client';

interface MeasureOptions {
  detail?: { devtools?: { properties?: unknown[] | null } };
}

/**
 * React's development performance track calls `performance.measure` after a
 * component re-renders with changed props, flattening the changed props into
 * `detail.devtools.properties`. Record the largest list it builds.
 */
let largestPropertyList = 0;
let propertyListCount = 0;

function recordMeasure(_name: string, options?: MeasureOptions): void {
  const props = options?.detail?.devtools?.properties;
  if (!Array.isArray(props)) return;
  propertyListCount++;
  largestPropertyList = Math.max(largestPropertyList, props.length);
}

type Modules = [
  typeof import('react'),
  typeof import('react-dom/client'),
  typeof import('../../app/editor-store'),
  typeof import('./LayerPanel'),
];
let mods: Modules;

beforeAll(async () => {
  // React only enables the track when both exist at module load, and
  // Vitest's console has no `timeStamp`.
  const consoleWithTimeStamp = console as Console & { timeStamp?: () => void };
  consoleWithTimeStamp.timeStamp ??= () => {};
  performance.measure = recordMeasure as unknown as typeof performance.measure;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mods = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('../../app/editor-store'),
    import('./LayerPanel'),
  ]);
});

let root: Root | null = null;

afterEach(() => {
  const [{ act }] = mods;
  act(() => root?.unmount());
  root = null;
});

describe('LayerPanel', () => {
  it('keeps layer mask bytes out of the props React diffs in development', () => {
    const [{ act, createElement }, { createRoot }, { useEditorStore }, { LayerPanel }] = mods;
    useEditorStore.getState().createDocument(300, 200, false);
    const layerId = useEditorStore.getState().document.activeLayerId!;

    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(createElement(LayerPanel, { onSelectLayer: () => {} })));
    largestPropertyList = 0;
    propertyListCount = 0;

    act(() => useEditorStore.getState().addLayerMask(layerId));
    const mask = useEditorStore.getState().document.layers.find((l) => l.id === layerId)!.mask!;
    expect(mask.data.length).toBe(300 * 200);
    act(() => useEditorStore.getState().updateLayerMaskData(layerId, new Uint8ClampedArray(mask.data.length)));
    act(() => useEditorStore.getState().renameLayer(layerId, 'Masked'));

    expect(container.querySelector('[aria-label="Edit mask for Masked"]')).not.toBeNull();
    // The rename changes LayerRow's output, so the track did run on these
    // updates. A typed array reachable from a prop is listed index by index —
    // 60,000 entries for this mask; ids and flags keep the list tiny.
    expect(propertyListCount).toBeGreaterThan(0);
    expect(largestPropertyList).toBeLessThan(1000);
  });
});
