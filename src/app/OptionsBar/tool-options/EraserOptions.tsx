import { useToolSettingsStore } from '../../tool-settings-store';
import { useEditorStore } from '../../editor-store';
import { Slider } from '../../../components/Slider/Slider';
import { docScaledMax } from '../../../utils/slider-ranges';

export function EraserOptions() {
  const eraserSize = useToolSettingsStore((s) => s.eraserSize);
  const eraserOpacity = useToolSettingsStore((s) => s.eraserOpacity);
  const setEraserSize = useToolSettingsStore((s) => s.setEraserSize);
  const setEraserOpacity = useToolSettingsStore((s) => s.setEraserOpacity);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 200);

  return (
    <>
      <Slider label="Size" value={eraserSize} min={1} max={sizeMax} sliderMax={300} onChange={setEraserSize} />
      <Slider label="Opacity" value={eraserOpacity} min={1} max={100} onChange={setEraserOpacity} />
    </>
  );
}
