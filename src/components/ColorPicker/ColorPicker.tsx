import { useCallback, useEffect, useRef } from 'react';
import { rgbToHsv, hsvToRgb } from '../../utils/color';
import type { Color } from '../../types';
import styles from './ColorPicker.module.css';

interface ColorPickerProps {
  color: Color;
  onChange: (color: Color) => void;
}

export function ColorPicker({ color, onChange }: ColorPickerProps) {
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const svContainerRef = useRef<HTMLDivElement>(null);
  const hueCanvasRef = useRef<HTMLCanvasElement>(null);
  const hueContainerRef = useRef<HTMLDivElement>(null);
  const alphaCanvasRef = useRef<HTMLCanvasElement>(null);
  const alphaContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingSV = useRef(false);
  const isDraggingHue = useRef(false);
  const isDraggingAlpha = useRef(false);
  const hsvRef = useRef(rgbToHsv(color));

  // Keep HSV in sync with external color changes
  useEffect(() => {
    const newHsv = rgbToHsv(color);
    // Only update if the RGB actually differs (avoid overwriting hue when s=0 or v=0)
    const reconverted = hsvToRgb(hsvRef.current);
    if (reconverted.r !== color.r || reconverted.g !== color.g || reconverted.b !== color.b) {
      // Preserve hue when saturation or value is zero
      if (color.r === color.g && color.g === color.b) {
        hsvRef.current = { h: hsvRef.current.h, s: 0, v: newHsv.v };
      } else {
        hsvRef.current = newHsv;
      }
    }
  }, [color]);

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

    const ctx = canvas.getContext('2d');
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

    const ctx = canvas.getContext('2d');
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

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rgb = hsvToRgb(hsvRef.current);
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    grad.addColorStop(1, `rgb(${rgb.r},${rgb.g},${rgb.b})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }, []);

  // Initial draws and redraw on color change
  useEffect(() => {
    drawSV();
    drawHue();
    drawAlpha();
  }, [color, drawSV, drawHue, drawAlpha]);

  // Resize observer for canvases
  useEffect(() => {
    const containers = [svContainerRef.current, hueContainerRef.current, alphaContainerRef.current].filter(
      (c): c is HTMLDivElement => c !== null,
    );

    const observer = new ResizeObserver(() => {
      drawSV();
      drawHue();
      drawAlpha();
    });

    for (const c of containers) {
      observer.observe(c);
    }
    return () => observer.disconnect();
  }, [drawSV, drawHue, drawAlpha]);

  const emitColor = useCallback(
    (hsv: { h: number; s: number; v: number }) => {
      hsvRef.current = hsv;
      const rgb = hsvToRgb(hsv);
      onChange({ ...rgb, a: color.a });
      drawSV();
      drawAlpha();
    },
    [onChange, color.a, drawSV, drawAlpha],
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

  // Global mouse move / up
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (isDraggingSV.current) {
        handleSVInteraction(e.clientX, e.clientY);
      } else if (isDraggingHue.current) {
        handleHueInteraction(e.clientX);
      } else if (isDraggingAlpha.current) {
        handleAlphaInteraction(e.clientX);
      }
    };

    const handleUp = () => {
      isDraggingSV.current = false;
      isDraggingHue.current = false;
      isDraggingAlpha.current = false;
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [handleSVInteraction, handleHueInteraction, handleAlphaInteraction]);

  const hsv = hsvRef.current;
  const svCursorX = `${hsv.s}%`;
  const svCursorY = `${100 - hsv.v}%`;
  const hueCursorX = `${(hsv.h / 360) * 100}%`;
  const alphaCursorX = `${color.a * 100}%`;

  return (
    <div className={styles.picker}>
      <div ref={svContainerRef} className={styles.svArea} onMouseDown={handleSVDown}>
        <canvas ref={svCanvasRef} />
        <div className={styles.svCursor} style={{ left: svCursorX, top: svCursorY }} />
      </div>
      <div ref={hueContainerRef} className={styles.hueBar} onMouseDown={handleHueDown}>
        <canvas ref={hueCanvasRef} />
        <div className={styles.hueCursor} style={{ left: hueCursorX }} />
      </div>
      <div ref={alphaContainerRef} className={styles.alphaBar} onMouseDown={handleAlphaDown}>
        <canvas ref={alphaCanvasRef} />
        <div className={styles.alphaCursor} style={{ left: alphaCursorX }} />
      </div>
    </div>
  );
}
