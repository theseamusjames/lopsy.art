import { useCallback, useEffect, useRef, useState } from 'react';
import type { GradientStop } from '../../tools/gradient/gradient';
import { interpolateGradient } from '../../tools/gradient/gradient';
import { ColorPicker } from '../ColorPicker/ColorPicker';
import type { Color } from '../../types';
import styles from './GradientEditor.module.css';

interface GradientEditorProps {
  stops: readonly GradientStop[];
  onStopsChange: (stops: readonly GradientStop[]) => void;
}

function stopToCss(stop: GradientStop): string {
  const { r, g, b, a } = stop.color;
  return `rgba(${r},${g},${b},${a}) ${stop.position * 100}%`;
}

function buildGradientCss(stops: readonly GradientStop[]): string {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  return `linear-gradient(to right, ${sorted.map(stopToCss).join(', ')})`;
}

export function GradientEditor({ stops, onStopsChange }: GradientEditorProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const handleRefs = useRef<Map<number, HTMLDivElement>>(new Map());

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
    setSelectedIndex(newIndex >= 0 ? newIndex : stops.length);
  }, [stops, onStopsChange, getPositionFromEvent, draggingIndex]);

  const handleHandleMouseDown = useCallback((e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setSelectedIndex(index);
    setDraggingIndex(index);
  }, []);

  const handleHandleDoubleClick = useCallback((e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setSelectedIndex(index);
    setShowPicker(true);
  }, []);

  useEffect(() => {
    if (draggingIndex === null) return;

    const handleMove = (e: MouseEvent) => {
      const position = getPositionFromEvent(e.clientX);
      const newStops = stops.map((stop, i) =>
        i === draggingIndex ? { ...stop, position } : stop,
      );
      newStops.sort((a, b) => a.position - b.position);
      const newIndex = newStops.findIndex(
        (s) => s.position === position,
      );
      onStopsChange(newStops);
      if (newIndex >= 0) setDraggingIndex(newIndex);
      setSelectedIndex(newIndex >= 0 ? newIndex : draggingIndex);
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
  }, [draggingIndex, stops, onStopsChange, getPositionFromEvent]);

  useEffect(() => {
    if (!showPicker) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };

    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showPicker]);

  const handleColorChange = useCallback((color: Color) => {
    const newStops = stops.map((stop, i) =>
      i === selectedIndex ? { ...stop, color } : stop,
    );
    onStopsChange(newStops);
  }, [stops, selectedIndex, onStopsChange]);

  const handleDelete = useCallback(() => {
    if (stops.length <= 2) return;
    const newStops = stops.filter((_, i) => i !== selectedIndex);
    onStopsChange(newStops);
    setSelectedIndex(Math.min(selectedIndex, newStops.length - 1));
    setShowPicker(false);
  }, [stops, selectedIndex, onStopsChange]);

  const selectedStop = sorted[selectedIndex];
  const activeHandle = handleRefs.current.get(selectedIndex);

  let pickerPos = { top: 0, left: 0 };
  if (showPicker && activeHandle) {
    const rect = activeHandle.getBoundingClientRect();
    pickerPos = { top: rect.bottom + 4, left: rect.left - 95 };
  }

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
            ref={(el) => {
              if (el) handleRefs.current.set(index, el);
              else handleRefs.current.delete(index);
            }}
            className={`${styles.handle} ${index === selectedIndex ? styles.handleActive : ''}`}
            style={{
              left: `${stop.position * 100}%`,
              backgroundColor: `rgb(${stop.color.r},${stop.color.g},${stop.color.b})`,
            }}
            onMouseDown={(e) => handleHandleMouseDown(e, index)}
            onDoubleClick={(e) => handleHandleDoubleClick(e, index)}
            data-testid={`gradient-stop-${index}`}
          />
        ))}
      </div>
      <div className={styles.stopActions}>
        <button
          className={styles.deleteBtn}
          onClick={handleDelete}
          disabled={stops.length <= 2}
          data-testid="gradient-delete-stop"
        >
          Delete stop
        </button>
      </div>
      {showPicker && selectedStop && (
        <div
          ref={pickerRef}
          className={styles.colorPopover}
          style={{ top: pickerPos.top, left: Math.max(0, pickerPos.left) }}
        >
          <ColorPicker color={selectedStop.color} onChange={handleColorChange} />
        </div>
      )}
    </div>
  );
}
