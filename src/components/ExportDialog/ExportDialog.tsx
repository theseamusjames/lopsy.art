import { useState, useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../../app/editor-store';
import { Slider } from '../Slider/Slider';
import { Button } from '../Button/Button';
import {
  type ExportFormat,
  type ExportOptions,
  isLossyFormat,
  FORMAT_LABEL,
} from '../../app/MenuBar/export-logic';
import styles from './ExportDialog.module.css';

const FORMATS: ExportFormat[] = ['png', 'jpeg', 'webp', 'bmp'];

/**
 * A cached preview source (the composited & downscaled thumbnail). The
 * dialog holds one per open — every format/quality change re-encodes it
 * via `encode`, so we don't re-composite a 4K document per option change
 * (#762). `encode` returns a blob URL the dialog must revoke.
 */
export interface ExportPreviewSourceHandle {
  encode: (options: ExportOptions) => Promise<string | null>;
}

interface ExportDialogProps {
  onExport: (options: ExportOptions) => void;
  onCancel: () => void;
  /**
   * Called once when the dialog opens to build a reusable preview source
   * (the expensive full-document composite happens here). Returning null
   * disables the preview pane.
   */
  onPreviewSourceRequest?: () => ExportPreviewSourceHandle | null;
}

export type { ExportDialogProps };

export function ExportDialog({ onExport, onCancel, onPreviewSourceRequest }: ExportDialogProps) {
  const docName = useEditorStore((s) => s.document.name);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);

  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState(92);
  const [highQuality, setHighQuality] = useState(false);
  const [filename, setFilename] = useState(docName || 'lopsy');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPreviewUrl = useRef<string | null>(null);
  // #762: composite + downscale runs ONCE per dialog open. Every format
  // click and Quality-slider pause re-runs only the small toBlob call.
  const previewSourceRef = useRef<ExportPreviewSourceHandle | null>(null);
  const [sourceReady, setSourceReady] = useState(false);

  const currentOptions: ExportOptions = {
    format,
    quality: isLossyFormat(format) ? quality : 100,
    highQuality,
    filename,
  };

  // Build the preview source once per dialog open. The composite is the
  // expensive part; caching it lets option changes re-encode cheaply.
  useEffect(() => {
    if (!onPreviewSourceRequest) return;
    setIsPreviewLoading(true);
    const source = onPreviewSourceRequest();
    previewSourceRef.current = source;
    setSourceReady(true);
    if (!source) setIsPreviewLoading(false);
  }, [onPreviewSourceRequest]);

  const requestPreview = useCallback((opts: ExportOptions) => {
    const source = previewSourceRef.current;
    if (!source) return;
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    previewDebounceRef.current = setTimeout(() => {
      setIsPreviewLoading(true);
      source
        .encode(opts)
        .then((url) => {
          if (prevPreviewUrl.current) {
            URL.revokeObjectURL(prevPreviewUrl.current);
          }
          prevPreviewUrl.current = url;
          setPreviewUrl(url);
        })
        .catch(() => setPreviewUrl(null))
        .finally(() => setIsPreviewLoading(false));
    }, 200);
  }, []);

  useEffect(() => {
    if (!sourceReady) return;
    requestPreview(currentOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, quality, highQuality, sourceReady, requestPreview]);

  useEffect(() => {
    return () => {
      if (prevPreviewUrl.current) URL.revokeObjectURL(prevPreviewUrl.current);
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    };
  }, []);

  const handleFormatChange = useCallback((f: ExportFormat) => {
    setFormat(f);
  }, []);

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
              {docWidth} × {docHeight} px
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

            {/* PNG Quality toggle */}
            {format === 'png' && (
              <div className={styles.section}>
                <span className={styles.sectionLabel}>Quality</span>
                <div className={styles.scaleRow}>
                  <button
                    type="button"
                    className={`${styles.scaleButton} ${!highQuality ? styles.scaleButtonActive : ''}`}
                    onClick={() => setHighQuality(false)}
                  >
                    Regular
                  </button>
                  <button
                    type="button"
                    className={`${styles.scaleButton} ${highQuality ? styles.scaleButtonActive : ''}`}
                    onClick={() => setHighQuality(true)}
                  >
                    High
                  </button>
                </div>
              </div>
            )}

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
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleExport}>
            Export
          </Button>
        </div>
      </div>
    </div>
  );
}
