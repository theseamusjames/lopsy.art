import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';
import { ColorSwatch } from '../../../components/ColorSwatch/ColorSwatch';
import { ColorPicker } from '../../../components/ColorPicker/ColorPicker';
import { AspectRatioControl } from './AspectRatioControl';
import type { Color } from '../../../types';
import type { ShapeMode, ShapeOutput } from '../../../tools/shape/shape';
import styles from '../OptionsBar.module.css';

type PopoverTarget = 'fill' | 'stroke' | null;

interface ColorPopoverProps {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  color: Color;
  onChange: (color: Color) => void;
  onRemove: () => void;
  removeLabel: string;
}

function ColorPopover({ anchorRef, popoverRef, color, onChange, onRemove, removeLabel }: ColorPopoverProps) {
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
  }, [anchorRef]);

  return createPortal(
    <div ref={popoverRef} className={styles.colorPopover} style={{ top: pos.top, left: pos.left }}>
      <ColorPicker color={color} onChange={onChange} />
      <div className={styles.popoverActions}>
        <button className={styles.removeBtn} type="button" onClick={onRemove}>
          {removeLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function ShapeOptions() {
  const shapeMode = useToolSettingsStore((s) => s.shapeMode);
  const shapeOutput = useToolSettingsStore((s) => s.shapeOutput);
  const shapeFillColor = useToolSettingsStore((s) => s.shapeFillColor);
  const shapeStrokeColor = useToolSettingsStore((s) => s.shapeStrokeColor);
  const shapeStrokeWidth = useToolSettingsStore((s) => s.shapeStrokeWidth);
  const shapePolygonSides = useToolSettingsStore((s) => s.shapePolygonSides);
  const shapeCornerRadius = useToolSettingsStore((s) => s.shapeCornerRadius);
  const setShapeMode = useToolSettingsStore((s) => s.setShapeMode);
  const setShapeOutput = useToolSettingsStore((s) => s.setShapeOutput);
  const setShapeFillColor = useToolSettingsStore((s) => s.setShapeFillColor);
  const setShapeStrokeColor = useToolSettingsStore((s) => s.setShapeStrokeColor);
  const setShapeStrokeWidth = useToolSettingsStore((s) => s.setShapeStrokeWidth);
  const setShapePolygonSides = useToolSettingsStore((s) => s.setShapePolygonSides);
  const setShapeCornerRadius = useToolSettingsStore((s) => s.setShapeCornerRadius);

  const [openPopover, setOpenPopover] = useState<PopoverTarget>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const strokeRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openPopover) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const activeRef = openPopover === 'fill' ? fillRef : strokeRef;
      if (activeRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpenPopover(null);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [openPopover]);

  return (
    <>
      <label className={styles.label} id="shape-mode-label">Shape</label>
      <select
        className={styles.select}
        value={shapeMode}
        onChange={(e) => setShapeMode(e.target.value as ShapeMode)}
        aria-labelledby="shape-mode-label"
      >
        <option value="ellipse">Ellipse</option>
        <option value="polygon">Polygon</option>
      </select>

      <label className={styles.label} id="shape-output-label">Output</label>
      <select
        className={styles.select}
        value={shapeOutput}
        onChange={(e) => setShapeOutput(e.target.value as ShapeOutput)}
        aria-labelledby="shape-output-label"
      >
        <option value="pixels">Pixels</option>
        <option value="path">Path</option>
      </select>

      {shapeMode === 'polygon' && (
        <>
          <label className={styles.label} htmlFor="polygon-sides">Sides</label>
          <input
            id="polygon-sides"
            className={styles.numberInput}
            type="number"
            min={3}
            max={64}
            value={shapePolygonSides}
            onChange={(e) => setShapePolygonSides(Number(e.target.value))}
          />
        </>
      )}

      {shapeMode !== 'ellipse' && (
        <Slider label="Corner Radius" value={shapeCornerRadius} min={0} max={200} onChange={setShapeCornerRadius} />
      )}

      <AspectRatioControl />

      <span className={styles.label}>Fill</span>
      <div className={styles.swatchGroup} ref={fillRef}>
        {shapeFillColor ? (
          <ColorSwatch
            color={shapeFillColor}
            size="sm"
            onClick={() => setOpenPopover(openPopover === 'fill' ? null : 'fill')}
          />
        ) : (
          <button
            className={styles.noColor}
            type="button"
            aria-label="Add fill color"
            onClick={() => {
              setShapeFillColor({ r: 255, g: 255, b: 255, a: 1 });
              setOpenPopover('fill');
            }}
          >
            —
          </button>
        )}
        {openPopover === 'fill' && shapeFillColor && (
          <ColorPopover
            anchorRef={fillRef}
            popoverRef={popoverRef}
            color={shapeFillColor}
            onChange={setShapeFillColor}
            onRemove={() => { setShapeFillColor(null); setOpenPopover(null); }}
            removeLabel="Remove fill"
          />
        )}
      </div>

      <span className={styles.label}>Stroke</span>
      <div className={styles.swatchGroup} ref={strokeRef}>
        {shapeStrokeColor ? (
          <ColorSwatch
            color={shapeStrokeColor}
            size="sm"
            onClick={() => setOpenPopover(openPopover === 'stroke' ? null : 'stroke')}
          />
        ) : (
          <button
            className={styles.noColor}
            type="button"
            aria-label="Add stroke color"
            onClick={() => {
              setShapeStrokeColor({ r: 0, g: 0, b: 0, a: 1 });
              setOpenPopover('stroke');
            }}
          >
            —
          </button>
        )}
        {openPopover === 'stroke' && shapeStrokeColor && (
          <ColorPopover
            anchorRef={strokeRef}
            popoverRef={popoverRef}
            color={shapeStrokeColor}
            onChange={setShapeStrokeColor}
            onRemove={() => { setShapeStrokeColor(null); setOpenPopover(null); }}
            removeLabel="Remove stroke"
          />
        )}
      </div>

      {shapeStrokeColor && (
        <Slider label="Width" value={shapeStrokeWidth} min={1} max={50} onChange={setShapeStrokeWidth} />
      )}
    </>
  );
}
