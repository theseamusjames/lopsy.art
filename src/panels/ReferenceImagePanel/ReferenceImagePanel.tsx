import { useCallback, useEffect, useRef, useState } from 'react';
import { FlipHorizontal, FlipVertical, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { IconButton } from '../../components/IconButton/IconButton';
import { useUIStore } from '../../app/ui-store';
import styles from './ReferenceImagePanel.module.css';

interface ReferenceImage {
  id: string;
  url: string;
  name: string;
  width: number;
  height: number;
}

interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
  opacity: number;
  flipH: boolean;
  flipV: boolean;
}

const DEFAULT_VIEW: ViewState = {
  zoom: 1,
  panX: 0,
  panY: 0,
  opacity: 100,
  flipH: false,
  flipV: false,
};

function loadImage(file: File): Promise<ReferenceImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({
      id: crypto.randomUUID(),
      url,
      name: file.name,
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load ${file.name}`));
    };
    img.src = url;
  });
}

export function ReferenceImagePanel() {
  const setShowReferenceModal = useUIStore((s) => s.setShowReferenceModal);
  const [images, setImages] = useState<ReferenceImage[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [views, setViews] = useState<Map<string, ViewState>>(new Map());
  const [isDragOver, setIsDragOver] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origPanX: number; origPanY: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeImage = images[activeIndex] ?? null;
  const activeView = activeImage ? (views.get(activeImage.id) ?? DEFAULT_VIEW) : DEFAULT_VIEW;

  const updateView = useCallback((imageId: string, patch: Partial<ViewState>) => {
    setViews((prev) => {
      const next = new Map(prev);
      const current = prev.get(imageId) ?? { ...DEFAULT_VIEW };
      next.set(imageId, { ...current, ...patch });
      return next;
    });
  }, []);

  const fitToContainer = useCallback((image: ReferenceImage) => {
    const el = containerRef.current;
    if (!el) return;
    const containerW = el.clientWidth;
    const containerH = el.clientHeight;
    const scale = Math.min(containerW / image.width, containerH / image.height, 1);
    const panX = (containerW - image.width * scale) / 2;
    const panY = (containerH - image.height * scale) / 2;
    updateView(image.id, { zoom: scale, panX, panY });
  }, [updateView]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const loaded: ReferenceImage[] = [];
    for (const file of imageFiles) {
      try {
        loaded.push(await loadImage(file));
      } catch {
        // skip unloadable files
      }
    }
    if (loaded.length === 0) return;

    setImages((prev) => {
      const next = [...prev, ...loaded];
      setActiveIndex(next.length - 1);
      return next;
    });

    requestAnimationFrame(() => {
      const last = loaded[loaded.length - 1];
      if (last) fitToContainer(last);
    });
  }, [fitToContainer]);

  useEffect(() => {
    if (activeImage && !views.has(activeImage.id)) {
      requestAnimationFrame(() => fitToContainer(activeImage));
    }
  }, [activeImage, views, fitToContainer]);

  const handleFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!activeImage) return;
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.07 : 1 / 1.07;
    const newZoom = Math.max(0.05, Math.min(20, activeView.zoom * factor));

    const dx = mouseX - activeView.panX;
    const dy = mouseY - activeView.panY;
    const newPanX = mouseX - dx * (newZoom / activeView.zoom);
    const newPanY = mouseY - dy * (newZoom / activeView.zoom);

    updateView(activeImage.id, { zoom: newZoom, panX: newPanX, panY: newPanY });
  }, [activeImage, activeView, updateView]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!activeImage) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, [role="slider"]')) return;

    e.stopPropagation();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origPanX: activeView.panX,
      origPanY: activeView.panY,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [activeImage, activeView]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !activeImage) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    updateView(activeImage.id, {
      panX: dragRef.current.origPanX + dx,
      panY: dragRef.current.origPanY + dy,
    });
  }, [activeImage, updateView]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const scaleX = activeView.zoom * (activeView.flipH ? -1 : 1);
  const scaleY = activeView.zoom * (activeView.flipV ? -1 : 1);
  const offsetX = activeView.flipH && activeImage ? activeImage.width * activeView.zoom : 0;
  const offsetY = activeView.flipV && activeImage ? activeImage.height * activeView.zoom : 0;
  const imageTransform = `translate(${activeView.panX + offsetX}px, ${activeView.panY + offsetY}px) scale(${scaleX}, ${scaleY})`;

  const stopPropagation = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
  }, []);

  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  const handleResizeDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const drawer = (e.currentTarget as HTMLElement).closest('[data-testid="reference-drawer"]') as HTMLElement | null;
    if (!drawer) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origW: drawer.offsetWidth,
      origH: drawer.offsetHeight,
    };
  }, []);

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const drawer = (e.currentTarget as HTMLElement).closest('[data-testid="reference-drawer"]') as HTMLElement | null;
    if (!drawer) return;
    const dx = e.clientX - resizeRef.current.startX;
    const dy = e.clientY - resizeRef.current.startY;
    drawer.style.width = `${Math.max(200, resizeRef.current.origW + dx)}px`;
    drawer.style.height = `${Math.max(200, resizeRef.current.origH + dy)}px`;
  }, []);

  const handleResizeUp = useCallback(() => {
    resizeRef.current = null;
  }, []);

  return (
    <div className={styles.drawer}>
      <div className={styles.drawerHeader}>
        <span className={styles.drawerTitle}>Reference</span>
        <IconButton
          icon={<X size={14} />}
          label="Close reference"
          onClick={() => setShowReferenceModal(false)}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className={styles.hiddenInput}
        onChange={handleFileChange}
        data-testid="reference-file-input"
      />

      {images.length === 0 ? (
        <div
          className={`${styles.dropZone} ${isDragOver ? styles.dropZoneDragOver : ''}`}
          onClick={handleFileInput}
          onPointerDown={(e) => e.stopPropagation()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          data-testid="reference-drop-zone"
        >
          <ImagePlus size={24} className={styles.dropZoneIcon} />
          <span className={styles.dropZoneText}>
            Drop an image here or click to browse
          </span>
        </div>
      ) : (
        <div className={styles.viewer} data-testid="reference-viewer">
          <div
            ref={containerRef}
            className={styles.previewContainer}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            data-testid="reference-preview"
          >
            {activeImage && (
              <img
                src={activeImage.url}
                alt={activeImage.name}
                className={styles.previewImage}
                style={{
                  transform: imageTransform,
                  width: activeImage.width,
                  height: activeImage.height,
                  opacity: activeView.opacity / 100,
                }}
                draggable={false}
              />
            )}
          </div>

          {activeImage && (
            <div className={styles.controlsBar} onPointerDown={stopPropagation}>
              <label className={styles.controlLabel}>
                Opacity
                <input
                  type="number"
                  className={styles.controlInput}
                  aria-label="Opacity value"
                  min={0}
                  max={100}
                  value={activeView.opacity}
                  onChange={(e) => updateView(activeImage.id, { opacity: Math.max(0, Math.min(100, Number(e.target.value))) })}
                />
              </label>
              <IconButton
                icon={<FlipHorizontal size={14} />}
                label="Flip horizontal"
                onClick={() => updateView(activeImage.id, { flipH: !activeView.flipH })}
              />
              <IconButton
                icon={<FlipVertical size={14} />}
                label="Flip vertical"
                onClick={() => updateView(activeImage.id, { flipV: !activeView.flipV })}
              />
              <IconButton
                icon={<Trash2 size={14} />}
                label="Remove image"
                onClick={() => {
                  URL.revokeObjectURL(activeImage.url);
                  setImages((prev) => {
                    const next = prev.filter((img) => img.id !== activeImage.id);
                    setActiveIndex(Math.min(activeIndex, Math.max(0, next.length - 1)));
                    return next;
                  });
                  setViews((prev) => {
                    const next = new Map(prev);
                    next.delete(activeImage.id);
                    return next;
                  });
                }}
              />
            </div>
          )}

          <div
            className={styles.thumbnailStrip}
            onPointerDown={stopPropagation}
            data-testid="reference-thumbnails"
          >
            {images.map((img, i) => (
              <img
                key={img.id}
                src={img.url}
                alt={img.name}
                className={`${styles.thumbnail} ${i === activeIndex ? styles.thumbnailActive : ''}`}
                onClick={() => setActiveIndex(i)}
                draggable={false}
              />
            ))}
            <button
              className={styles.addButton}
              onClick={handleFileInput}
              type="button"
              aria-label="Add reference image"
              data-testid="reference-add-button"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
      )}
      <div
        className={styles.resizeHandle}
        onPointerDown={handleResizeDown}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeUp}
      />
    </div>
  );
}
