import { useToolSettingsStore } from '../../tool-settings-store';
import { useEditorStore } from '../../editor-store';
import { Slider } from '../../../components/Slider/Slider';
import { docScaledMax } from '../../../utils/slider-ranges';

export function EraserOptions() {
  const eraserSize = useToolSettingsStore((s) => s.settings.eraser.size);
  const eraserOpacity = useToolSettingsStore((s) => s.settings.eraser.opacity);
  const setEraserSetting = useToolSettingsStore((s) => s.setEraserSetting);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 200);

  return (
    <>
      <Slider label="Size" value={eraserSize} min={1} max={sizeMax} sliderMax={300} onChange={(v) => setEraserSetting('size', v)} />
      <Slider label="Opacity" value={eraserOpacity} min={1} max={100} onChange={(v) => setEraserSetting('opacity', v)} />
    </>
  );
}
