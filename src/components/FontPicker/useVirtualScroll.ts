import { useCallback, useEffect, useState } from 'react';

interface VirtualScrollResult {
  totalHeight: number;
  offsetY: number;
  startIndex: number;
  endIndex: number;
  scrollRef: (node: HTMLDivElement | null) => void;
  scrollToTop: () => void;
}

export function useVirtualScroll(
  itemCount: number,
  itemHeight: number,
  overscan = 5,
): VirtualScrollResult {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    setScrollEl(node);
  }, []);

  useEffect(() => {
    if (!scrollEl) return;
    setContainerHeight(scrollEl.clientHeight);
    setScrollTop(scrollEl.scrollTop);
    const onScroll = () => setScrollTop(scrollEl.scrollTop);
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setContainerHeight(entry.contentRect.height);
    });
    ro.observe(scrollEl);
    return () => {
      scrollEl.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [scrollEl]);

  const totalHeight = itemCount * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(itemCount, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan);
  const offsetY = startIndex * itemHeight;

  const scrollToTop = useCallback(() => {
    scrollEl?.scrollTo(0, 0);
  }, [scrollEl]);

  return { totalHeight, offsetY, startIndex, endIndex, scrollRef, scrollToTop };
}
