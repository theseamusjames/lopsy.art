import { useToolSettingsStore } from '../../app/tool-settings-store';
import { useEditorStore } from '../../app/editor-store';
import { Slider } from '../../components/Slider/Slider';
import { docScaledMax } from '../../utils/slider-ranges';

export function ColorReplaceOptions() {
  const colorReplaceSize = useToolSettingsStore((s) => s.colorReplaceSize);
  const colorReplaceTolerance = useToolSettingsStore((s) => s.colorReplaceTolerance);
  const colorReplaceOpacity = useToolSettingsStore((s) => s.colorReplaceOpacity);
  const setColorReplaceSize = useToolSettingsStore((s) => s.setColorReplaceSize);
  const setColorReplaceTolerance = useToolSettingsStore((s) => s.setColorReplaceTolerance);
  const setColorReplaceOpacity = useToolSettingsStore((s) => s.setColorReplaceOpacity);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 200);

  return (
    <>
      <Slider label="Size" value={colorReplaceSize} min={1} max={sizeMax} onChange={setColorReplaceSize} />
      <Slider label="Tolerance" value={colorReplaceTolerance} min={0} max={255} onChange={setColorReplaceTolerance} />
      <Slider label="Opacity" value={colorReplaceOpacity} min={1} max={100} onChange={setColorReplaceOpacity} />
    </>
  );
}
