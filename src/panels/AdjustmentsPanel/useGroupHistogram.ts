import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useEditorStore } from '../../app/editor-store';
import { readLayerAsImageData } from '../../engine-wasm/gpu-pixel-access';
import { pixelDataManager } from '../../engine/pixel-data-manager';
import { computeHistogram, EMPTY_HISTOGRAM, type Histogram } from './histogram-compute';

export function useGroupHistogram(skip: boolean): Histogram {
  const pixelVersion = useSyncExternalStore(
    pixelDataManager.subscribe.bind(pixelDataManager),
    () => pixelDataManager.version(),
  );
  const activeGroupChildren = useEditorStore((s) => {
    const id = s.document.activeLayerId;
    const layers = s.document.layers;
    const active = id ? layers.find((l) => l.id === id) : undefined;
    if (active?.type === 'group') return active.children;
    const root = layers.find((l) => l.id === s.document.rootGroupId);
    return root?.type === 'group' ? root.children : [];
  });
  const layersMap = useEditorStore((s) => s.document.layers);

  const [histogram, setHistogram] = useState<Histogram>(EMPTY_HISTOGRAM);

  const childKey = useMemo(() => activeGroupChildren.join(','), [activeGroupChildren]);

  // Visibility key: only flips when one of the relevant child layers'
  // visibility actually changes. Adjustment-slider drags re-allocate the
  // layers array every tick without changing visibility, so this key stays
  // stable and the effect doesn't re-run (issue #525).
  const visibilityKey = useMemo(() => {
    return activeGroupChildren
      .map((id) => {
        const layer = layersMap.find((l) => l.id === id);
        return layer ? `${id}:${layer.visible ? 1 : 0}:${layer.type}` : `${id}:-`;
      })
      .join('|');
  }, [activeGroupChildren, layersMap]);

  // Refs let the effect read the latest layer-tree without listing the
  // whole layers array as a dep. Each adjustment-slider tick re-allocates
  // `layersMap` — depending on the reference would force a full GPU
  // readback per tick on a 4000x6000 doc.
  const layersMapRef = useRef(layersMap);
  layersMapRef.current = layersMap;
  const activeGroupChildrenRef = useRef(activeGroupChildren);
  activeGroupChildrenRef.current = activeGroupChildren;

  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    let retries = 0;

    const tryRead = () => {
      if (cancelled) return;
      const children = activeGroupChildrenRef.current;
      const layers = layersMapRef.current;
      const images: ImageData[] = [];
      for (const id of children) {
        const layer = layers.find((l) => l.id === id);
        if (!layer || !layer.visible) continue;
        if (layer.type === 'group') continue;
        const img = readLayerAsImageData(id);
        if (img) images.push(img);
      }
      if (images.length === 0) {
        if (retries < 8) {
          retries++;
          requestAnimationFrame(tryRead);
        } else {
          setHistogram(EMPTY_HISTOGRAM);
        }
        return;
      }
      setHistogram(computeHistogram(images));
    };

    const rafId = requestAnimationFrame(tryRead);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [skip, childKey, pixelVersion, visibilityKey]);

  return histogram;
}
