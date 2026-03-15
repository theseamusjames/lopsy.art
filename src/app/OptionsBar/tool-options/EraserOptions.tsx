import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';

export function EraserOptions() {
  const eraserSize = useToolSettingsStore((s) => s.eraserSize);
  const eraserOpacity = useToolSettingsStore((s) => s.eraserOpacity);
  const setEraserSize = useToolSettingsStore((s) => s.setEraserSize);
  const setEraserOpacity = useToolSettingsStore((s) => s.setEraserOpacity);

  return (
    <>
      <Slider label="Size" value={eraserSize} min={1} max={200} onChange={setEraserSize} />
      <Slider label="Opacity" value={eraserOpacity} min={1} max={100} onChange={setEraserOpacity} />
    </>
  );
}
