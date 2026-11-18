import { useEffect, useRef, useState } from 'react';

/** The readout reads the image under the pointer at most this often. */
const READOUT_MS = 100;

export type Rgb = readonly [number, number, number];

/**
 * The rendered colour under the pointer (spec 5.4 Pixel readout). `sample`
 * maps a pointer position (client pixels) to a colour, or null off the
 * image; it runs at most once every READOUT_MS, for wherever the pointer
 * is by then.
 */
export function usePixelReadout(sample: (clientX: number, clientY: number) => Rgb | null): {
  readout: Rgb | null;
  onPointerMove: (clientX: number, clientY: number) => void;
  onPointerLeave: () => void;
} {
  const [readout, setReadout] = useState<Rgb | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sampleRef = useRef(sample);
  sampleRef.current = sample;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onPointerMove = (clientX: number, clientY: number) => {
    pointer.current = { x: clientX, y: clientY };
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const at = pointer.current;
      setReadout(at ? sampleRef.current(at.x, at.y) : null);
    }, READOUT_MS);
  };

  const onPointerLeave = () => {
    pointer.current = null;
    setReadout(null);
  };

  return { readout, onPointerMove, onPointerLeave };
}
