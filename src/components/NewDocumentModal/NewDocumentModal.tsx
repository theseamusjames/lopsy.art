import { useState, useCallback, useEffect } from 'react';
import styles from './NewDocumentModal.module.css';

type Unit = 'px' | 'in';
type BackgroundType = 'white' | 'transparent';

interface Preset {
  name: string;
  width: number;
  height: number;
  unit: Unit;
  dpi: number;
}

interface ClipboardImageInfo {
  width: number;
  height: number;
  blob: Blob;
}

const PRESETS: Preset[] = [
  { name: 'Web 1080p', width: 1920, height: 1080, unit: 'px', dpi: 72 },
  { name: 'Web 720p', width: 1280, height: 720, unit: 'px', dpi: 72 },
  { name: 'Instagram Post', width: 1080, height: 1080, unit: 'px', dpi: 72 },
  { name: 'US Letter', width: 8.5, height: 11, unit: 'in', dpi: 300 },
  { name: 'A4', width: 8.27, height: 11.69, unit: 'in', dpi: 300 },
  { name: '4K UHD', width: 3840, height: 2160, unit: 'px', dpi: 72 },
];

function toPixels(value: number, unit: Unit, dpi: number): number {
  if (unit === 'in') return Math.round(value * dpi);
  return Math.round(value);
}

interface NewDocumentModalProps {
  onCreateDocument: (width: number, height: number, background: BackgroundType) => void;
  onOpenFile: (file: File) => void;
  onPasteClipboard?: (blob: Blob) => void;
  onCancel?: () => void;
}

export function NewDocumentModal({ onCreateDocument, onOpenFile, onPasteClipboard, onCancel }: NewDocumentModalProps) {
  const [width, setWidth] = useState('1920');
  const [height, setHeight] = useState('1080');
  const [unit, setUnit] = useState<Unit>('px');
  const [dpi, setDpi] = useState('72');
  const [background, setBackground] = useState<BackgroundType>('white');
  const [activePreset, setActivePreset] = useState<number | 'clipboard' | null>(0);
  const [clipboardImage, setClipboardImage] = useState<ClipboardImageInfo | null>(null);

  // Probe clipboard for image data when the modal mounts
  useEffect(() => {
    let cancelled = false;
    navigator.clipboard.read().then(async (items) => {
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const bitmap = await createImageBitmap(blob);
          if (!cancelled) {
            setClipboardImage({ width: bitmap.width, height: bitmap.height, blob });
            setActivePreset('clipboard');
            setWidth(String(bitmap.width));
            setHeight(String(bitmap.height));
            setUnit('px');
            setDpi('72');
          }
          bitmap.close();
          return;
        }
      }
    }).catch(() => {
      // Clipboard read not available or denied — no template shown
    });
    return () => { cancelled = true; };
  }, []);

  const handleClipboardPresetClick = useCallback(() => {
    if (!clipboardImage) return;
    setWidth(String(clipboardImage.width));
    setHeight(String(clipboardImage.height));
    setUnit('px');
    setDpi('72');
    setActivePreset('clipboard');
  }, [clipboardImage]);

  const handlePresetClick = useCallback((index: number) => {
    const preset = PRESETS[index];
    if (!preset) return;
    setActivePreset(index);
    setWidth(String(preset.width));
    setHeight(String(preset.height));
    setUnit(preset.unit);
    setDpi(String(preset.dpi));
  }, []);

  const handleUnitChange = useCallback((newUnit: Unit) => {
    const currentDpi = parseInt(dpi, 10) || 72;
    const wNum = parseFloat(width) || 0;
    const hNum = parseFloat(height) || 0;

    if (unit === 'px' && newUnit === 'in') {
      setWidth((wNum / currentDpi).toFixed(2));
      setHeight((hNum / currentDpi).toFixed(2));
    } else if (unit === 'in' && newUnit === 'px') {
      setWidth(String(Math.round(wNum * currentDpi)));
      setHeight(String(Math.round(hNum * currentDpi)));
    }
    setUnit(newUnit);
    setActivePreset(null);
  }, [unit, dpi, width, height]);

  const handleCreate = useCallback(() => {
    if (activePreset === 'clipboard' && clipboardImage && onPasteClipboard) {
      onPasteClipboard(clipboardImage.blob);
      return;
    }
    const wNum = parseFloat(width) || 1;
    const hNum = parseFloat(height) || 1;
    const dpiNum = parseInt(dpi, 10) || 72;
    const pxW = Math.max(1, Math.min(16384, toPixels(wNum, unit, dpiNum)));
    const pxH = Math.max(1, Math.min(16384, toPixels(hNum, unit, dpiNum)));
    onCreateDocument(pxW, pxH, background);
  }, [width, height, unit, dpi, background, onCreateDocument, activePreset, clipboardImage, onPasteClipboard]);

  const handleOpenFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.psd';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) onOpenFile(file);
    };
    input.click();
  }, [onOpenFile]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      onCancel();
    }
  }, [handleCreate, onCancel]);

  return (
    <div className={styles.overlay}>
      <div className={styles.modal} onKeyDown={handleKeyDown}>
        <div className={styles.header}>
          <h2>New Document</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.presets}>
            <span className={styles.presetsLabel}>Presets</span>
            <div className={styles.presetGrid}>
              {PRESETS.map((preset, i) => (
                <button
                  key={preset.name}
                  className={`${styles.presetButton} ${i === activePreset ? styles.presetButtonActive : ''}`}
                  onClick={() => handlePresetClick(i)}
                >
                  <span className={styles.presetName}>{preset.name}</span>
                  <span className={styles.presetDims}>
                    {preset.width} × {preset.height} {preset.unit}
                  </span>
                </button>
              ))}
            </div>
            {clipboardImage && (
              <button
                className={`${styles.presetButton} ${styles.clipboardPreset} ${activePreset === 'clipboard' ? styles.presetButtonActive : ''}`}
                onClick={handleClipboardPresetClick}
              >
                <span className={styles.presetName}>From Clipboard</span>
                <span className={styles.presetDims}>
                  {clipboardImage.width} × {clipboardImage.height} px
                </span>
              </button>
            )}
          </div>

          <hr className={styles.divider} />

          <div className={styles.dimensions}>
            <div className={styles.dimensionRow}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Width</label>
                <input
                  className={styles.fieldInput}
                  type="number"
                  min="1"
                  step={unit === 'in' ? '0.01' : '1'}
                  value={width}
                  onChange={(e) => { setWidth(e.target.value); setActivePreset(null); }}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Height</label>
                <input
                  className={styles.fieldInput}
                  type="number"
                  min="1"
                  step={unit === 'in' ? '0.01' : '1'}
                  value={height}
                  onChange={(e) => { setHeight(e.target.value); setActivePreset(null); }}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Unit</label>
                <select
                  className={styles.unitSelect}
                  value={unit}
                  onChange={(e) => handleUnitChange(e.target.value as Unit)}
                >
                  <option value="px">Pixels</option>
                  <option value="in">Inches</option>
                </select>
              </div>
            </div>

            {unit === 'in' && (
              <div className={styles.dpiRow}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Resolution (DPI)</label>
                  <input
                    className={styles.fieldInput}
                    type="number"
                    min="1"
                    max="1200"
                    value={dpi}
                    onChange={(e) => { setDpi(e.target.value); setActivePreset(null); }}
                  />
                </div>
              </div>
            )}

            <div className={styles.bgRow}>
              <span className={styles.fieldLabel}>Background</span>
              <label className={styles.bgOption}>
                <input
                  type="radio"
                  name="bg"
                  checked={background === 'white'}
                  onChange={() => setBackground('white')}
                />
                <span className={`${styles.bgSwatch} ${styles.bgSwatchWhite}`} />
                White
              </label>
              <label className={styles.bgOption}>
                <input
                  type="radio"
                  name="bg"
                  checked={background === 'transparent'}
                  onChange={() => setBackground('transparent')}
                />
                <span className={`${styles.bgSwatch} ${styles.bgSwatchTransparent}`} />
                Transparent
              </label>
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.openFileButton} onClick={handleOpenFile}>
            Open File…
          </button>
          <div className={styles.footerRight}>
            {onCancel && (
              <button className={styles.openFileButton} onClick={onCancel}>
                Cancel
              </button>
            )}
            <button className={styles.createButton} onClick={handleCreate}>
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
