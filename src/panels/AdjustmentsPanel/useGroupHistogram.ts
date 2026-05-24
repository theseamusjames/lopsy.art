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

  // Use a ref for the layers array so adjustment-only changes (which create
  // a new layers array without changing pixel content) don't trigger a
  // histogram recomputation. The histogram shows SOURCE pixel distribution,
  // which only changes when pixelVersion or group children change.
  const layersRef = useRef(useEditorStore.getState().document.layers);
  useEffect(() => {
    return useEditorStore.subscribe((s) => { layersRef.current = s.document.layers; });
  }, []);

  const [histogram, setHistogram] = useState<Histogram>(EMPTY_HISTOGRAM);

  const childKey = useMemo(() => activeGroupChildren.join(','), [activeGroupChildren]);

  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    let retries = 0;

    const tryRead = () => {
      if (cancelled) return;
      const images: ImageData[] = [];
      const layers = layersRef.current;
      for (const id of activeGroupChildren) {
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
  }, [skip, childKey, pixelVersion, activeGroupChildren]);

  return histogram;
}
