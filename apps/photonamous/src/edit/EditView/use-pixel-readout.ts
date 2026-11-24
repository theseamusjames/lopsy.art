import { useEffect, useRef, useState } from 'react';

/** The readout reads the image under the pointer at most this often. */
const READOUT_MS = 100;

export type Rgb = readonly [number, number, number];

/**
 * The rendered colour under the pointer (spec 5.4 Pixel readout). `sample`
 * maps a pointer position (client pixels) to a colour, or null off the
 * image; it runs at most once every READOUT_MS, for wherever the pointer
 * is by then. It answers later on WebGPU, where a read takes a frame or
 * more: one read is out at a time, and an answer that comes after the
 * pointer has left is dropped.
 */
export function usePixelReadout(sample: (clientX: number, clientY: number) => Promise<Rgb | null>): {
  readout: Rgb | null;
  onPointerMove: (clientX: number, clientY: number) => void;
  onPointerLeave: () => void;
} {
  const [readout, setReadout] = useState<Rgb | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sampleRef = useRef(sample);
  sampleRef.current = sample;
  /** Counts pointer leaves and unmounts: an answer to a read started before one is dropped. */
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const read = () => {
    const at = pointer.current;
    if (!at) {
      timer.current = null;
      return;
    }
    const asked = generation.current;
    // The timer stays set until the read answers, so reads never pile up.
    sampleRef
      .current(at.x, at.y)
      .catch(() => null)
      .then((rgb) => {
        if (generation.current === asked) setReadout(rgb);
      })
      .finally(() => {
        timer.current = null;
      });
  };

  const onPointerMove = (clientX: number, clientY: number) => {
    pointer.current = { x: clientX, y: clientY };
    if (timer.current) return;
    timer.current = setTimeout(read, READOUT_MS);
  };

  const onPointerLeave = () => {
    pointer.current = null;
    generation.current += 1;
    setReadout(null);
  };

  return { readout, onPointerMove, onPointerLeave };
}
