import { useToolSettingsStore } from '../../tool-settings-store';
import { useEditorStore } from '../../editor-store';
import { Slider } from '../../../components/Slider/Slider';
import { docScaledMax } from '../../../utils/slider-ranges';

export function SmudgeOptions() {
  const smudge = useToolSettingsStore((s) => s.settings.smudge);
  const setSmudgeSetting = useToolSettingsStore((s) => s.setSmudgeSetting);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 200);

  return (
    <>
      <Slider label="Size" value={smudge.size} min={1} max={sizeMax} sliderMax={300} onChange={(v) => setSmudgeSetting('size', v)} />
      <Slider label="Strength" value={smudge.strength} min={0} max={100} onChange={(v) => setSmudgeSetting('strength', v)} />
    </>
  );
}
