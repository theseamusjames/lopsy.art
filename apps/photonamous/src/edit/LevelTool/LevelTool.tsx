import { useEffect, useRef, useState, type PointerEvent } from 'react';
import styles from './LevelTool.module.css';

export interface LevelToolProps {
  /** The line drawn, in stage pixels (y down). */
  readonly onLine: (a: { x: number; y: number }, b: { x: number; y: number }) => void;
  readonly onCancel: () => void;
}

interface Line {
  readonly pointerId: number;
  readonly a: { x: number; y: number };
  b: { x: number; y: number };
}

/**
 * Straighten by drawing along something that should be level (or
 * upright). Esc cancels. It is for the pointer; the Edit view says how to
 * use it, and the Angle slider straightens by keyboard.
 */
export function LevelTool({ onLine, onCancel }: LevelToolProps) {
  const [line, setLine] = useState<Line | null>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel.current();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const at = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <>
      <svg
        className={styles.levelTool}
        data-testid="level-tool"
        aria-hidden="true"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = at(e);
          setLine({ pointerId: e.pointerId, a: p, b: p });
        }}
        onPointerMove={(e) => {
          if (!line || line.pointerId !== e.pointerId) return;
          setLine({ ...line, b: at(e) });
        }}
        onPointerUp={(e) => {
          if (!line || line.pointerId !== e.pointerId) return;
          setLine(null);
          onLine(line.a, at(e));
        }}
      >
        {line && <line className={styles.line} x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} />}
      </svg>
      <span className={styles.hint}>Draw along something level · Esc to cancel</span>
    </>
  );
}
