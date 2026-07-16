import { useToolSettingsStore } from '../../tool-settings-store';
import { useEditorStore } from '../../editor-store';
import { Slider } from '../../../components/Slider/Slider';
import { SymmetryControls } from '../../../components/SymmetryControls/SymmetryControls';
import { docScaledMax } from '../../../utils/slider-ranges';

export function PencilOptions() {
  const pencilSize = useToolSettingsStore((s) => s.settings.pencil.size);
  const setPencilSetting = useToolSettingsStore((s) => s.setPencilSetting);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 100);

  return (
    <>
      <Slider label="Size" value={pencilSize} min={1} max={sizeMax} sliderMax={250} onChange={(size) => setPencilSetting('size', size)} />
      <SymmetryControls />
    </>
  );
}
