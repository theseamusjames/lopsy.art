import { useCallback, useRef, useState } from 'react';
import { Download, Pipette, Plus, RotateCcw, Upload } from 'lucide-react';
import { IconButton } from '../../components/IconButton/IconButton';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { useEditorStore } from '../../app/editor-store';
import { useSwatchesStore } from '../../app/swatches-store';
import { extractDocumentPalette } from '../../app/extract-palette';
import { describeError, notifyError, notifyInfo } from '../../app/notifications-store';
import { convertColorToDocMode } from '../../utils/color-mode';
import { parseGpl, serializeGpl, swatchLabel } from './swatches';
import type { Swatch } from './swatches';
import type { Color } from '../../types';
import styles from './SwatchesPanel.module.css';

const ICON_SIZE = 14;
const EXTRACT_COUNTS = [4, 6, 8, 12, 16] as const;
const DEFAULT_EXTRACT_COUNT = 8;

function sameColor(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SwatchesPanel() {
  const swatches = useSwatchesStore((s) => s.swatches);
  const addSwatches = useSwatchesStore((s) => s.addSwatches);
  const removeSwatch = useSwatchesStore((s) => s.removeSwatch);
  const resetSwatches = useSwatchesStore((s) => s.resetSwatches);
  const foregroundColor = useToolSettingsStore((s) => s.foregroundColor);
  const setForegroundColor = useToolSettingsStore((s) => s.setForegroundColor);
  const setBackgroundColor = useToolSettingsStore((s) => s.setBackgroundColor);
  const colorMode = useEditorStore((s) => s.document.colorMode);
  const indexedPalette = useEditorStore((s) => s.document.indexedPalette);
  const [extractCount, setExtractCount] = useState(DEFAULT_EXTRACT_COUNT);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Swatches are document-independent, so a color picked into a Grayscale or
  // Indexed document goes through the same mode clamp as the Color panel.
  const toDocColor = useCallback(
    (c: Color) => convertColorToDocMode(c, colorMode, indexedPalette),
    [colorMode, indexedPalette],
  );

  const handleSwatchClick = useCallback(
    (e: React.MouseEvent, index: number, swatch: Swatch) => {
      if (e.altKey) {
        removeSwatch(index);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        setBackgroundColor(toDocColor(swatch.color));
        return;
      }
      setForegroundColor(toDocColor(swatch.color));
    },
    [removeSwatch, setBackgroundColor, setForegroundColor, toDocColor],
  );

  const handleAddForeground = useCallback(() => {
    addSwatches([{ color: foregroundColor, name: '' }]);
  }, [addSwatches, foregroundColor]);

  const handleExtract = useCallback(() => {
    try {
      const colors = extractDocumentPalette(extractCount);
      if (colors.length === 0) {
        notifyInfo('Nothing to extract — the image has no visible pixels');
        return;
      }
      const added = addSwatches(colors.map((color) => ({ color, name: '' })));
      notifyInfo(
        added === 0
          ? 'Every extracted color is already in the palette'
          : `Added ${added} color${added === 1 ? '' : 's'} from the image`,
      );
    } catch (err) {
      notifyError(`Failed to extract colors: ${describeError(err)}`);
    }
  }, [addSwatches, extractCount]);

  const handleImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const palette = parseGpl(await file.text());
        const added = addSwatches(palette.swatches);
        const source = palette.name || file.name;
        notifyInfo(`Imported ${added} swatch${added === 1 ? '' : 'es'} from "${source}"`);
      } catch (err) {
        notifyError(`Failed to import palette: ${describeError(err)}`);
      }
    },
    [addSwatches],
  );

  const handleExport = useCallback(() => {
    downloadText(serializeGpl(swatches, 'Lopsy Swatches'), 'lopsy-swatches.gpl');
  }, [swatches]);

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <IconButton
          icon={<Plus size={ICON_SIZE} />}
          label="Add Foreground Color"
          onClick={handleAddForeground}
        />
        <div className={styles.extractGroup}>
          <IconButton
            icon={<Pipette size={ICON_SIZE} />}
            label="Extract Colors from Image"
            onClick={handleExtract}
          />
          <select
            className={styles.select}
            value={extractCount}
            onChange={(e) => setExtractCount(Number(e.target.value))}
            aria-label="Colors to extract"
            title="Colors to extract"
          >
            {EXTRACT_COUNTS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <span className={styles.spacer} />
        <IconButton
          icon={<Upload size={ICON_SIZE} />}
          label="Import Palette (.gpl)"
          onClick={() => fileInputRef.current?.click()}
        />
        <IconButton
          icon={<Download size={ICON_SIZE} />}
          label="Export Palette (.gpl)"
          onClick={handleExport}
          disabled={swatches.length === 0}
        />
        <IconButton
          icon={<RotateCcw size={ICON_SIZE} />}
          label="Reset to Default Swatches"
          onClick={resetSwatches}
        />
        <input
          ref={fileInputRef}
          className={styles.fileInput}
          type="file"
          accept=".gpl,text/plain"
          onChange={handleImportFile}
          data-testid="swatches-file-input"
        />
      </div>
      {swatches.length === 0 ? (
        <p className={styles.empty}>No swatches. Add the foreground color or extract from the image.</p>
      ) : (
        <div className={styles.grid} role="group" aria-label="Swatches" data-testid="swatches-grid">
          {swatches.map((swatch, i) => {
            const label = swatchLabel(swatch);
            const isActive = sameColor(swatch.color, foregroundColor);
            return (
              <button
                key={`${i}-${label}`}
                type="button"
                className={isActive ? `${styles.swatch} ${styles.active}` : styles.swatch}
                style={{
                  '--swatch-color': `rgba(${swatch.color.r}, ${swatch.color.g}, ${swatch.color.b}, ${swatch.color.a})`,
                } as React.CSSProperties}
                title={`${label}\nClick: foreground · ⌘-click: background · ⌥-click: delete`}
                aria-label={`Swatch ${label}`}
                aria-pressed={isActive}
                onClick={(e) => handleSwatchClick(e, i, swatch)}
              />
            );
          })}
        </div>
      )}
      <p className={styles.hint}>
        {swatches.length} swatch{swatches.length === 1 ? '' : 'es'} · ⌘-click sets background · ⌥-click deletes
      </p>
    </div>
  );
}
