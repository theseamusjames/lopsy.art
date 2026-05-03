import { useState, useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../../app/editor-store';
import { Slider } from '../Slider/Slider';
import {
  type ExportFormat,
  type ExportOptions,
  isLossyFormat,
  computeExportDimensions,
  FORMAT_LABEL,
} from '../../app/MenuBar/export-logic';
import styles from './ExportDialog.module.css';

const SCALE_PRESETS: { label: string; value: number }[] = [
  { label: '0.5×', value: 0.5 },
  { label: '1×', value: 1 },
  { label: '2×', value: 2 },
  { label: '3×', value: 3 },
];

const FORMATS: ExportFormat[] = ['png', 'jpeg', 'webp', 'bmp'];

interface ExportDialogProps {
  onExport: (options: ExportOptions) => void;
  onCancel: () => void;
  /** Async function that generates a preview blob given current options. */
  onPreviewRequest?: (options: ExportOptions) => Promise<string | null>;
}

export type { ExportDialogProps };

export function ExportDialog({ onExport, onCancel, onPreviewRequest }: ExportDialogProps) {
  const docName = useEditorStore((s) => s.document.name);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);

  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState(92);
  const [scale, setScale] = useState(1);
  const [customScaleInput, setCustomScaleInput] = useState('100');
  const [isCustomScale, setIsCustomScale] = useState(false);
  const [filename, setFilename] = useState(docName || 'export');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPreviewUrl = useRef<string | null>(null);

  const { width: outWidth, height: outHeight } = computeExportDimensions(docWidth, docHeight, scale);

  const currentOptions: ExportOptions = {
    format,
    quality: isLossyFormat(format) ? quality : 100,
    scale,
    filename,
  };

  // Request preview whenever relevant options change
  const requestPreview = useCallback((opts: ExportOptions) => {
    if (!onPreviewRequest) return;
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    previewDebounceRef.current = setTimeout(() => {
      setIsPreviewLoading(true);
      onPreviewRequest(opts)
        .then((url) => {
          // Revoke the old URL to avoid memory leaks
          if (prevPreviewUrl.current) {
            URL.revokeObjectURL(prevPreviewUrl.current);
          }
          prevPreviewUrl.current = url;
          setPreviewUrl(url);
        })
        .catch(() => {
          setPreviewUrl(null);
        })
        .finally(() => setIsPreviewLoading(false));
    }, 200);
  }, [onPreviewRequest]);

  useEffect(() => {
    requestPreview(currentOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, quality, scale, requestPreview]);

  // Revoke preview URL on unmount
  useEffect(() => {
    return () => {
      if (prevPreviewUrl.current) URL.revokeObjectURL(prevPreviewUrl.current);
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    };
  }, []);

  const handleFormatChange = useCallback((f: ExportFormat) => {
    setFormat(f);
  }, []);

  const handleScalePreset = useCallback((value: number) => {
    setScale(value);
    setCustomScaleInput(String(Math.round(value * 100)));
    setIsCustomScale(false);
  }, []);

  const handleCustomScaleChange = useCallback((raw: string) => {
    setCustomScaleInput(raw);
    setIsCustomScale(true);
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && parsed > 0) {
      setScale(parsed / 100);
    }
  }, []);

  const handleCustomScaleBlur = useCallback(() => {
    const parsed = parseFloat(customScaleInput);
    if (isNaN(parsed) || parsed <= 0) {
      setCustomScaleInput(String(Math.round(scale * 100)));
    }
  }, [customScaleInput, scale]);

  const handleExport = useCallback(() => {
    onExport(currentOptions);
  }, [onExport, currentOptions]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleExport();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }, [handleExport, onCancel]);

  const isPresetActive = (value: number) => !isCustomScale && scale === value;

  return (
    <div className={styles.overlay} role="presentation" onKeyDown={handleKeyDown}>
      <div className={styles.modal} role="dialog" aria-label="Export">
        <div className={styles.header}>
          <h2>Export</h2>
        </div>

        <div className={styles.body}>
          {/* Left: Preview */}
          <div className={styles.previewPane}>
            <div className={styles.previewBox}>
              {isPreviewLoading && <div className={styles.previewLoading}>Loading…</div>}
              {!isPreviewLoading && previewUrl && (
                <img
                  src={previewUrl}
                  alt="Export preview"
                  className={styles.previewImage}
                />
              )}
              {!isPreviewLoading && !previewUrl && (
                <div className={styles.previewPlaceholder}>Preview</div>
              )}
            </div>
            <div className={styles.previewDims}>
              {outWidth} × {outHeight} px
            </div>
          </div>

          {/* Right: Options */}
          <div className={styles.optionsPane}>
            {/* Format */}
            <div className={styles.section}>
              <span className={styles.sectionLabel}>Format</span>
              <div className={styles.formatGrid}>
                {FORMATS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`${styles.formatButton} ${format === f ? styles.formatButtonActive : ''}`}
                    onClick={() => handleFormatChange(f)}
                  >
                    {FORMAT_LABEL[f]}
                  </button>
                ))}
              </div>
            </div>

            {/* Quality — only for lossy */}
            {isLossyFormat(format) && (
              <div className={styles.section}>
                <Slider
                  label="Quality"
                  value={quality}
                  min={1}
                  max={100}
                  step={1}
                  onChange={setQuality}
                  suffix="%"
                />
              </div>
            )}

            {/* Scale */}
            <div className={styles.section}>
              <span className={styles.sectionLabel}>Scale</span>
              <div className={styles.scaleRow}>
                {SCALE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className={`${styles.scaleButton} ${isPresetActive(preset.value) ? styles.scaleButtonActive : ''}`}
                    onClick={() => handleScalePreset(preset.value)}
                  >
                    {preset.label}
                  </button>
                ))}
                <div className={styles.customScaleWrapper}>
                  <input
                    type="number"
                    className={`${styles.customScaleInput} ${isCustomScale ? styles.customScaleInputActive : ''}`}
                    value={customScaleInput}
                    min="1"
                    max="1000"
                    step="1"
                    aria-label="Custom scale percentage"
                    onChange={(e) => handleCustomScaleChange(e.target.value)}
                    onBlur={handleCustomScaleBlur}
                    onFocus={() => setIsCustomScale(true)}
                  />
                  <span className={styles.customScaleSuffix}>%</span>
                </div>
              </div>
            </div>

            {/* Filename */}
            <div className={styles.section}>
              <label className={styles.sectionLabel} htmlFor="export-filename">
                Filename
              </label>
              <div className={styles.filenameRow}>
                <input
                  id="export-filename"
                  type="text"
                  className={styles.filenameInput}
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  spellCheck={false}
                />
                <span className={styles.filenameExt}>.{format === 'jpeg' ? 'jpg' : format}</span>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelButton} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.exportButton} type="button" onClick={handleExport}>
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
