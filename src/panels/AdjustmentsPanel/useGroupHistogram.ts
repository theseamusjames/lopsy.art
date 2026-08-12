import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useEditorStore } from '../../app/editor-store';
import { readLayerThumbnail } from '../../engine-wasm/gpu-pixel-access';
import { pixelDataManager } from '../../engine/pixel-data-manager';
import { computeHistogram, EMPTY_HISTOGRAM, type Histogram } from './histogram-compute';

// A 256×256 thumbnail is 65,536 samples — comfortably above the 50k
// SAMPLE_TARGET the histogram compute pass strides down to — and is a
// ~256× reduction in bridge traffic vs. the full-resolution readback
// this hook used to run (#712).
const HISTOGRAM_THUMB_SIZE = 256;

export function useGroupHistogram(skip: boolean): Histogram {
  const activeGroupChildren = useEditorStore((s) => {
    const id = s.document.activeLayerId;
    const layers = s.document.layers;
    const active = id ? layers.find((l) => l.id === id) : undefined;
    if (active?.type === 'group') return active.children;
    const root = layers.find((l) => l.id === s.document.rootGroupId);
    return root?.type === 'group' ? root.children : [];
  });

  // Subscribe to a snapshot built from only the per-layer versions of the
  // active group's children — so a mutation to a layer outside the group
  // doesn't re-run the histogram. The global `pixelDataManager.version()`
  // (previously used here) bumps on every layer's every mutation.
  const childVersionKey = useSyncExternalStore(
    pixelDataManager.subscribe.bind(pixelDataManager),
    () => {
      let key = '';
      for (const id of activeGroupChildren) key += id + ':' + pixelDataManager.versionOf(id) + ',';
      return key;
    },
  );

  // Use a ref for the layers array so adjustment-only changes (which create
  // a new layers array without changing pixel content) don't trigger a
  // histogram recomputation. The histogram shows SOURCE pixel distribution,
  // which only changes when a child layer's pixels or membership change.
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
        // GPU-downscaled read: LINEAR-filtered on the GPU, which yields a
        // slightly smoothed histogram vs. a strided sample of the full
        // texture. For a tonal-distribution preview behind Curves/Levels
        // that trade is fine, and it drops idle bridge traffic from
        // ~268 MB/read at 4K down to ~0.26 MB.
        const img = readLayerThumbnail(id, HISTOGRAM_THUMB_SIZE);
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
  }, [skip, childKey, childVersionKey, activeGroupChildren]);

  return histogram;
}
