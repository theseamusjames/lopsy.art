import { useCallback, useEffect, useRef, useState } from 'react';
import type { GradientStop } from '../../tools/gradient/gradient';
import { interpolateGradient } from '../../tools/gradient/gradient';
import styles from './GradientEditor.module.css';

interface GradientEditorProps {
  stops: readonly GradientStop[];
  selectedIndex: number;
  onStopsChange: (stops: readonly GradientStop[]) => void;
  onSelectStop: (index: number) => void;
}

function stopToCss(stop: GradientStop): string {
  const { r, g, b, a } = stop.color;
  return `rgba(${r},${g},${b},${a}) ${stop.position * 100}%`;
}

export function buildGradientCss(stops: readonly GradientStop[]): string {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  return `linear-gradient(to right, ${sorted.map(stopToCss).join(', ')})`;
}

export function GradientEditor({ stops, selectedIndex, onStopsChange, onSelectStop }: GradientEditorProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const sorted = [...stops].sort((a, b) => a.position - b.position);

  const getPositionFromEvent = useCallback((clientX: number): number => {
    const bar = barRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handleBarClick = useCallback((e: React.MouseEvent) => {
    if (draggingIndex !== null) return;
    if (stops.length >= 16) return;

    const position = getPositionFromEvent(e.clientX);
    const color = interpolateGradient(stops, position);
    const newStops = [...stops, { position, color }];
    newStops.sort((a, b) => a.position - b.position);
    const newIndex = newStops.findIndex((s) => s.position === position && s.color === color);
    onStopsChange(newStops);
    onSelectStop(newIndex >= 0 ? newIndex : stops.length);
  }, [stops, onStopsChange, onSelectStop, getPositionFromEvent, draggingIndex]);

  const handleHandleMouseDown = useCallback((e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    onSelectStop(index);
    setDraggingIndex(index);
  }, [onSelectStop]);

  useEffect(() => {
    if (draggingIndex === null) return;

    const handleMove = (e: MouseEvent) => {
      const position = getPositionFromEvent(e.clientX);
      const newStops = stops.map((stop, i) =>
        i === draggingIndex ? { ...stop, position } : stop,
      );
      newStops.sort((a, b) => a.position - b.position);
      const newIndex = newStops.findIndex((s) => s.position === position);
      onStopsChange(newStops);
      if (newIndex >= 0) {
        setDraggingIndex(newIndex);
        onSelectStop(newIndex);
      }
    };

    const handleUp = () => {
      setDraggingIndex(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [draggingIndex, stops, onStopsChange, onSelectStop, getPositionFromEvent]);

  return (
    <div className={styles.editor} data-testid="gradient-editor">
      <div
        ref={barRef}
        className={styles.barContainer}
        onClick={handleBarClick}
        data-testid="gradient-bar"
      >
        <div
          className={styles.gradientBar}
          style={{ background: buildGradientCss(sorted) }}
        />
      </div>
      <div className={styles.handlesRow} data-testid="gradient-handles">
        {sorted.map((stop, index) => (
          <div
            key={index}
            className={`${styles.handle} ${index === selectedIndex ? styles.handleActive : ''}`}
            style={{
              left: `${stop.position * 100}%`,
              backgroundColor: `rgb(${stop.color.r},${stop.color.g},${stop.color.b})`,
            }}
            onMouseDown={(e) => handleHandleMouseDown(e, index)}
            data-testid={`gradient-stop-${index}`}
          />
        ))}
      </div>
    </div>
  );
}
