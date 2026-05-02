import { useToolSettingsStore } from '../../tool-settings-store';
import { useEditorStore } from '../../editor-store';
import { Slider } from '../../../components/Slider/Slider';
import { docScaledMax } from '../../../utils/slider-ranges';

export function SmudgeOptions() {
  const smudgeSize = useToolSettingsStore((s) => s.smudgeSize);
  const smudgeStrength = useToolSettingsStore((s) => s.smudgeStrength);
  const setSmudgeSize = useToolSettingsStore((s) => s.setSmudgeSize);
  const setSmudgeStrength = useToolSettingsStore((s) => s.setSmudgeStrength);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 200);

  return (
    <>
      <Slider label="Size" value={smudgeSize} min={1} max={sizeMax} onChange={setSmudgeSize} />
      <Slider label="Strength" value={smudgeStrength} min={0} max={100} onChange={setSmudgeStrength} />
    </>
  );
}
