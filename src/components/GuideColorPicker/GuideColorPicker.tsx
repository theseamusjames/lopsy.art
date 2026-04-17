import { useEffect } from 'react';
import { useUIStore } from '../../app/ui-store';
import { ColorPicker } from '../ColorPicker/ColorPicker';
import styles from './GuideColorPicker.module.css';

/**
 * Popover that edits the guide color — shown when the user clicks the ruler
 * corner swatch. Self-owning: reads its own open/closed state from the
 * ui-store modal slot so nothing in App.tsx has to wire up state, props, or
 * keydown effects for it.
 *
 * Rendered inside the canvas body rather than routed through ModalHost
 * because its positioning is canvas-container-relative, not a fixed
 * overlay.
 */
export function GuideColorPicker() {
  const open = useUIStore((s) => s.modal?.kind === 'guideColor');
  const showRulers = useUIStore((s) => s.showRulers);
  const showGuides = useUIStore((s) => s.showGuides);
  const guideColor = useUIStore((s) => s.guideColor);
  const setGuideColor = useUIStore((s) => s.setGuideColor);
  const closeModalOfKind = useUIStore((s) => s.closeModalOfKind);

  // ESC dismisses the picker. The modal slot lets us subscribe only while
  // open, so the keydown listener isn't attached to the document full-time.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModalOfKind('guideColor');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, closeModalOfKind]);

  // The picker is meaningless when rulers or guides are hidden — those UIs
  // are the only way to interact with guide color.
  if (!open || !showRulers || !showGuides) return null;

  return (
    <div
      className={styles.guideColorPicker}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <ColorPicker color={guideColor} onChange={setGuideColor} />
    </div>
  );
}
