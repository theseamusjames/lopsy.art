import { useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { Lock, Unlock } from 'lucide-react';
import { useToolSettingsStore } from '../../tool-settings-store';
import {
  ASPECT_RATIO_PRESETS,
  MIN_ASPECT_RATIO_TERM,
  findAspectRatioPreset,
  parseAspectRatioDraft,
} from '../../../utils/aspect-ratio';
import styles from '../OptionsBar.module.css';

const CUSTOM_PRESET = 'custom';

interface RatioInputProps {
  value: number;
  label: string;
  onCommit: (value: number) => void;
}

/**
 * Holds what the user types as a draft and commits it only on blur or
 * Enter, so typing "5" over "1" isn't clamped or merged into "15"/"0.15"
 * mid-edit (#1563).
 */
function RatioInput({ value, label, onCommit }: RatioInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const parsed = parseAspectRatioDraft(draft);
    setDraft(null);
    if (parsed !== null) onCommit(parsed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setDraft(null);
      e.currentTarget.blur();
    }
  };

  return (
    <input
      className={styles.ratioInput}
      type="number"
      min={MIN_ASPECT_RATIO_TERM}
      step={1}
      value={draft ?? String(value)}
      aria-label={label}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  );
}

export function AspectRatioControl() {
  const aspectRatioW = useToolSettingsStore((s) => s.aspectRatioW);
  const aspectRatioH = useToolSettingsStore((s) => s.aspectRatioH);
  const aspectRatioLocked = useToolSettingsStore((s) => s.aspectRatioLocked);
  const setAspectRatioW = useToolSettingsStore((s) => s.setAspectRatioW);
  const setAspectRatioH = useToolSettingsStore((s) => s.setAspectRatioH);
  const setAspectRatioLocked = useToolSettingsStore((s) => s.setAspectRatioLocked);

  const preset = findAspectRatioPreset(aspectRatioW, aspectRatioH);

  const handleCommitW = (w: number) => {
    setAspectRatioW(w);
    setAspectRatioLocked(true);
  };

  const handleCommitH = (h: number) => {
    setAspectRatioH(h);
    setAspectRatioLocked(true);
  };

  const handlePresetChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const chosen = ASPECT_RATIO_PRESETS.find((p) => p.id === e.target.value);
    if (!chosen) return;
    setAspectRatioW(chosen.w);
    setAspectRatioH(chosen.h);
    setAspectRatioLocked(true);
  };

  return (
    <>
      <span className={styles.label}>Ratio</span>
      <div className={styles.ratioGroup}>
        <select
          className={styles.select}
          value={preset?.id ?? CUSTOM_PRESET}
          onChange={handlePresetChange}
          aria-label="Aspect ratio preset"
        >
          <option value={CUSTOM_PRESET} disabled>Custom</option>
          {ASPECT_RATIO_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <RatioInput value={aspectRatioW} label="Aspect ratio width" onCommit={handleCommitW} />
        <span className={styles.ratioSeparator} aria-hidden="true">:</span>
        <RatioInput value={aspectRatioH} label="Aspect ratio height" onCommit={handleCommitH} />
        <button
          className={`${styles.lockBtn} ${aspectRatioLocked ? styles.lockBtnActive : ''}`}
          type="button"
          onClick={() => setAspectRatioLocked(!aspectRatioLocked)}
          aria-label={aspectRatioLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
          aria-pressed={aspectRatioLocked}
          title={aspectRatioLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
        >
          {aspectRatioLocked ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
      </div>
    </>
  );
}
