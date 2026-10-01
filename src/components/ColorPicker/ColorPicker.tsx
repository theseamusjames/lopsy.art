import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { rgbToHsv, hsvToRgb } from '../../utils/color';
import type { HSVColor } from '../../utils/color';
import { contextOptions } from '../../engine/color-space';
import type { Color } from '../../types';
import { syncHsvToColor } from './picker-hsv';
import { parseHexInput, formatHexInput } from './hex-input';
import styles from './ColorPicker.module.css';

interface ColorPickerProps {
  color: Color;
  onChange: (color: Color) => void;
  compact?: boolean;
  /** Grayscale documents have no chroma to pick — swap the hue/SV surfaces
   *  for a single black-to-white value ramp. */
  grayscale?: boolean;
  /** Render the hex text field below the bars. The Color panel turns it off
   *  because it has its own hex field, which also serves Indexed documents
   *  where the picker isn't shown. Never shown in compact mode. */
  showHex?: boolean;
}

interface HexDraft {
  text: string;
  /** The color's hex when the edit began; a draft is dropped once the color
   *  changes underneath it (e.g. another gradient stop is selected). */
  base: string;
}

export function ColorPicker({ color, onChange, compact = false, grayscale = false, showHex = true }: ColorPickerProps) {
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const svContainerRef = useRef<HTMLDivElement>(null);
  const hueCanvasRef = useRef<HTMLCanvasElement>(null);
  const hueContainerRef = useRef<HTMLDivElement>(null);
  const alphaCanvasRef = useRef<HTMLCanvasElement>(null);
  const alphaContainerRef = useRef<HTMLDivElement>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumContainerRef = useRef<HTMLDivElement>(null);
  const valueCanvasRef = useRef<HTMLCanvasElement>(null);
  const valueContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingSV = useRef(false);
  const isDraggingHue = useRef(false);
  const isDraggingAlpha = useRef(false);
  const isDraggingSpectrum = useRef(false);
  const isDraggingValue = useRef(false);
  const [storedHsv, setStoredHsv] = useState<HSVColor>(() => rgbToHsv(color));
  // #1071 — reconcile with the `color` prop during render. Syncing in an
  // effect left the cursors one colour behind: the render that positioned
  // them still saw the previous colour's HSV (e.g. the previously selected
  // gradient stop). Setting state during render makes React re-render before
  // committing, so the cursors never show a stale colour.
  const hsv = syncHsvToColor(storedHsv, color);
  if (hsv !== storedHsv) {
    setStoredHsv(hsv);
  }
  // Pointer handlers can fire several times between renders while dragging,
  // so they read and write the latest HSV through a ref.
  const hsvRef = useRef(hsv);
  useLayoutEffect(() => {
    hsvRef.current = hsv;
  }, [hsv]);

  // Draw SV gradient
  const drawSV = useCallback(() => {
    const canvas = svCanvasRef.current;
    const container = svContainerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width === 0 || height === 0) return;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', contextOptions);
    if (!ctx) return;

    const hsv = hsvRef.current;
    const hueColor = hsvToRgb({ h: hsv.h, s: 100, v: 100 });

    // White to hue-color horizontal gradient
    const hGrad = ctx.createLinearGradient(0, 0, width, 0);
    hGrad.addColorStop(0, '#ffffff');
    hGrad.addColorStop(1, `rgb(${hueColor.r},${hueColor.g},${hueColor.b})`);
    ctx.fillStyle = hGrad;
    ctx.fillRect(0, 0, width, height);

    // Transparent to black vertical gradient
    const vGrad = ctx.createLinearGradient(0, 0, 0, height);
    vGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vGrad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = vGrad;
    ctx.fillRect(0, 0, width, height);
  }, []);

  // Draw hue bar
  const drawHue = useCallback(() => {
    const canvas = hueCanvasRef.current;
    const container = hueContainerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width === 0 || height === 0) return;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', contextOptions);
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, width, 0);
    const stops = [
      [0, '#ff0000'],
      [1 / 6, '#ffff00'],
      [2 / 6, '#00ff00'],
      [3 / 6, '#00ffff'],
      [4 / 6, '#0000ff'],
      [5 / 6, '#ff00ff'],
      [1, '#ff0000'],
    ] as const;
    for (const [pos, c] of stops) {
      grad.addColorStop(pos, c);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }, []);

  // Draw alpha bar
  const drawAlpha = useCallback(() => {
    const canvas = alphaCanvasRef.current;
    const container = alphaContainerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width === 0 || height === 0) return;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', contextOptions);
    if (!ctx) return;

    const rgb = hsvToRgb(hsvRef.current);
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    grad.addColorStop(1, `rgb(${rgb.r},${rgb.g},${rgb.b})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }, []);

  // Draw spectrum bar (full rainbow at full saturation/brightness)
  const drawSpectrum = useCallback(() => {
    const canvas = spectrumCanvasRef.current;
    const container = spectrumContainerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width === 0 || height === 0) return;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', contextOptions);
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, width, 0);
    const stops = [
      [0, '#ff0000'],
      [1 / 6, '#ffff00'],
      [2 / 6, '#00ff00'],
      [3 / 6, '#00ffff'],
      [4 / 6, '#0000ff'],
      [5 / 6, '#ff00ff'],
      [1, '#ff0000'],
    ] as const;
    for (const [pos, c] of stops) {
      grad.addColorStop(pos, c);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }, []);

  // Draw the grayscale value ramp (black → white)
  const drawValueRamp = useCallback(() => {
    const canvas = valueCanvasRef.current;
    const container = valueContainerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width === 0 || height === 0) return;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', contextOptions);
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, '#000000');
    grad.addColorStop(1, '#ffffff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }, []);

  // Initial draws and redraw on color change or compact toggle
  useEffect(() => {
    drawSV();
    drawHue();
    drawAlpha();
    drawSpectrum();
    drawValueRamp();
  }, [hsv, color, compact, grayscale, drawSV, drawHue, drawAlpha, drawSpectrum, drawValueRamp]);

  // Resize observer for canvases — re-create when compact changes
  useEffect(() => {
    const containers = [
      svContainerRef.current,
      hueContainerRef.current,
      alphaContainerRef.current,
      spectrumContainerRef.current,
      valueContainerRef.current,
    ].filter((c): c is HTMLDivElement => c !== null);

    const observer = new ResizeObserver(() => {
      drawSV();
      drawHue();
      drawAlpha();
      drawSpectrum();
      drawValueRamp();
    });

    for (const c of containers) {
      observer.observe(c);
    }
    return () => observer.disconnect();
  }, [compact, grayscale, drawSV, drawHue, drawAlpha, drawSpectrum, drawValueRamp]);

  const emitColor = useCallback(
    (next: HSVColor) => {
      hsvRef.current = next;
      setStoredHsv(next);
      onChange({ ...hsvToRgb(next), a: color.a });
    },
    [onChange, color.a],
  );

  // SV interaction
  const handleSVInteraction = useCallback(
    (clientX: number, clientY: number) => {
      const container = svContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      emitColor({ h: hsvRef.current.h, s: x * 100, v: (1 - y) * 100 });
    },
    [emitColor],
  );

  const handleSVDown = useCallback(
    (e: React.MouseEvent) => {
      isDraggingSV.current = true;
      handleSVInteraction(e.clientX, e.clientY);
      e.preventDefault();
    },
    [handleSVInteraction],
  );

  // Hue interaction
  const handleHueInteraction = useCallback(
    (clientX: number) => {
      const container = hueContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      emitColor({ h: x * 360, s: hsvRef.current.s, v: hsvRef.current.v });
    },
    [emitColor],
  );

  const handleHueDown = useCallback(
    (e: React.MouseEvent) => {
      isDraggingHue.current = true;
      handleHueInteraction(e.clientX);
      e.preventDefault();
    },
    [handleHueInteraction],
  );

  // Alpha interaction
  const handleAlphaInteraction = useCallback(
    (clientX: number) => {
      const container = alphaContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const rgb = hsvToRgb(hsvRef.current);
      onChange({ ...rgb, a: Math.round(x * 100) / 100 });
    },
    [onChange],
  );

  const handleAlphaDown = useCallback(
    (e: React.MouseEvent) => {
      isDraggingAlpha.current = true;
      handleAlphaInteraction(e.clientX);
      e.preventDefault();
    },
    [handleAlphaInteraction],
  );

  // Spectrum interaction — picks a full color at 100% saturation/brightness
  const handleSpectrumInteraction = useCallback(
    (clientX: number) => {
      const container = spectrumContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      emitColor({ h: x * 360, s: 100, v: 100 });
    },
    [emitColor],
  );

  const handleSpectrumDown = useCallback(
    (e: React.MouseEvent) => {
      isDraggingSpectrum.current = true;
      handleSpectrumInteraction(e.clientX);
      e.preventDefault();
    },
    [handleSpectrumInteraction],
  );

  // Value-ramp interaction (grayscale documents) — emits a neutral R=G=B color
  const handleValueInteraction = useCallback(
    (clientX: number) => {
      const container = valueContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const v = Math.round(x * 255);
      onChange({ r: v, g: v, b: v, a: color.a });
    },
    [onChange, color.a],
  );

  const handleValueDown = useCallback(
    (e: React.MouseEvent) => {
      isDraggingValue.current = true;
      handleValueInteraction(e.clientX);
      e.preventDefault();
    },
    [handleValueInteraction],
  );

  // Global mouse move / up
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (isDraggingSV.current) {
        handleSVInteraction(e.clientX, e.clientY);
      } else if (isDraggingHue.current) {
        handleHueInteraction(e.clientX);
      } else if (isDraggingAlpha.current) {
        handleAlphaInteraction(e.clientX);
      } else if (isDraggingSpectrum.current) {
        handleSpectrumInteraction(e.clientX);
      } else if (isDraggingValue.current) {
        handleValueInteraction(e.clientX);
      }
    };

    const handleUp = () => {
      isDraggingSV.current = false;
      isDraggingHue.current = false;
      isDraggingAlpha.current = false;
      isDraggingSpectrum.current = false;
      isDraggingValue.current = false;
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [handleSVInteraction, handleHueInteraction, handleAlphaInteraction, handleSpectrumInteraction, handleValueInteraction]);

  const currentHex = formatHexInput(color);
  const [hexDraft, setHexDraft] = useState<HexDraft | null>(null);
  const liveDraft = hexDraft !== null && hexDraft.base === currentHex ? hexDraft : null;

  const handleHexChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setHexDraft({ text: e.target.value, base: currentHex });
    },
    [currentHex],
  );

  const commitHex = useCallback(() => {
    setHexDraft(null);
    if (!liveDraft) return;
    const parsed = parseHexInput(liveDraft.text);
    if (!parsed) return;
    if (parsed.r === color.r && parsed.g === color.g && parsed.b === color.b) return;
    onChange({ ...parsed, a: color.a });
  }, [liveDraft, color, onChange]);

  const handleHexKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitHex();
      } else if (e.key === 'Escape') {
        setHexDraft(null);
      }
    },
    [commitHex],
  );

  const hexField = showHex && !compact ? (
    <div className={styles.hexRow}>
      <span className={styles.hexLabel} aria-hidden="true">#</span>
      <input
        type="text"
        className={styles.hexInput}
        value={liveDraft ? liveDraft.text : currentHex}
        onChange={handleHexChange}
        onBlur={commitHex}
        onKeyDown={handleHexKeyDown}
        maxLength={7}
        spellCheck={false}
        autoComplete="off"
        aria-label="Hex color"
      />
    </div>
  ) : null;

  const svCursorX = `${hsv.s}%`;
  const svCursorY = `${100 - hsv.v}%`;
  const hueCursorX = `${(hsv.h / 360) * 100}%`;
  const alphaCursorX = `${color.a * 100}%`;

  const valueCursorX = `${(color.r / 255) * 100}%`;

  if (grayscale) {
    return (
      <div className={styles.picker} role="group" aria-label="Color picker">
        <div ref={valueContainerRef} className={styles.hueBar} onMouseDown={handleValueDown} role="slider" aria-label="Brightness" aria-valuemin={0} aria-valuemax={255} aria-valuenow={color.r} tabIndex={0}>
          <canvas ref={valueCanvasRef} aria-hidden="true" />
          <div className={styles.hueCursor} style={{ '--cursor-x': valueCursorX } as React.CSSProperties} />
        </div>
        {!compact && (
          <div ref={alphaContainerRef} className={styles.alphaBar} onMouseDown={handleAlphaDown} role="slider" aria-label="Opacity" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(color.a * 100)} tabIndex={0}>
            <canvas ref={alphaCanvasRef} aria-hidden="true" />
            <div className={styles.alphaCursor} style={{ '--cursor-x': alphaCursorX } as React.CSSProperties} />
          </div>
        )}
        {hexField}
      </div>
    );
  }

  return (
    <div className={styles.picker} role="group" aria-label="Color picker">
      {!compact && (
        <div ref={svContainerRef} className={styles.svArea} onMouseDown={handleSVDown} role="slider" aria-label="Saturation and brightness" aria-valuetext={`Saturation ${Math.round(hsv.s)}%, Brightness ${Math.round(hsv.v)}%`} tabIndex={0}>
          <canvas ref={svCanvasRef} aria-hidden="true" />
          <div className={styles.svCursor} style={{ '--cursor-x': svCursorX, '--cursor-y': svCursorY } as React.CSSProperties} />
        </div>
      )}
      {!compact && (
        <div ref={hueContainerRef} className={styles.hueBar} onMouseDown={handleHueDown} role="slider" aria-label="Hue" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)} tabIndex={0}>
          <canvas ref={hueCanvasRef} aria-hidden="true" />
          <div className={styles.hueCursor} style={{ '--cursor-x': hueCursorX } as React.CSSProperties} />
        </div>
      )}
      {compact && (
        <div ref={spectrumContainerRef} className={styles.hueBar} onMouseDown={handleSpectrumDown} role="slider" aria-label="Color spectrum" tabIndex={0}>
          <canvas ref={spectrumCanvasRef} aria-hidden="true" />
          <div className={styles.hueCursor} style={{ '--cursor-x': hueCursorX } as React.CSSProperties} />
        </div>
      )}
      {!compact && (
        <div ref={alphaContainerRef} className={styles.alphaBar} onMouseDown={handleAlphaDown} role="slider" aria-label="Opacity" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(color.a * 100)} tabIndex={0}>
          <canvas ref={alphaCanvasRef} aria-hidden="true" />
          <div className={styles.alphaCursor} style={{ '--cursor-x': alphaCursorX } as React.CSSProperties} />
        </div>
      )}
      {hexField}
    </div>
  );
}
