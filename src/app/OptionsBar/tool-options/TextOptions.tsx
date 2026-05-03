import { useCallback, useMemo } from 'react';
import { useToolSettingsStore } from '../../tool-settings-store';
import { useEditorStore } from '../../editor-store';
import { useUIStore } from '../../ui-store';
import { Slider } from '../../../components/Slider/Slider';
import { FontPicker } from '../../../components/FontPicker/FontPicker';
import { fontsByFamily } from '../../../utils/font-catalog';
import { extractFamilyName, loadGoogleFont, loadFontBinaryToEngine } from '../../../utils/font-loader';
import { getEngine } from '../../../engine-wasm/engine-state';
import { rerenderCommittedTextLayer, invalidatePathTextCache } from '../../../engine-wasm/engine-sync';
import type { TextLayer, FontStyle, TextAlign } from '../../../types';
import styles from '../OptionsBar.module.css';
import decorationStyles from './TextOptions.module.css';

const WEIGHT_LABELS: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
  1000: 'UltraBlack',
};

export function TextOptions() {
  const textFontSize = useToolSettingsStore((s) => s.textFontSize);
  const textFontFamily = useToolSettingsStore((s) => s.textFontFamily);
  const textFontWeight = useToolSettingsStore((s) => s.textFontWeight);
  const textFontStyle = useToolSettingsStore((s) => s.textFontStyle);
  const textAlign = useToolSettingsStore((s) => s.textAlign);
  const textUnderline = useToolSettingsStore((s) => s.textUnderline);
  const textStrikethrough = useToolSettingsStore((s) => s.textStrikethrough);
  const setTextFontSize = useToolSettingsStore((s) => s.setTextFontSize);
  const setTextFontFamily = useToolSettingsStore((s) => s.setTextFontFamily);
  const setTextFontWeight = useToolSettingsStore((s) => s.setTextFontWeight);
  const setTextFontStyle = useToolSettingsStore((s) => s.setTextFontStyle);
  const setTextAlign = useToolSettingsStore((s) => s.setTextAlign);
  const setTextUnderline = useToolSettingsStore((s) => s.setTextUnderline);
  const setTextStrikethrough = useToolSettingsStore((s) => s.setTextStrikethrough);

  // Path-on-text: the currently editing / active text layer + available paths
  const textEditing = useUIStore((s) => s.textEditing);
  const paths = useEditorStore((s) => s.paths);
  const updateTextLayerProperties = useEditorStore((s) => s.updateTextLayerProperties);
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);
  const layers = useEditorStore((s) => s.document.layers);

  const editingLayerId = textEditing?.layerId ?? activeLayerId;
  const editingLayer = layers.find((l) => l.id === editingLayerId && l.type === 'text');
  const currentPathId = editingLayer?.type === 'text' ? (editingLayer.pathId ?? '') : '';

  const handlePathChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!editingLayerId) return;
      const val = e.target.value;
      updateTextLayerProperties(editingLayerId, { pathId: val || undefined });
    },
    [editingLayerId, updateTextLayerProperties],
  );

  const fontEntry = useMemo(() => {
    const family = extractFamilyName(textFontFamily);
    return fontsByFamily.get(family);
  }, [textFontFamily]);

  const availableWeights = fontEntry?.weights ?? [400, 700];

  // Path-on-text: the currently editing / active text layer + available paths
  const textEditing = useUIStore((s) => s.textEditing);
  const paths = useEditorStore((s) => s.paths);
  const updateTextLayerProperties = useEditorStore((s) => s.updateTextLayerProperties);
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);
  const layers = useEditorStore((s) => s.document.layers);

  const editingLayerId = textEditing?.layerId ?? activeLayerId;
  const editingLayer = layers.find((l) => l.id === editingLayerId && l.type === 'text');
  const currentPathId = editingLayer?.type === 'text' ? (editingLayer.pathId ?? '') : '';

  const handlePathChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!editingLayerId || !editingLayer || editingLayer.type !== 'text') return;
      const val = e.target.value;
      if (val) {
        updateTextLayerProperties(editingLayerId, {
          pathId: val,
          prePathX: editingLayer.prePathX ?? editingLayer.x,
          prePathY: editingLayer.prePathY ?? editingLayer.y,
        });
      } else {
        const restoreX = editingLayer.prePathX ?? editingLayer.x;
        const restoreY = editingLayer.prePathY ?? editingLayer.y;
        invalidatePathTextCache(editingLayerId);
        updateTextLayerProperties(editingLayerId, {
          pathId: undefined,
          prePathX: undefined,
          prePathY: undefined,
          x: restoreX,
          y: restoreY,
        });
        const engine = getEngine();
        if (engine) {
          const restored = { ...editingLayer, x: restoreX, y: restoreY, pathId: undefined } as TextLayer;
          const pos = rerenderCommittedTextLayer(engine, restored);
          if (pos) {
            updateTextLayerProperties(editingLayerId, { x: pos.x, y: pos.y });
          }
        }
      }
    },
    [editingLayerId, editingLayer, updateTextLayerProperties],
  );

  const handleFontChange = useCallback(
    (value: string) => {
      setTextFontFamily(value);
      const family = extractFamilyName(value);
      const entry = fontsByFamily.get(family);
      if (entry) {
        if (!entry.weights.includes(textFontWeight)) {
          const nearest = entry.weights.reduce((prev, curr) =>
            Math.abs(curr - textFontWeight) < Math.abs(prev - textFontWeight) ? curr : prev,
          );
          setTextFontWeight(nearest);
        }
        if (entry.source === 'google') {
          loadGoogleFont(family, entry.weights);
          // Load binary for the currently selected weight so the engine can
          // render this font natively. Other weights load on-demand below.
          const targetWeight = entry.weights.includes(textFontWeight)
            ? textFontWeight
            : entry.weights.reduce((prev, curr) =>
                Math.abs(curr - textFontWeight) < Math.abs(prev - textFontWeight) ? curr : prev,
              );
          loadFontBinaryToEngine(family, targetWeight);
        }
      }
    },
    [textFontWeight, setTextFontFamily, setTextFontWeight],
  );

  return (
    <>
      <Slider label="Size" value={textFontSize} min={1} max={500} onChange={setTextFontSize} />
      <label className={styles.label} id="text-font-label">Font</label>
      <FontPicker value={textFontFamily} onChange={handleFontChange} />
      <select
        className={styles.select}
        value={textFontWeight}
        onChange={(e) => {
          const w = Number(e.target.value);
          setTextFontWeight(w);
          if (fontEntry?.source === 'google') {
            const family = extractFamilyName(textFontFamily);
            loadFontBinaryToEngine(family, w);
          }
        }}
        aria-label="Font weight"
      >
        {availableWeights.map((w) => (
          <option key={w} value={w}>{WEIGHT_LABELS[w] ?? String(w)}</option>
        ))}
      </select>
      <select
        className={styles.select}
        value={textFontStyle}
        onChange={(e) => setTextFontStyle(e.target.value as FontStyle)}
        aria-label="Font style"
      >
        <option value="normal">Normal</option>
        <option value="italic">Italic</option>
      </select>
      <label className={styles.label} id="text-align-label">Align</label>
      <select
        className={styles.select}
        value={textAlign}
        onChange={(e) => setTextAlign(e.target.value as TextAlign)}
        aria-labelledby="text-align-label"
      >
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
        <option value="justify">Justify</option>
      </select>
      <div className={decorationStyles.decorationGroup}>
        <button
          className={`${decorationStyles.decorationBtn} ${textUnderline ? decorationStyles.decorationBtnActive : ''}`}
          onClick={() => setTextUnderline(!textUnderline)}
          aria-label="Toggle underline"
          aria-pressed={textUnderline}
          title="Underline"
        >
          <span className={decorationStyles.underlineIcon}>U</span>
        </button>
        <button
          className={`${decorationStyles.decorationBtn} ${textStrikethrough ? decorationStyles.decorationBtnActive : ''}`}
          onClick={() => setTextStrikethrough(!textStrikethrough)}
          aria-label="Toggle strikethrough"
          aria-pressed={textStrikethrough}
          title="Strikethrough"
        >
          <span className={decorationStyles.strikethroughIcon}>S</span>
        </button>
      </div>
      {paths.length > 0 && (
        <>
          <label className={styles.label} id="text-path-label">Path</label>
          <select
            className={styles.select}
            value={currentPathId}
            onChange={handlePathChange}
            aria-labelledby="text-path-label"
            aria-label="Text path"
          >
            <option value="">None</option>
            {paths.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </>
      )}
    </>
  );
}
