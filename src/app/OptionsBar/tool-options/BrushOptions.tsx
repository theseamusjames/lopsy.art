import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';

export function BrushOptions() {
  const brushSize = useToolSettingsStore((s) => s.brushSize);
  const brushOpacity = useToolSettingsStore((s) => s.brushOpacity);
  const brushHardness = useToolSettingsStore((s) => s.brushHardness);
  const setBrushSize = useToolSettingsStore((s) => s.setBrushSize);
  const setBrushOpacity = useToolSettingsStore((s) => s.setBrushOpacity);
  const setBrushHardness = useToolSettingsStore((s) => s.setBrushHardness);

  return (
    <>
      <Slider label="Size" value={brushSize} min={1} max={200} onChange={setBrushSize} />
      <Slider label="Opacity" value={brushOpacity} min={1} max={100} onChange={setBrushOpacity} />
      <Slider label="Hardness" value={brushHardness} min={0} max={100} onChange={setBrushHardness} />
    </>
  );
}
